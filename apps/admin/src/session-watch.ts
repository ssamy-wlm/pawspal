// The passkey session on the server lasts 8 hours at most, while the page may stay open for longer (the idle sign-out is
// 6 hours). So while someone is signed in the page re-asks admin_status() every 5 minutes, and at once when a request is
// refused for lack of rights. If the answer is "needs_passkey" the page shows the passkey screen (it does not sign out,
// and the address stays the same, so the person comes back to the same page). The database decides; this only avoids
// showing a dead page or a raw error.
import { gateFor, type Gate } from './passkey-rules';

export const RECHECK_MS = 5 * 60 * 1000;
export const RECHECK_MIN_GAP_MS = 5_000;
export const SESSION_RAN_OUT = 'Your passkey check ran out. Touch your passkey to carry on where you were.';

/** What to do with the answer of a re-check. A failed or unknown answer changes nothing (a network blip must not throw anyone out). */
export type Recheck = 'stay' | 'passkey' | 'setup' | 'sign_out';
export function afterRecheck(status: unknown): Recheck {
  const gate: Gate = gateFor(status);
  return gate === 'passkey' ? 'passkey' : gate === 'setup' ? 'setup' : gate === 'deny' ? 'sign_out' : 'stay';
}

/** A refusal for lack of rights: the HTTP status of a data request, or the database's message. */
export function looksNotAllowed(status: number | null | undefined, message?: string | null): boolean {
  if (status === 401 || status === 403) return true;
  return /admins only|permission denied|row-level security|not allowed/i.test(message ?? '');
}

/** Runs `fn` at most once at a time and not more often than every `minGap` ms (a burst of refused requests asks once). */
export function createGate(minGap: number, now: () => number = Date.now) {
  let running = false;
  let last = -Infinity;
  return async (fn: () => Promise<void>): Promise<boolean> => {
    if (running || now() - last < minGap) return false;
    running = true; last = now();
    try { await fn(); } finally { running = false; }
    return true;
  };
}

// The data layer reports a refusal here; the auth provider listens while someone is signed in and verified.
let listener: (() => void) | null = null;
export const onNotAllowed = (fn: (() => void) | null) => { listener = fn; };
export const reportNotAllowed = () => { try { listener?.(); } catch { /* never breaks the request that was refused */ } };
