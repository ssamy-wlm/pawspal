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

export interface ActionForm { action: ActionKind; rule: string; message: string; length: SuspensionLength; checklist: string }

/** Null when the form is fine, otherwise the sentence to show. Mirrors admin_take_action. */
export function validateAction(status: AccountStatus, f: ActionForm): string | null {
  if (!actionsFor(status).includes(f.action)) return 'This action does not fit the account status.';
  if (needsReason(f.action)) {
    if (f.rule.trim() === '') return 'Choose the rule that was broken.';
    if (f.message.trim() === '') return 'Write the message the person will read.';
  }
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
    p_duration_days: suspension && f.length !== 'fixed' ? Number(f.length) : null,
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
