// Gives money back for payments the database has marked "refund due" (Terms of Service section 6). Runs on a timer or when
// an admin starts it, proves itself with a secret, and asks the payment provider for each refund. A refund the provider does
// not confirm stays due and is tried again later (up to five times), then waits for a person.
import type { Env } from '../config.ts';
import { ConfigError } from '../config.ts';
import { json, type Rpc } from '../http.ts';
import { paymentProviderFromEnv } from '../payments/index.ts';
import { checkSecret } from '../secret.ts';

export interface RefundDeps { env: Env; fetch: typeof fetch; rpc: Rpc }

export async function handleProcessRefunds(req: Request, deps: RefundDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const who = await checkSecret(deps.env, 'REFUND_SECRET', req, 'x-refund-secret');
  if (who === 'not_configured') return json(503, { error: 'not_configured' });
  if (who === 'unauthorized') return json(401, { error: 'unauthorized' });

  let provider;
  try { provider = paymentProviderFromEnv(deps.env); } catch (e) {
    if (e instanceof ConfigError) return json(503, { error: 'not_configured' });
    throw e;
  }
  if (!provider) return json(503, { error: 'not_configured' });

  const due = await deps.rpc('list_refunds_due', {});
  if (due.error) return json(502, { error: 'try_again_later' });
  const rows = (Array.isArray(due.data) ? due.data : []) as { payment_id?: unknown; provider?: unknown; provider_txn_id?: unknown; refund_cents?: unknown }[];
  let refunded = 0;
  let failed = 0;
  for (const r of rows) {
    if (typeof r.payment_id !== 'string' || typeof r.provider_txn_id !== 'string' || typeof r.refund_cents !== 'number' || r.provider !== provider.name) continue;
    const ok = await provider.refund(r.provider_txn_id, r.refund_cents, deps.fetch);
    await deps.rpc('mark_refund_result', { p_payment: r.payment_id, p_ok: ok });
    if (ok) refunded++; else failed++;
  }
  return json(200, { refunded, failed });
}
