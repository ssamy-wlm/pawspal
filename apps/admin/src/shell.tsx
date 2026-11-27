'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth';
import { Turnstile, turnstileSiteKey } from './turnstile';
import { CodesScreen, PasskeyScreen, RecoveryBanner, SetupScreen, StepUpHost } from './passkey-ui';
import { Btn, C, Card, Err, Field, inputStyle } from './ui';
import { needsNewPasskey } from './passkey-rules';
import { forgetEmail, readRememberedEmail, rememberEmail } from './remember-email';
import tokens from './tokens.json';

const NAV: [string, string][] = [
  ['/', 'Overview'], ['/verification', 'Verification'], ['/payments', 'Payments'], ['/reports', 'Reports'], ['/users', 'Users'],
  ['/appeals', 'Appeals'], ['/bookings', 'Bookings'], ['/photos', 'Photo review'], ['/settings', 'Settings'], ['/rules', 'Rules'], ['/audit', 'Audit log'], ['/security', 'Security'],
];

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: C.dark.background }}>
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pawspal-logo.svg" alt="PawsPal Dahab" width={140} height={140} />
        <h1 style={{ margin: 0, fontSize: tokens.font.size.title, color: C.dark.text }}>Admin</h1>
        {children}
      </div>
    </main>
  );
}

function SignIn({ notice }: { notice?: string }) {
  const { signIn } = useAuth();
  const [remembered, setRemembered] = React.useState(() => readRememberedEmail());      // only the address, kept on this device
  const [email, setEmail] = React.useState(remembered);
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(notice ?? null);
  const [token, setToken] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const needsToken = turnstileSiteKey() !== '';
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  // With the address filled in, the cursor goes to the password.
  React.useEffect(() => { if (remembered) passwordRef.current?.focus(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    signIn(email, password, token).then((m) => {
      if (m === null) rememberEmail(email); else setAttempt((n) => n + 1);
      setError(m); setBusy(false);
    }, () => { setError('Could not sign in. Try again.'); setBusy(false); setAttempt((n) => n + 1); });
  };
  return (
    <Card>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Email"><input ref={emailRef} style={inputStyle} type="email" name="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        {remembered ? (
          <button type="button" onClick={() => { forgetEmail(); setRemembered(''); setEmail(''); setPassword(''); emailRef.current?.focus(); }}
            style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 4px', background: 'none', border: 0, color: C.navy, textDecoration: 'underline', fontSize: tokens.font.size.small, fontFamily: 'inherit', cursor: 'pointer' }}>
            Not you? Use another email
          </button>
        ) : null}
        <Field label="Password"><input ref={passwordRef} style={inputStyle} type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Turnstile onToken={setToken} resetKey={attempt} />
        <Err>{error}</Err>
        <Btn kind="accent" type="submit" disabled={busy || !email || !password || (needsToken && !token)}>Sign in</Btn>
      </form>
    </Card>
  );
}

/** Everything the site shows goes through here: nothing but the sign-in screens appears until the database says "admin". */
export function Shell({ children }: { children: React.ReactNode }) {
  return <><StepUpHost /><ShellBody>{children}</ShellBody></>;
}

function ShellBody({ children }: { children: React.ReactNode }) {
  const { state, signOut } = useAuth();
  const path = usePathname();
  if (state.kind === 'loading') return <Centered><p style={{ color: C.dark.textMuted }}>One moment</p></Centered>;
  if (state.kind === 'not_configured') return <Centered><p style={{ color: C.dark.text }}>This site is not connected to Supabase yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.</p></Centered>;
  if (state.kind === 'signed_out') return <Centered><SignIn notice={state.notice} /></Centered>;
  if (state.kind === 'denied') return <Centered><Card><p style={{ margin: 0, color: C.text }}>This account is not an admin. You have been signed out.</p><Btn kind="secondary" onClick={() => window.location.assign('/')}>Back</Btn></Card></Centered>;
  if (state.kind === 'passkey') return <Centered><PasskeyScreen /></Centered>;
  if (state.kind === 'setup') return <Centered><SetupScreen /></Centered>;
  if (state.kind === 'codes') return <Centered><CodesScreen codes={state.codes} /></Centered>;
  return (
    <div className="shell" style={{ display: 'flex', minHeight: '100vh', background: C.background }}>
      <nav aria-label="Main" className="sidenav" style={{ position: 'sticky', top: 0, height: '100vh', overflowY: 'auto', width: 230, flexShrink: 0, background: C.dark.background, color: C.dark.text, padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pawspal-logo.svg" alt="PawsPal Dahab" width={96} height={96} style={{ alignSelf: 'center', marginBottom: 12 }} />
        {NAV.map(([href, label]) => {
          const on = href === '/' ? path === '/' : path.startsWith(href);
          return <Link key={href} href={href} aria-current={on ? 'page' : undefined} style={{ padding: '10px 14px', borderRadius: 12, color: on ? C.dark.onPrimary : C.dark.text, background: on ? C.dark.primary : 'transparent', textDecoration: 'none', fontWeight: on ? 700 : 500, fontSize: tokens.font.size.small }}>{label}</Link>;
        })}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: C.dark.textMuted }}>
          <span style={{ overflowWrap: 'anywhere' }}>{state.email}</span>
          <Btn kind="onDark" onClick={() => { signOut().catch(() => {}); }}>Sign out</Btn>
        </div>
      </nav>
      <main className="page" style={{ flex: 1, minWidth: 0, color: C.text }}>
        {needsNewPasskey(state.via, state.added) ? <RecoveryBanner /> : null}
        {children}
      </main>
    </div>
  );
}
