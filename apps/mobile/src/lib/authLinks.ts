// Turns the links in our emails into a signed-in session. Nothing here is ever logged: the links carry the person's tokens.
import React from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { supabase } from './supabase';

const NATIVE_CALLBACK = 'pawspal://auth/callback';
const NATIVE_RESET = 'pawspal://auth/reset';

/** The web address the page is served from (https://app.example.com), or null on a phone. */
export const webOrigin = (): string | null =>
  Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null' ? window.location.origin : null;

/** Where the sign-up email's link must open: the web page on the web, the app (pawspal://) on a phone. */
export const authCallbackUrl = (): string => { const o = webOrigin(); return o ? `${o}/auth/callback` : NATIVE_CALLBACK; };
/** Where the password-reset email's link must open. */
export const authResetUrl = (): string => { const o = webOrigin(); return o ? `${o}/auth/reset` : NATIVE_RESET; };

export type AuthLinkResult = 'signed_in' | 'recovery' | 'error';

/** Which of our links this is: sign-in/confirm ('callback'), password reset ('reset'), or neither. Phone links and this site's own web links count; other sites' links never do. */
export function authLinkKind(url: string | null | undefined): 'callback' | 'reset' | 'other' | null {
  if (!url) return null;
  let path: string | null = null;
  const native = url.match(/^pawspal:\/\/auth(?:\/([^/?#]*))?(?:[?#]|$)/i);
  if (native) path = native[1] ?? '';
  else {
    const origin = webOrigin();
    if (origin && url.toLowerCase().startsWith(`${origin.toLowerCase()}/auth`)) {
      const m = url.slice(origin.length).match(/^\/auth(?:\/([^/?#]*))?\/?(?:[?#]|$)/i);
      if (m) path = m[1] ?? '';
    }
  }
  if (path === null) return null;
  const p = path.toLowerCase();
  return p === 'reset' ? 'reset' : p === 'callback' ? 'callback' : 'other';
}

/** True for our own sign-in and password-reset links, so other deep links are left alone. */
export const isAuthUrl = (url: string | null | undefined): boolean => authLinkKind(url) !== null;

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
  return p.type === 'recovery' || authLinkKind(url) === 'reset' ? 'recovery' : 'signed_in';
}

let lastHandled: string | null = null;

async function open(url: string | null) {
  if (!url || !isAuthUrl(url) || url === lastHandled) return;
  lastHandled = url;
  const result = await handleAuthUrl(url);
  forgetTokensInAddressBar();
  if (result === 'recovery') router.replace('/reset-password' as never);
  else if (result === 'error') router.replace('/signin' as never);
  // 'signed_in': the screen gate moves the person on once their account is loaded.
}

/** Web only: once the tokens are used, take them out of the address bar and the history so they are not left lying around. */
export function forgetTokensInAddressBar(): void {
  if (!webOrigin() || typeof window.history?.replaceState !== 'function') return;
  try { window.history.replaceState(window.history.state, '', window.location.pathname); } catch { /* nothing to clean */ }
}

/** Listens for our links, both the one that opened the app and the ones that arrive while it is open. */
export function useAuthLinks(): void {
  React.useEffect(() => {
    // On the web the link is the page's own address; read it straight away, before anything else changes it.
    if (webOrigin()) open(window.location.href).catch(() => {});
    else Linking.getInitialURL().then((u) => open(u), () => {});
    const sub = Linking.addEventListener('url', (e) => { open(e.url).catch(() => {}); });
    return () => sub.remove();
  }, []);
}
