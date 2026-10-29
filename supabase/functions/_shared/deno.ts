// The only file that touches Deno and the Supabase client. The function entry points use it; the tested logic does not.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import type { Env } from './config.ts';
import type { Rpc } from './http.ts';
import type { StorageOps } from './handlers/process-upload.ts';

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
