'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth';
import { Turnstile, turnstileSiteKey } from './turnstile';
import { CodesScreen, PasskeyScreen, RecoveryBanner, SetupScreen } from './passkey-ui';
import { Btn, C, Card, Err, Field, inputStyle } from './ui';
import { needsNewPasskey } from './passkey-rules';
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
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(notice ?? null);
  const [token, setToken] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const needsToken = turnstileSiteKey() !== '';
  return (
    <Card>
      <form onSubmit={(e) => { e.preventDefault(); setBusy(true); setError(null); signIn(email, password, token).then((m) => { setError(m); setBusy(false); if (m) setAttempt((n) => n + 1); }, () => { setError('Could not sign in. Try again.'); setBusy(false); setAttempt((n) => n + 1); }); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Email"><input style={inputStyle} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password"><input style={inputStyle} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Turnstile onToken={setToken} resetKey={attempt} />
        <Err>{error}</Err>
        <Btn kind="accent" type="submit" disabled={busy || !email || !password || (needsToken && !token)}>Sign in</Btn>
      </form>
    </Card>
  );
}

/** Everything the site shows goes through here: nothing but the sign-in screens appears until the database says "admin". */
export function Shell({ children }: { children: React.ReactNode }) {
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
