// The rules of the dashboard that do not need a network: which actions fit which account status, what the database will
// accept, and the sign-in decisions. The database enforces all of this again; this only keeps people from clicking into a
// refusal.

export type AccountStatus = 'pending_verification' | 'pending_review' | 'active' | 'suspended' | 'removed';
export type ActionKind = 'reminder' | 'warning' | 'suspension' | 'removal' | 'reinstatement' | 'approval';
export type SuspensionLength = '3' | '7' | 'fixed';

/** The five community rules and the zero-tolerance list (HANDOVER section 6). */
export const RULES = [
  'Care for every pet like your own',
  'Real photos only',
  'Keep chat and payments in the app until confirmed',
  'Be honest and kind',
  'Report problems',
] as const;
export const ZERO_TOLERANCE = ['Animal harm', 'Threats', 'Fake identity', 'Selling or breeding animals', 'Fraud'] as const;
export const LADDER = ['Reminder', 'Warning', 'Suspension (3 days, 7 days or until fixed)', 'Removal'] as const;

const ALLOWED: Record<AccountStatus, ActionKind[]> = {
  pending_verification: [],
  pending_review: ['approval', 'removal'],
  active: ['reminder', 'warning', 'suspension', 'removal'],
  suspended: ['reminder', 'warning', 'reinstatement', 'removal'],
  removed: ['reinstatement'],
};
export const actionsFor = (status: AccountStatus): ActionKind[] => ALLOWED[status] ?? [];

export const needsReason = (a: ActionKind) => a === 'reminder' || a === 'warning' || a === 'suspension' || a === 'removal';

export interface ActionForm { action: ActionKind; rule: string; message: string; length: SuspensionLength | ''; checklist: string }

/** Null when the form is fine, otherwise the sentence to show. Mirrors admin_take_action. */
export function validateAction(status: AccountStatus, f: ActionForm): string | null {
  if (!actionsFor(status).includes(f.action)) return 'This action does not fit the account status.';
  if (needsReason(f.action)) {
    if (f.rule.trim() === '') return 'Choose the rule that was broken.';
    if (f.message.trim() === '') return 'Write the message the person will read.';
  }
  if (f.action === 'suspension' && f.length === '') return 'Choose how long the suspension lasts.';
  if (f.message.length > 1000) return 'The message is too long (1000 characters at most).';
  if (f.rule.length > 120) return 'The rule is too long.';
  return null;
}

/** The arguments of admin_take_action for a form. */
export function actionArgs(userId: string, f: ActionForm) {
  const checklist = f.checklist.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 10);
  const suspension = f.action === 'suspension';
  return {
    p_user: userId,
    p_action: f.action,
    p_rule: needsReason(f.action) ? f.rule.trim() : null,
    p_duration_days: suspension && f.length !== 'fixed' && f.length !== '' ? Number(f.length) : null,
    p_until_fixed: suspension && f.length === 'fixed',
    p_checklist: suspension && f.length === 'fixed' ? checklist : [],
    p_message: f.message.trim() === '' ? null : f.message.trim(),
  };
}

export const REPORT_REASONS: Record<string, string> = {
  off_app_payment: 'Asked to pay outside the app', fake_photo: 'Fake or misleading photos', no_show: 'Did not show up',
  late_cancel: 'Cancelled too late', rude_or_harassment: 'Rude or harassing', animal_welfare: 'Pet not looked after',
  pet_mismatch: 'Pet not as described', duplicate_account: 'Fake or duplicate account', safety: 'Felt unsafe', other: 'Something else',
};

/** What the dashboard shows after sign-in, from the database's answer. */
export type Gate = 'show' | 'ask_code' | 'deny';
export const gateFor = (status: string | null): Gate => (status === 'admin' ? 'show' : status === 'needs_mfa' ? 'ask_code' : 'deny');

/** Sign out after this long without a click or key press. */
export const IDLE_LIMIT_MS = 30 * 60 * 1000;
export const isIdle = (lastActive: number, now: number, limit = IDLE_LIMIT_MS) => now - lastActive >= limit;

/** A six digit authenticator code, spaces allowed. Null when it is not one. */
export function cleanCode(input: string): string | null {
  const d = input.replace(/\s+/g, '');
  return /^\d{6}$/.test(d) ? d : null;
}

