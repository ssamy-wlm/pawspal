// A daily email to people whose membership renews soon. It runs on a timer, proves itself with a shared secret, asks the
// database who is due, sends one email each, and marks a person as reminded only after the email went out.
// It never logs or returns emails, names or message text.
import { ConfigError, type Env } from '../config.ts';
import type { EmailProvider } from '../email/types.ts';
import { checkSecret } from '../secret.ts';
import { json, type Rpc } from '../http.ts';

export interface ReminderDeps {
  env: Env;
  rpc: Rpc;
  /** Builds the provider from settings. Throws ConfigError when a key is missing. */
  provider(env: Env): EmailProvider;
}

interface DueRow { user_id: string; email: string; first_name: string | null; locale: string | null; paid_until: string }

const DATE = /^\d{4}-\d{2}-\d{2}/;

function asRows(data: unknown): DueRow[] {
  if (!Array.isArray(data)) return [];
  return (data as Partial<DueRow>[]).filter((r): r is DueRow =>
    typeof r.user_id === 'string' && typeof r.email === 'string' && r.email.includes('@') && typeof r.paid_until === 'string' && DATE.test(r.paid_until));
}

/** The renewal fee from the settings, or null when it is not there. Never hard coded. */
function amountOf(data: unknown): number | null {
  const v = (data as { renewal_fee_egp?: unknown } | null)?.renewal_fee_egp;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function reminderEmail(row: Pick<DueRow, 'first_name' | 'locale' | 'paid_until'>, amount: number | null): { subject: string; text: string } {
  const date = row.paid_until.slice(0, 10);
  const name = row.first_name?.trim() ?? '';
  if (row.locale === 'ar') {
    const fee = amount === null ? '' : ` قيمة التجديد ${amount} جنيه.`;
    return {
      subject: 'عضويتك في PawsPal تتجدد قريبا',
      text: `${name ? `مرحبا ${name}،` : 'مرحبا،'}\n\nعضويتك في PawsPal تتجدد في ${date}.${fee}\n\nافتح التطبيق، ثم العضوية، وادفع عبر إنستاباي أو التحويل البنكي، ثم ارفع رقم المرجع.\n\nفريق PawsPal`,
    };
  }
  const fee = amount === null ? '' : ` The renewal is ${amount} EGP.`;
  return {
    subject: 'Your PawsPal membership renews soon',
    text: `${name ? `Hi ${name},` : 'Hi,'}\n\nYour PawsPal membership renews on ${date}.${fee}\n\nOpen the app, go to Membership, and pay by InstaPay or bank transfer. Then upload the reference.\n\nThe PawsPal team`,
  };
}

export async function handleMembershipReminders(req: Request, deps: ReminderDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const who = await checkSecret(deps.env, 'REMINDER_SECRET', req, 'x-reminder-secret');
  if (who === 'not_configured') return json(503, { error: 'not_configured' });
  if (who === 'unauthorized') return json(401, { error: 'unauthorized' });

  let provider: EmailProvider;
  try {
    provider = deps.provider(deps.env);
  } catch (e) {
    if (e instanceof ConfigError) return json(503, { error: 'not_configured' });
    throw e;
  }

  const listed = await deps.rpc('list_due_reminders', {});
  if (listed.error) return json(502, { error: 'try_again_later' });
  const rows = asRows(listed.data);
  if (rows.length === 0) return json(200, { sent: 0, failed: 0 });

  const settings = await deps.rpc('get_payment_settings', {});
  const amount = settings.error ? null : amountOf(settings.data);

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await provider.send({ to: row.email, ...reminderEmail(row, amount) });
    } catch {
      failed += 1;                                   // not marked, so tomorrow's run tries again
      continue;
    }
    const marked = await deps.rpc('mark_reminded', { p_user: row.user_id, p_paid_until: row.paid_until.slice(0, 10) });
    if (marked.error) failed += 1; else sent += 1;
  }
  return json(200, { sent, failed });
}
