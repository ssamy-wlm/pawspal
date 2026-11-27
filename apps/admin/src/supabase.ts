import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { looksNotAllowed, reportNotAllowed } from './session-watch';

let client: SupabaseClient | null = null;

/** The two values are public by design (the app uses the same ones). Everything is protected by the database's rules. */
export const configured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Made on first use, in the browser, so a build without the settings still works. */
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      // A refused data request (401 or 403) makes the page re-check its passkey session at once (see session-watch.ts).
      global: {
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (url.includes('/rest/v1/') && looksNotAllowed(res.status)) reportNotAllowed();
          return res;
        },
      },
    });
  }
  return client;
}
