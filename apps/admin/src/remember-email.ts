// "Remember my email on this device": the address only, never the password or anything else. Storage can be missing or
// throw (private windows, blocked site data), so every read and write is wrapped and a failure just means "not remembered".

export const EMAIL_KEY = 'pawspal-admin.email';
const MAX_EMAIL = 254;

/** The part of localStorage this needs, so tests can pass a stand-in. */
export interface EmailStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

function browserStorage(): EmailStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/** An address that is plausible to prefill: one line, no spaces, one "@" with something on both sides. Otherwise null. */
export function cleanEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const e = input.trim();
  if (e === '' || e.length > MAX_EMAIL || /\s/.test(e)) return null;
  const at = e.indexOf('@');
  if (at < 1 || at !== e.lastIndexOf('@') || at === e.length - 1) return null;
  return e;
}

/** The remembered address, or an empty string. */
export function readRememberedEmail(storage: EmailStorage | null = browserStorage()): string {
  try { return storage ? cleanEmail(storage.getItem(EMAIL_KEY)) ?? '' : ''; } catch { return ''; }
}

/** Remembers the address after a good password sign-in. Returns whether it was stored. */
export function rememberEmail(email: string, storage: EmailStorage | null = browserStorage()): boolean {
  const e = cleanEmail(email);
  if (!e || !storage) return false;
  try { storage.setItem(EMAIL_KEY, e); return true; } catch { return false; }
}

/** "Not you? Use another email". */
export function forgetEmail(storage: EmailStorage | null = browserStorage()): void {
  try { storage?.removeItem(EMAIL_KEY); } catch { /* nothing to do */ }
}
