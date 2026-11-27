// "Delete my account." The person proves it is them again with the password (checked here, never logged), then the database
// closes the account at once (the person disappears everywhere, photos and posts go) and the sign-in account is blocked. The
// final purge runs later (purge-accounts). Order matters: password, then the database, then sign-in is cut, then files.
import { bearerToken, json, readJson, type Rpc } from '../http.ts';

export interface DeleteAccountDeps {
  /** The signed-in person from the token, with the email the password belongs to. */
  authUser(token: string): Promise<{ id: string; email: string } | null>;
  rpc: Rpc;
  /** True when the password is right, false when it is wrong. Throws when the check itself could not run. Never logs the password. */
  verifyPassword(email: string, password: string): Promise<boolean>;
  /** Ends every session of the person (best effort). */
  signOutEverywhere(token: string): Promise<void>;
  /** Blocks sign-in for good. False when it failed. */
  banUser(userId: string): Promise<boolean>;
  /** Deletes files from one bucket. False when it failed. */
  removeFiles(bucket: string, names: string[]): Promise<boolean>;
}

const BUCKETS = new Set(['faces', 'pets', 'homes', 'handovers', 'ids', 'payments', 'incoming']);
const BATCH = 100;

export async function handleDeleteAccount(req: Request, deps: DeleteAccountDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = bearerToken(req);
  const user = token ? await deps.authUser(token) : null;
  if (!token || !user) return json(401, { error: 'unauthorized' });
  const body = await readJson(req, 2 * 1024);
  if (!body || typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 200) return json(400, { error: 'invalid_request' });

  // Five wrong passwords an hour stop the guessing, before the password is even looked at.
  const blocked = await deps.rpc('deletion_attempts_blocked', { p_user: user.id });
  if (blocked.error) return json(502, { error: 'try_again_later' });
  if (blocked.data === true) return json(429, { error: 'too_many_attempts' });

  let ok: boolean;
  try {
    ok = await deps.verifyPassword(user.email, body.password);
  } catch {
    return json(502, { error: 'try_again_later' });
  }
  if (!ok) {
    await deps.rpc('note_deletion_failure', { p_user: user.id });
    return json(401, { error: 'wrong_password' });
  }

  const closed = await deps.rpc('close_account', { p_user: user.id });
  if (closed.error || !closed.data || typeof closed.data !== 'object') return json(502, { error: 'try_again_later' });
  const result = closed.data as { status?: unknown; purge_after?: unknown };
  switch (result.status) {
    case 'closed':
    case 'already_closed': break;                                               // already_closed: a retry finishes the steps below
    case 'admin': return json(403, { error: 'admin_account' });                 // admins are removed with the founder tools
    case 'active_booking': return json(409, { error: 'active_booking' });       // cancel the open booking first
    case 'not_found': return json(404, { error: 'not_found' });
    default: return json(502, { error: 'try_again_later' });
  }

  // The account is closed in the database. Now nobody can sign in with it. If this fails the person retries (same endpoint).
  await deps.signOutEverywhere(token).catch(() => undefined);
  if (!(await deps.banUser(user.id))) return json(502, { error: 'try_again_later' });

  // Photo files. A failure here is not fatal: the nightly purge lists and deletes whatever is left.
  const files = await deps.rpc('list_user_files', { p_user: user.id });
  if (!files.error && Array.isArray(files.data)) {
    const byBucket = new Map<string, string[]>();
    for (const f of files.data as { bucket_id?: unknown; name?: unknown }[]) {
      if (typeof f.bucket_id !== 'string' || typeof f.name !== 'string' || !BUCKETS.has(f.bucket_id) || !f.name.startsWith(`${user.id}/`)) continue;
      byBucket.set(f.bucket_id, [...(byBucket.get(f.bucket_id) ?? []), f.name]);
    }
    for (const [bucket, names] of byBucket) {
      for (let i = 0; i < names.length; i += BATCH) await deps.removeFiles(bucket, names.slice(i, i + BATCH)).catch(() => false);
    }
  }
  return json(200, { ok: true, purge_after: typeof result.purge_after === 'string' ? result.purge_after : null });
}
