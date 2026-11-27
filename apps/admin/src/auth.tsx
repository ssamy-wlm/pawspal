'use client';
import React from 'react';
import { createPasskey, endPasskeySession, getStatus, loginWithPasskey, makeRecoveryCodes, recoveryLogin } from './passkey-api';
import { CHECK_FAILED, cleanCode, cleanName, createOncePerSignIn, describeAutoError, describeError, gateFor, signOutEverywhere, type PasskeyStatus } from './passkey-rules';
import { IDLE_LIMIT_MS, isIdle } from './rules';
import { configured, supabase } from './supabase';
import type { Session } from '@supabase/supabase-js';

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'not_configured' }
  | { kind: 'signed_out'; notice?: string }
  | { kind: 'passkey' }
  | { kind: 'setup' }
  | { kind: 'codes'; codes: string[]; email: string }
  | { kind: 'denied' }
  | { kind: 'ready'; email: string; via: PasskeyStatus['via']; added: boolean };

/** Every method answers null when it worked, or the one calm sentence to show. */
interface Ctx {
  state: AuthState;
  signIn(email: string, password: string, captchaToken?: string | null): Promise<string | null>;
  /** `auto` is for the prompt that starts by itself: a closed or refused prompt then answers a calm hint, not an error. */
  signInWithPasskey(auto?: boolean): Promise<string | null>;
  /** True once per sign-in: the passkey screen asks before it starts the prompt by itself. */
  claimAutoPasskey(): boolean;
  signInWithRecoveryCode(code: string): Promise<string | null>;
  /** First passkey: needs the one-time setup code. On success the new recovery codes are shown. */
  setUpPasskey(name: string, setupCode: string): Promise<string | null>;
  /** The recovery codes were saved: go on to the site. */
  finishCodes(): Promise<void>;
  /** A passkey was added from the Security page: the recovery banner can go. */
  passkeyAdded(): void;
  signOut(): Promise<void>;
}
const AuthContext = React.createContext<Ctx | null>(null);
export const useAuth = () => {
  const c = React.useContext(AuthContext);
  if (!c) throw new Error('AuthProvider is missing');
  return c;
};

/** Ends the passkey session on the server, then the Supabase Auth session. Used by the button and by the idle timer. */
export const endSession = () => signOutEverywhere(endPasskeySession, () => supabase().auth.signOut());

/**
 * Signing in takes three things: the email and password (Supabase Auth), a passkey (or a recovery code), and a place in
 * the admins list. The last two are checked by the database on every request, not only here: without the passkey step a
 * session cannot read or change anything, even if someone edited this page.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({ kind: 'loading' });
  const added = React.useRef(false);
  const auto = React.useRef(createOncePerSignIn());

  /**
   * What the person is let into is decided by admin_status. The passkey function's status (only for the recovery banner)
   * is asked at the same time when there is no known answer yet, instead of after it. Right after a passkey or recovery
   * code sign-in the way in is known, so that call is skipped. `known.session` saves a second read of the session.
   */
  const resolve = React.useCallback(async (known: { session?: Session | null; via?: PasskeyStatus['via']; prefetch?: boolean } = {}) => {
    const sb = supabase();
    const session = known.session ?? (await sb.auth.getSession()).data.session;
    if (!session) { setState({ kind: 'signed_out' }); return; }
    const viaCall = known.via === undefined && known.prefetch ? getStatus().then((s) => s.via, () => null) : null;
    const status = await sb.rpc('admin_status');
    const gate = gateFor(status.error ? null : status.data);
    if (gate === 'show') {
      const via = known.via !== undefined ? known.via : await (viaCall ?? getStatus().then((s) => s.via, () => null));      // only for the recovery banner; the site works without it
      setState({ kind: 'ready', email: session.user.email ?? '', via, added: added.current });
      return;
    }
    if (gate === 'passkey') { setState({ kind: 'passkey' }); return; }
    if (gate === 'setup') { setState({ kind: 'setup' }); return; }
    await sb.auth.signOut();
    setState(gate === 'deny' ? { kind: 'denied' } : { kind: 'signed_out', notice: CHECK_FAILED });
  }, []);

  React.useEffect(() => {
    if (!configured()) { setState({ kind: 'not_configured' }); return; }
    resolve({ prefetch: true }).catch(() => setState({ kind: 'signed_out' }));
    const { data } = supabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { added.current = false; auto.current.reset(); setState((s) => (s.kind === 'denied' || (s.kind === 'signed_out' && s.notice) ? s : { kind: 'signed_out' })); }
    });
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
    const timer = window.setInterval(() => { if (isIdle(last, Date.now(), IDLE_LIMIT_MS)) { endSession().catch(() => {}); } }, 30_000);
    return () => { events.forEach((e) => window.removeEventListener(e, touch)); window.clearInterval(timer); };
  }, [ready]);

  const value: Ctx = {
    state,
    async signIn(email, password, captchaToken) {
      const { data, error } = await supabase().auth.signInWithPassword({ email: email.trim(), password, options: captchaToken ? { captchaToken } : undefined });
      if (error) return 'The email or password is not right.';      // one answer for every failure, so it says nothing about who exists
      added.current = false;
      auto.current.reset();      // a new sign-in: the passkey prompt may start by itself once
      await resolve({ session: data.session });
      return null;
    },
    claimAutoPasskey: () => auto.current.claim(),
    async signInWithPasskey(isAuto = false) {
      try { await loginWithPasskey(); await resolve({ via: 'passkey' }); return null; } catch (e) { return isAuto ? describeAutoError(e) : describeError(e); }
    },
    async signInWithRecoveryCode(code) {
      try { await recoveryLogin(cleanCode(code)); await resolve({ via: 'recovery' }); return null; } catch (e) { return describeError(e); }
    },
    async setUpPasskey(name, setupCode) {
      try {
        await createPasskey(cleanName(name), cleanCode(setupCode));
        added.current = true;
        let codes: string[];
        try { codes = await makeRecoveryCodes(); } catch { await resolve(); return null; }      // the passkey exists: go on, and make codes on the Security page
        const { data } = await supabase().auth.getSession();
        setState({ kind: 'codes', codes, email: data.session?.user.email ?? '' });
        return null;
      } catch (e) { return describeError(e); }
    },
    async finishCodes() { await resolve(); },
    passkeyAdded() { added.current = true; setState((s) => (s.kind === 'ready' ? { ...s, added: true } : s)); },
    async signOut() { await endSession(); setState({ kind: 'signed_out' }); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
