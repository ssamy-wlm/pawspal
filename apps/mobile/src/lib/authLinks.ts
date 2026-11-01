// Turns the links in our emails into a signed-in session. Nothing here is ever logged: the links carry the person's tokens.
import React from 'react';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { supabase } from './supabase';

export const AUTH_CALLBACK = 'pawspal://auth/callback';
export const AUTH_RESET = 'pawspal://auth/reset';

export type AuthLinkResult = 'signed_in' | 'recovery' | 'error';

/** True for our own sign-in and password-reset links, so other deep links are left alone. */
export const isAuthUrl = (url: string | null | undefined): boolean => !!url && /^pawspal:\/\/auth(\/|\?|#|$)/i.test(url);

interface Parsed { accessToken: string | null; refreshToken: string | null; type: string | null; failed: boolean }

/** Reads the values from the fragment (#...) and the query (?...), the fragment winning. */
export function parseAuthUrl(url: string): Parsed {
  const hashAt = url.indexOf('#');
  const fragment = hashAt >= 0 ? url.slice(hashAt + 1) : '';
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '';
  const values = new Map<string, string>();
  for (const part of [query, fragment]) {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const raw = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
      values.set(raw(eq < 0 ? pair : pair.slice(0, eq)), eq < 0 ? '' : raw(pair.slice(eq + 1)));
    }
  }
  return {
    accessToken: values.get('access_token') || null, refreshToken: values.get('refresh_token') || null,
    type: values.get('type') || null, failed: values.has('error') || values.has('error_code'),
  };
}

/** Signs the person in from an email link. 'recovery' means the link was a password reset. */
export async function handleAuthUrl(url: string): Promise<AuthLinkResult> {
  if (!isAuthUrl(url)) return 'error';
  const p = parseAuthUrl(url);
  if (p.failed || !p.accessToken || !p.refreshToken) return 'error';
  try {
    const { error } = await supabase.auth.setSession({ access_token: p.accessToken, refresh_token: p.refreshToken });
    if (error) return 'error';
  } catch { return 'error'; }
  return p.type === 'recovery' || /^pawspal:\/\/auth\/reset/i.test(url) ? 'recovery' : 'signed_in';
}

let lastHandled: string | null = null;

async function open(url: string | null) {
  if (!url || !isAuthUrl(url) || url === lastHandled) return;
  lastHandled = url;
  const result = await handleAuthUrl(url);
  if (result === 'recovery') router.replace('/reset-password' as never);
  else if (result === 'error') router.replace('/signin' as never);
  // 'signed_in': the screen gate moves the person on once their account is loaded.
}

/** Listens for our links, both the one that opened the app and the ones that arrive while it is open. */
export function useAuthLinks(): void {
  React.useEffect(() => {
    Linking.getInitialURL().then((u) => open(u), () => {});
    const sub = Linking.addEventListener('url', (e) => { open(e.url).catch(() => {}); });
    return () => sub.remove();
  }, []);
}
