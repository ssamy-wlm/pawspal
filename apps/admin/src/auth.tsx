'use client';
import React from 'react';
import { cleanCode, gateFor, IDLE_LIMIT_MS, isIdle } from './rules';
import { configured, supabase } from './supabase';

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'not_configured' }
  | { kind: 'signed_out' }
  | { kind: 'enroll'; factorId: string; qr: string; secret: string }
  | { kind: 'ask_code'; factorId: string }
  | { kind: 'denied' }
  | { kind: 'ready'; email: string };

interface Ctx {
  state: AuthState;
  signIn(email: string, password: string, captchaToken?: string | null): Promise<string | null>;
  submitCode(code: string): Promise<string | null>;
  signOut(): Promise<void>;
}
const AuthContext = React.createContext<Ctx | null>(null);
export const useAuth = () => {
  const c = React.useContext(AuthContext);
  if (!c) throw new Error('AuthProvider is missing');
  return c;
};

/**
 * Signing in takes three things: the email and password (Supabase Auth), the six digit code from an authenticator app, and
 * a place in the admins list. The last two are checked by the database on every request, not only here: without the code
 * a session cannot read or change anything, even if someone edited this page.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({ kind: 'loading' });
  const factor = React.useRef<string | null>(null);

  const resolve = React.useCallback(async () => {
    const sb = supabase();
    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session) { setState({ kind: 'signed_out' }); return; }
    const status = await sb.rpc('admin_status');
    const gate = gateFor(status.error ? null : (status.data as string));
    if (gate === 'show') { setState({ kind: 'ready', email: session.user.email ?? '' }); return; }
    if (gate === 'deny') { await sb.auth.signOut(); setState({ kind: 'denied' }); return; }
    const factors = await sb.auth.mfa.listFactors();
    const verified = factors.data?.totp?.[0];                                   // verified authenticator-app factors only
    if (verified) { factor.current = verified.id; setState({ kind: 'ask_code', factorId: verified.id }); return; }
    for (const f of factors.data?.all ?? []) if (f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });
    const enrolled = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'PawsPal admin' });
    if (enrolled.error || !enrolled.data) { setState({ kind: 'signed_out' }); return; }
    factor.current = enrolled.data.id;
    setState({ kind: 'enroll', factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
  }, []);

  React.useEffect(() => {
    if (!configured()) { setState({ kind: 'not_configured' }); return; }
    resolve().catch(() => setState({ kind: 'signed_out' }));
    const { data } = supabase().auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') setState((s) => (s.kind === 'denied' ? s : { kind: 'signed_out' })); });
    return () => data.subscription.unsubscribe();
  }, [resolve]);

  // Sign out after 30 minutes without a click or key press.
  const ready = state.kind === 'ready';
  React.useEffect(() => {
    if (!ready) return;
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const events = ['click', 'keydown', 'pointerdown'] as const;
    events.forEach((e) => window.addEventListener(e, touch));
    const timer = window.setInterval(() => { if (isIdle(last, Date.now(), IDLE_LIMIT_MS)) { supabase().auth.signOut().catch(() => {}); } }, 30_000);
    return () => { events.forEach((e) => window.removeEventListener(e, touch)); window.clearInterval(timer); };
  }, [ready]);

  const value: Ctx = {
    state,
    async signIn(email, password, captchaToken) {
      const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password, options: captchaToken ? { captchaToken } : undefined });
      if (error) return 'The email or password is not right.';      // one answer for every failure, so it says nothing about who exists
      await resolve();
      return null;
    },
    async submitCode(raw) {
      const code = cleanCode(raw);
      if (!code) return 'Enter the six digit code.';
      const id = factor.current;
      if (!id) return 'Start again.';
      const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: id, code });
      if (error) return 'That code is not right. Wait for the next one and try again.';
      await resolve();
      return null;
    },
    async signOut() { await supabase().auth.signOut(); setState({ kind: 'signed_out' }); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