export const looksLikeId = (q: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q.trim());

/** What the confirm button says, in words that cannot be misread. */
export function confirmLabel(f: Pick<ActionForm, 'action' | 'length'>): string {
  switch (f.action) {
    case 'removal': return 'Yes, remove and ban this person';
    case 'suspension': return `Yes, suspend ${f.length === 'fixed' ? 'until fixed' : f.length ? `for ${f.length} days` : ''}`.trim();
    case 'warning': return 'Send the warning';
    case 'reminder': return 'Send the reminder';
    case 'reinstatement': return 'Reinstate this account';
    default: return 'Approve this profile';
  }
}

/** A database value as words: "in_progress" becomes "in progress". */
export const nice = (v: string | null | undefined) => (v ?? '').replace(/_/g, ' ');

// ---- Membership, waiting time and settings (architecture v3, sections 4 and 9) ----

export type MembershipState = 'unpaid' | 'active' | 'due_soon' | 'paused';
const toDay = (d: string | Date) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const DAY_MS = 24 * 60 * 60 * 1000;
/** Where a person stands: never paid, paid, paid but ending within reminderDays, or past the paid-until date. */
export function membershipState(paidUntil: string | null | undefined, today: string | Date, reminderDays = 7): MembershipState {
  if (!paidUntil) return 'unpaid';
  const left = Math.round((Date.parse(toDay(paidUntil)) - Date.parse(toDay(today))) / DAY_MS);
  return left < 0 ? 'paused' : left <= reminderDays ? 'due_soon' : 'active';
}
export const MEMBERSHIP_LABEL: Record<MembershipState, string> = { unpaid: 'Unpaid', active: 'Active', due_soon: 'Due soon', paused: 'Paused' };

/** Whole hours since an ISO time (never negative). */
export function hoursWaiting(iso: string, now: number | Date = Date.now()): number {
  const t = typeof now === 'number' ? now : now.getTime();
  return Math.max(0, Math.floor((t - Date.parse(iso)) / (60 * 60 * 1000)));
}
/** "waiting 3 hours", "waiting 2 days". */
export function waitingText(hours: number): string {
  if (hours < 1) return 'waiting less than an hour';
  if (hours < 48) return `waiting ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const d = Math.floor(hours / 24);
  return `waiting ${d} days`;
}
export const OVERDUE_HOURS = 24;

export const NUMBER_SETTINGS = { registration_fee_egp: [1, 100000], renewal_fee_egp: [1, 100000], membership_months: [1, 60], reminder_days: [1, 60] } as const;
export const TEXT_SETTINGS = ['instapay_link', 'instapay_qr_url', 'bank_name', 'bank_account_name', 'bank_account_number', 'bank_iban', 'payment_note'] as const;
export type SettingKey = keyof typeof NUMBER_SETTINGS | (typeof TEXT_SETTINGS)[number];
export const isNumberSetting = (key: string): key is keyof typeof NUMBER_SETTINGS => key in NUMBER_SETTINGS;

/** Null when the value is fine, otherwise the sentence to show. Numbers are positive whole numbers within range. */
export function validateSetting(key: string, raw: string): string | null {
  const v = raw.trim();
  if (isNumberSetting(key)) {
    const [min, max] = NUMBER_SETTINGS[key];
    if (!/^\d+$/.test(v)) return 'Enter a whole number.';
    const n = Number(v);
    if (n < min || n > max) return `Enter a number from ${min} to ${max}.`;
    return null;
  }
  if ((TEXT_SETTINGS as readonly string[]).includes(key)) {
    if (v.length > 500) return 'This is too long (500 characters at most).';
    if ((key === 'instapay_link' || key === 'instapay_qr_url') && v !== '' && !/^https:\/\/\S+$/i.test(v)) return 'Use a full link that starts with https://';
    return null;
  }
  return 'Unknown setting.';
}

/** Filter used by the Users page (?membership=expiring|paused|unpaid). */
export function matchesMembership(filter: string, paidUntil: string | null | undefined, today: string | Date, reminderDays = 7): boolean {
  if (!filter) return true;
  const s = membershipState(paidUntil, today, reminderDays);
  return filter === 'expiring' ? s === 'due_soon' : filter === 'paused' ? s === 'paused' : filter === 'unpaid' ? s === 'unpaid' : true;
}
