'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth';
import { Turnstile, turnstileSiteKey } from './turnstile';
import { Btn, C, Card, Err, Field, inputStyle } from './ui';
import tokens from './tokens.json';

const NAV: [string, string][] = [
  ['/', 'Overview'], ['/reports', 'Reports'], ['/users', 'Users'], ['/approvals', 'Approvals'], ['/appeals', 'Appeals'],
  ['/bookings', 'Bookings'], ['/photos', 'Photo review'], ['/rules', 'Rules'], ['/audit', 'Audit log'],
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

function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
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
        <Btn type="submit" disabled={busy || !email || !password || (needsToken && !token)}>Sign in</Btn>
      </form>
    </Card>
  );
}

function Code({ enroll }: { enroll?: { qr: string; secret: string } }) {
  const { submitCode, signOut } = useAuth();
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Card>
      {enroll ? (
        <>
          <p style={{ margin: 0, color: C.text }}>First sign-in: scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar), then enter the six digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="QR code for your authenticator app" width={200} height={200} style={{ alignSelf: 'center', background: C.surface, padding: 8, borderRadius: 12 }} />
          <p style={{ margin: 0, color: C.textMuted, fontSize: 13 }}>Cannot scan? Type this key into the app: <code style={{ overflowWrap: 'anywhere' }}>{enroll.secret}</code></p>
        </>
      ) : <p style={{ margin: 0, color: C.text }}>Enter the six digit code from your authenticator app.</p>}
      <form onSubmit={(e) => { e.preventDefault(); setBusy(true); setError(null); submitCode(code).then((m) => { setError(m); setBusy(false); }, () => { setError('Could not check the code. Try again.'); setBusy(false); }); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Code"><input style={inputStyle} inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Err>{error}</Err>
        <Btn type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6}>Continue</Btn>
      </form>
      <Btn kind="secondary" onClick={() => { signOut().catch(() => {}); }}>Sign out</Btn>
    </Card>
  );
}

/** Everything the site shows goes through here: nothing but the sign-in screens appears until the database says "admin". */
export function Shell({ children }: { children: React.ReactNode }) {
  const { state, signOut } = useAuth();
  const path = usePathname();
  if (state.kind === 'loading') return <Centered><p style={{ color: C.dark.textMuted }}>One moment</p></Centered>;
  if (state.kind === 'not_configured') return <Centered><p style={{ color: C.dark.text }}>This site is not connected to Supabase yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.</p></Centered>;
  if (state.kind === 'signed_out') return <Centered><SignIn /></Centered>;
  if (state.kind === 'denied') return <Centered><Card><p style={{ margin: 0, color: C.text }}>This account is not an admin. You have been signed out.</p><Btn kind="secondary" onClick={() => window.location.assign('/')}>Back</Btn></Card></Centered>;
  if (state.kind === 'enroll') return <Centered><Code enroll={{ qr: state.qr, secret: state.secret }} /></Centered>;
  if (state.kind === 'ask_code') return <Centered><Code /></Centered>;
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.background }}>
      <nav aria-label="Main" style={{ width: 230, flexShrink: 0, background: C.dark.background, color: C.dark.text, padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pawspal-logo.svg" alt="PawsPal Dahab" width={96} height={96} style={{ alignSelf: 'center', marginBottom: 12 }} />
        {NAV.map(([href, label]) => {
          const on = href === '/' ? path === '/' : path.startsWith(href);
          return <Link key={href} href={href} aria-current={on ? 'page' : undefined} style={{ padding: '10px 14px', borderRadius: 12, color: on ? C.dark.onPrimary : C.dark.text, background: on ? C.dark.primary : 'transparent', textDecoration: 'none', fontWeight: on ? 700 : 500, fontSize: tokens.font.size.small }}>{label}</Link>;
        })}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: C.dark.textMuted }}>
          <span style={{ overflowWrap: 'anywhere' }}>{state.email}</span>
          <button onClick={() => { signOut().catch(() => {}); }} style={{ minHeight: 40, borderRadius: 999, border: `2px solid ${C.dark.primary}`, background: 'transparent', color: C.dark.text, fontWeight: 600, cursor: 'pointer' }}>Sign out</button>
        </div>
      </nav>
      <main style={{ flex: 1, minWidth: 0, color: C.text }}>{children}</main>
    </div>
  );
}
