// The passkey rules of the admin site that need no network and no browser: which screen the database answer leads to,
// how errors are worded, and how codes and names are cleaned. The database and the edge function check everything again.

/** What `admin_status()` can answer. Anything else is treated as a failure, never as "ready". */
export type AdminStatus = 'not_admin' | 'needs_setup' | 'needs_passkey' | 'admin';

/** The screen that follows a sign-in, from the database's answer. */
export type Gate = 'show' | 'passkey' | 'setup' | 'deny' | 'error';
export function gateFor(status: unknown): Gate {
  switch (status) {
    case 'admin': return 'show';
    case 'needs_passkey': return 'passkey';
    case 'needs_setup': return 'setup';
    case 'not_admin': return 'deny';
    default: return 'error';          // null, a failed call or a word we do not know: back to sign-in, never "ready"
  }
}
export const CHECK_FAILED = 'We could not check your account. Try signing in again.';

// ---- Errors ----

/** What the edge function answers, plus the three things that happen in the browser. */
export type ErrorKind = 'not_allowed' | 'invalid_request' | 'too_many_attempts' | 'not_configured' | 'try_again_later' | 'step_up_required' | 'cancelled' | 'already_registered' | 'unsupported';
const FUNCTION_ERRORS: readonly string[] = ['not_allowed', 'invalid_request', 'too_many_attempts', 'not_configured', 'try_again_later', 'step_up_required'];

/** The kind of error in an edge function answer. Anything unexpected becomes "try again later". */
export function functionErrorKind(answer: unknown): ErrorKind {
  const e = answer && typeof answer === 'object' ? (answer as { error?: unknown }).error : undefined;
  return typeof e === 'string' && FUNCTION_ERRORS.includes(e) ? (e as ErrorKind) : 'try_again_later';
}

/** The kind of error the browser's passkey prompt threw (cancel, duplicate, no support). */
export function browserErrorKind(e: unknown): ErrorKind {
  const err = e as { name?: unknown; code?: unknown } | null;
  const name = typeof err?.name === 'string' ? err.name : '';
  const code = typeof err?.code === 'string' ? err.code : '';
  if (code.endsWith('_PREVIOUSLY_REGISTERED') || name === 'InvalidStateError') return 'already_registered';
  if (name === 'NotAllowedError' || name === 'AbortError' || code === 'ERROR_CEREMONY_ABORTED') return 'cancelled';
  if (name === 'NotSupportedError' || code === 'ERROR_WEBAUTHN_NOT_SUPPORTED') return 'unsupported';
  return 'try_again_later';
}

/** One calm sentence per kind. No detail from the server or the browser is ever shown. */
export const ERROR_TEXT: Record<ErrorKind, string> = {
  not_allowed: 'That did not work. Check the code or the passkey and try again.',
  invalid_request: 'That did not work. Check what you typed and try again.',
  too_many_attempts: 'Too many tries. Wait a few minutes, then try again.',
  not_configured: 'Passkeys are not switched on for this site yet. Finish the setup in SETUP.md, section E10, then try again.',
  try_again_later: 'Something went wrong. Try again in a moment.',
  step_up_required: 'Touch your passkey again to do this, then try once more.',
  cancelled: 'The passkey prompt was closed. Press the button to try again.',
  already_registered: 'This device already has a passkey for this site. Use it, or pick another device.',
  unsupported: 'This browser cannot use passkeys. Try an up to date Chrome, Safari, Edge or Firefox.',
};
export const errorText = (kind: ErrorKind) => ERROR_TEXT[kind];

/** The error as shown to the person: a PasskeyError carries its kind, a browser error is mapped, anything else is "try again". */
export function describeError(e: unknown): string {
  const kind = (e as { kind?: unknown } | null)?.kind;
  if (typeof kind === 'string' && kind in ERROR_TEXT) return ERROR_TEXT[kind as ErrorKind];
  return ERROR_TEXT[browserErrorKind(e)];
}

// ---- Codes and names ----

