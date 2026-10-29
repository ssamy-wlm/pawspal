import React from 'react';
import { router, useSegments } from 'expo-router';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { routeFor, SignupState } from './gate';

interface AuthValue {
  ready: boolean;
  session: Session | null;
  state: SignupState | null;
  refresh: () => Promise<SignupState | null>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthValue>({ ready: false, session: null, state: null, refresh: async () => null, signOut: async () => {} });
export const useAuth = () => React.useContext(AuthContext);

/** Keeps the session and the person's sign-up state, and sends them to the right screen. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [session, setSession] = React.useState<Session | null>(null);
  const [state, setState] = React.useState<SignupState | null>(null);
  const segments = useSegments();

  const refresh = React.useCallback(async () => {
    const { data, error } = await supabase.rpc('my_signup_state');
    const next = error ? null : (data as SignupState);
    setState(next);
    return next;
  }, []);

  React.useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(({ data }) => { if (live) { setSession(data.session); setReady(true); } }).catch(() => { if (live) setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => { setSession(s); if (!s) setState(null); });
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, []);

  const userId = session?.user.id;
  React.useEffect(() => {
    if (!userId) return;
    let live = true;
    supabase.rpc('my_signup_state').then(({ data, error }) => { if (live) setState(error ? null : (data as SignupState)); }, () => {});
    return () => { live = false; };
  }, [userId]);

  const signOut = React.useCallback(async () => { await supabase.auth.signOut(); setState(null); }, []);

  const target = ready ? routeFor(!!session, state, segments as string[]) : null;
  React.useEffect(() => { if (target) router.replace(target as never); }, [target]);

  const value = React.useMemo(() => ({ ready, session, state, refresh, signOut }), [ready, session, state, refresh, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
