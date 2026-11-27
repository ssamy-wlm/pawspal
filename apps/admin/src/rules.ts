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
/** A closed account (the person deleted it) can never be suspended, lifted, approved or reinstated: the database refuses all of it. */
export const actionsFor = (status: AccountStatus, closed = false): ActionKind[] => (closed ? [] : ALLOWED[status] ?? []);

export const needsReason = (a: ActionKind) => a === 'reminder' || a === 'warning' || a === 'suspension' || a === 'removal';

export interface ActionForm { action: ActionKind; rule: string; message: string; length: SuspensionLength | ''; checklist: string }

/** Null when the form is fine, otherwise the sentence to show. Mirrors admin_take_action. */
export function validateAction(status: AccountStatus, f: ActionForm, closed = false): string | null {
  if (closed) return 'This account was closed by the person. Nothing can be done for it.';
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

/** Sign out after this long without a click or key press. */
export const IDLE_LIMIT_MS = 30 * 60 * 1000;
export const isIdle = (lastActive: number, now: number, limit = IDLE_LIMIT_MS) => now - lastActive >= limit;

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

export const NUMBER_SETTINGS = {
  registration_fee_egp: [1, 100000], renewal_fee_egp: [1, 100000], membership_months: [1, 60], reminder_days: [1, 60],
  deletion_grace_days: [1, 365], shared_history_months: [1, 120],
} as const;
/** The most digits the database accepts per number setting (admin_set_setting uses ^[0-9]{1,n}$), so "0030" is refused here too. */
export const NUMBER_DIGITS: Record<keyof typeof NUMBER_SETTINGS, number> = {
  registration_fee_egp: 6, renewal_fee_egp: 6, membership_months: 2, reminder_days: 2, deletion_grace_days: 3, shared_history_months: 3,
};
/** On/off settings: the value is the word 'true' or 'false'. */
export const SWITCH_SETTINGS = ['push_enabled'] as const;
export const isSwitchSetting = (key: string): key is (typeof SWITCH_SETTINGS)[number] => (SWITCH_SETTINGS as readonly string[]).includes(key);
export const TEXT_SETTINGS = ['instapay_link', 'instapay_qr_url', 'instapay_address', 'vodafone_cash_number', 'vodafone_cash_name', 'vodafone_cash_link', 'payment_note'] as const;
export type SettingKey = keyof typeof NUMBER_SETTINGS | (typeof TEXT_SETTINGS)[number] | (typeof SWITCH_SETTINGS)[number];
export const isNumberSetting = (key: string): key is keyof typeof NUMBER_SETTINGS => key in NUMBER_SETTINGS;

/** Null when the value is fine, otherwise the sentence to show. Numbers are positive whole numbers within range. */
export function validateSetting(key: string, raw: string): string | null {
  const v = raw.trim();
  if (isNumberSetting(key)) {
    const [min, max] = NUMBER_SETTINGS[key];
    if (!new RegExp(`^[0-9]{1,${NUMBER_DIGITS[key]}}$`).test(v)) return 'Enter a whole number.';
    const n = Number(v);
    if (n < min || n > max) return `Enter a number from ${min} to ${max}.`;
    return null;
  }
  if (isSwitchSetting(key)) return v === 'true' || v === 'false' ? null : 'Choose on or off.';
  if ((TEXT_SETTINGS as readonly string[]).includes(key)) {
    if (v.length > 500) return 'This is too long (500 characters at most).';
    // These patterns are the same as in admin_set_setting (migration 0019). An empty value is allowed: it clears the field.
    if ((key === 'instapay_link' || key === 'instapay_qr_url' || key === 'vodafone_cash_link') && v !== '' && !/^https:\/\/\S{3,255}$/.test(v)) return 'Use a full link that starts with https://';
    if (key === 'instapay_address' && v !== '' && !/^[A-Za-z0-9._-]{2,40}@[A-Za-z0-9.-]{2,30}$/.test(v)) return 'Use an InstaPay address like yourname@instapay, with no spaces.';
    if (key === 'vodafone_cash_number' && v !== '' && !/^(\+20|0)1[0-9]{9}$/.test(v)) return 'Use an Egyptian mobile number like 01012345678 (or +201012345678), with no spaces.';
    if (key === 'vodafone_cash_name' && v !== '' && ([...v].length > 60 || /[\u0000-\u001f\u007f-\u009f]/.test(v))) return 'Use a name of 60 characters or fewer, on one line.';
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

// ---- Closed accounts (architecture v3, section 11.2) ----
// A person who deletes their account becomes a stub: the same id, first_name 'Deleted user', status 'removed', deleted_at and
// purge_after set. After the purge payment_claims.user_id is null and the sign-in account is gone.
export const DELETED_NAME = 'Deleted user';
export interface ClosedInfo { status?: string | null; first_name?: string | null; deleted_at?: string | null }
export const isClosedAccount = (p: ClosedInfo | null | undefined): boolean => !!p && (!!p.deleted_at || (p.status === 'removed' && p.first_name === DELETED_NAME));
/** The name to show: "Deleted user" for a closed account or a person who is gone, otherwise the first name. */
export const personName = (p: ClosedInfo | null | undefined, fallback = 'No name'): string => (!p ? DELETED_NAME : isClosedAccount(p) ? DELETED_NAME : p.first_name ?? fallback);

export type PurgeState = 'open' | 'waiting' | 'due' | 'purged';
/** open: not closed. waiting: closed, the final clean-up is still ahead. due: the date has passed, the nightly job has not run yet. purged: done. */
export function purgeState(p: { deleted_at?: string | null; purge_after?: string | null; purged_at?: string | null } | null | undefined, now: number | Date = Date.now()): PurgeState {
  if (!p || !p.deleted_at) return 'open';
  if (p.purged_at) return 'purged';
  const t = typeof now === 'number' ? now : now.getTime();
  return p.purge_after && Date.parse(p.purge_after) > t ? 'waiting' : 'due';
}

/** Filter used by the Users page (?account=open|closed). */
export const matchesAccount = (filter: string, p: ClosedInfo): boolean => (filter === 'closed' ? isClosedAccount(p) : filter === 'open' ? !isClosedAccount(p) : true);
