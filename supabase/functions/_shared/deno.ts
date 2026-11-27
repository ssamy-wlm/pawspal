// The only file that touches Deno and the Supabase client. The function entry points use it; the tested logic does not.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import type { Env } from './config.ts';
import type { Rpc } from './http.ts';
import type { StorageOps } from './handlers/process-upload.ts';
import type { SignedUrlOps } from './handlers/handover-photo-url.ts';
import { sessionIdFromJwt } from './handlers/admin-passkey.ts';

declare const Deno: { env: { get(name: string): string | undefined } };

export const env: Env = { get: (name) => Deno.env.get(name) };

/** A client with full rights (the service role). It never leaves the server: it is built from a secret the platform provides. */
export function adminClient() {
  const url = env.get('SUPABASE_URL');
  const key = env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('missing Supabase settings');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function rpcOf(client: ReturnType<typeof adminClient>): Rpc {
  return async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    return { data, error: error ? { message: error.message } : null };
  };
}

export function authUserOf(client: ReturnType<typeof adminClient>) {
  return async (token: string) => {
    const { data, error } = await client.auth.getUser(token);
    return error || !data.user ? null : { id: data.user.id };
  };
}

/** Like authUserOf, plus the Supabase session id (JWT claim session_id). The auth server has already accepted the token, so
 *  reading the claim from its payload is safe. A token without a session id is refused. */
export function adminAuthUserOf(client: ReturnType<typeof adminClient>) {
  return async (token: string) => {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    const sessionId = sessionIdFromJwt(token);
    return sessionId ? { id: data.user.id, sessionId } : null;
  };
}

export function storageOf(client: ReturnType<typeof adminClient>): StorageOps {
  return {
    async download(bucket, path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      return error || !data ? null : new Uint8Array(await data.arrayBuffer());
    },
    async upload(bucket, path, bytes, contentType) {
      const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
      return !error;
    },
    async remove(bucket, path) {
      await client.storage.from(bucket).remove([path]);
    },
  };
}

export function signedUrlsOf(client: ReturnType<typeof adminClient>): SignedUrlOps {
  return {
    async signedUrl(bucket, path, seconds) {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(path, seconds);
      return error || !data ? null : data.signedUrl;
    },
  };
}

// ---- phase 9: account deletion, data export, push

/** Like authUserOf, plus the email (needed to check the password again). */
export function authUserWithEmailOf(client: ReturnType<typeof adminClient>) {
  return async (token: string) => {
    const { data, error } = await client.auth.getUser(token);
    return error || !data.user || !data.user.email ? null : { id: data.user.id, email: data.user.email };
  };
}

/** Checks a password with a separate client that keeps no session (anon key). false = wrong password; throws when the check could
 *  not run (outage, rate limit). The session it opens is closed at once. The password is never logged. */
export function passwordVerifier() {
  return async (email: string, password: string): Promise<boolean> => {
    const url = env.get('SUPABASE_URL');
    const anon = env.get('SUPABASE_ANON_KEY');
    if (!url || !anon) throw new Error('missing Supabase settings');
    const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.status === 400) return false;
      throw new Error('password check unavailable');
    }
    if (data.session) await c.auth.signOut().catch(() => undefined);
    return true;
  };
}

/** Sign-out and ban through the Auth admin API. A ban of about 100 years: the person can never sign in again (the final purge deletes the user). */
export function accountOpsOf(client: ReturnType<typeof adminClient>) {
  return {
    async signOutEverywhere(token: string): Promise<void> {
      await client.auth.admin.signOut(token, 'global');
    },
    async banUser(userId: string): Promise<boolean> {
      const { error } = await client.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
      return !error;
    },
    async removeMany(bucket: string, names: string[]): Promise<boolean> {
      return !(await client.storage.from(bucket).remove(names)).error;
    },
  };
}