/** A recovery or setup code as typed: spaces and line breaks (also from pasting) are dropped, nothing else is changed. */
export function cleanCode(input: string): string {
  return input.replace(/\s+/g, '');
}
export const RECOVERY_CODE_COUNT = 10;
/** Null when the code looks possible to send, otherwise the sentence to show. */
export function validateCode(input: string, what: 'recovery' | 'setup'): string | null {
  const c = cleanCode(input);
  if (c === '') return what === 'recovery' ? 'Enter one of your recovery codes.' : 'Enter the setup code.';
  if (c.length > 64) return 'That code is too long.';
  return null;
}

/** The text of the recovery codes file: one code a line, numbered, with a plain reminder at the top. */
export function recoveryCodesText(codes: readonly string[], today: Date = new Date()): string {
  const day = today.toISOString().slice(0, 10);
  return [
    'PawsPal admin recovery codes',
    `Made on ${day}`,
    '',
    'Each code works once. Keep this file offline or in a password manager.',
    'Use a code only if you cannot use your passkey.',
    '',
    ...codes.map((c, i) => `${String(i + 1).padStart(2, ' ')}. ${c}`),
    '',
  ].join('\n');
}

export const PASSKEY_NAME_MAX = 40;
export const DEFAULT_PASSKEY_NAME = 'This device';
/** The name with spaces tidied. */
export const cleanName = (input: string) => input.replace(/\s+/g, ' ').trim();
/** Null when the name is fine, otherwise the sentence to show. */
export function validatePasskeyName(input: string): string | null {
  const n = cleanName(input);
  if (n === '') return 'Give the passkey a name, like "My iPhone".';
  if (n.length > PASSKEY_NAME_MAX) return `Use ${PASSKEY_NAME_MAX} characters or fewer.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(n)) return 'Use letters, numbers and simple punctuation only.';
  return null;
}

// ---- The Security page ----

export interface PasskeyRow { id: string; name: string; created_at: string; last_used_at: string | null; device_type: string | null; backed_up: boolean | null }
export interface PasskeyStatus { passkeys: PasskeyRow[]; verified: boolean; via: 'passkey' | 'recovery' | null; recovery_codes_left: number }

/** A short hint about where the passkey lives. */
export function passkeyHint(p: Pick<PasskeyRow, 'device_type' | 'backed_up'>): string {
  if (p.device_type === 'singleDevice' && !p.backed_up) return 'Only on this one device';
  if (p.backed_up || p.device_type === 'multiDevice') return 'Synced across your devices';
  return 'Kept on one device';
}
/** The last passkey stays: without one the only way in would be a recovery code. */
export const canRemovePasskey = (count: number) => count > 1;
export const LAST_PASSKEY_NOTE = 'This is your only passkey, so it cannot be removed. Add another one first.';

/** After a recovery code sign-in the page asks for a new passkey until one has been added. */
export const needsNewPasskey = (via: PasskeyStatus['via'] | undefined, addedSinceSignIn: boolean) => via === 'recovery' && !addedSinceSignIn;

/** A friendly count for the recovery codes line. */
export function codesLeftText(n: number): string {
  if (n <= 0) return 'You have no recovery codes left. Make new ones.';
  return n === 1 ? 'You have 1 recovery code left.' : `You have ${n} recovery codes left.`;
}

// ---- Step-up: a fresh passkey touch for sensitive actions ----

const isStepUp = (e: unknown) => (e as { kind?: unknown } | null)?.kind === 'step_up_required';
/**
 * Runs `call`. When the function answers "step_up_required", asks for a fresh passkey touch (`stepUp`, which throws when the
 * person cancels or it fails) and runs `call` once more. A second "step_up_required" is thrown as it is: never a loop.
 */
export async function withStepUp<T>(call: () => Promise<T>, stepUp: () => Promise<void>): Promise<T> {
  try { return await call(); } catch (e) {
    if (!isStepUp(e)) throw e;
    await stepUp();
    return await call();
  }
}

// ---- Signing out ----

/**
 * Ends the passkey session on the server first (it needs the sign-in token), then the Supabase Auth session. A failure of
 * the first step never stops the second: the person is always signed out.
 */
export async function signOutEverywhere(endPasskeySession: () => Promise<unknown>, endAuthSession: () => Promise<unknown>): Promise<void> {
  try { await endPasskeySession(); } catch { /* the Auth sign-out below still happens */ }
  try { await endAuthSession(); } catch { /* nothing more to do */ }
}
