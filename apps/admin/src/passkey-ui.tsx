'use client';
import React from 'react';
import Link from 'next/link';
import { useAuth } from './auth';
import { setStepUpPrompter } from './passkey-api';
import { describeError, DEFAULT_PASSKEY_NAME, sessionCodeFromToken, recoveryCodesText, validateCode, validatePasskeyName } from './passkey-rules';
import { SESSION_RAN_OUT } from './session-watch';
import { supabase } from './supabase';
import { Btn, C, Card, Err, Field, inputStyle, Muted } from './ui';
import tokens from './tokens.json';

const p = { margin: 0, color: C.text, fontSize: tokens.font.size.body, lineHeight: 1.45 } as const;
const col = { display: 'flex', flexDirection: 'column', gap: 12 } as const;

/** Runs a screen action, locks the buttons while it works and shows the one-line answer. */
function useAction() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = (fn: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true); setError(null);
    fn().then((m) => { setError(m); setBusy(false); }, () => { setError('Something went wrong. Try again in a moment.'); setBusy(false); });
  };
  return { busy, error, setError, run };
}

/** "Session code: XXXXXXXX", to match against the emergency SQL (SETUP.md E10). Hidden when the token has no session id. */
function SessionCode() {
  const [code, setCode] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    supabase().auth.getSession().then(({ data }) => { if (live) setCode(sessionCodeFromToken(data.session?.access_token)); }, () => {});
    return () => { live = false; };
  }, []);
  return code ? <p style={{ margin: 0, color: C.textMuted, fontSize: tokens.font.size.caption }}>Session code: <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>{code}</span></p> : null;
}

/** Shown after a sign-in with email and password when the account already has a passkey. */
export function PasskeyScreen() {
  const { state, signInWithPasskey, signInWithRecoveryCode, signOut, claimAutoPasskey } = useAuth();
  const a = useAction();
  // Right after the password step the prompt starts by itself, once per sign-in: the guard lives in the auth provider, so
  // a second effect run, a re-render or coming back from the recovery or setup code never starts it again, and a closed or
  // failed prompt is not repeated. The button below is always there; it is the only way to try again.
  React.useEffect(() => {
    if (claimAutoPasskey()) a.run(() => signInWithPasskey(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [recovery, setRecovery] = React.useState(false);
  const [setup, setSetup] = React.useState(false);
  const [code, setCode] = React.useState('');
  if (setup) return <SetupScreen onBack={() => setSetup(false)} />;
  return (
    <Card>
      <h2 style={{ margin: 0, fontSize: tokens.font.size.title, color: C.text }}>Use your passkey</h2>
      <p style={p}>{state.kind === 'passkey' && state.ranOut ? SESSION_RAN_OUT : 'Confirm it is you with Face ID, your fingerprint, Windows Hello or your device PIN.'}</p>
      <Btn big full kind="accent" disabled={a.busy} onClick={() => a.run(signInWithPasskey)}>{a.busy && !recovery ? 'Waiting for your passkey' : 'Use your passkey'}</Btn>
      {recovery ? (
        <form onSubmit={(e) => { e.preventDefault(); const bad = validateCode(code, 'recovery'); if (bad) { a.setError(bad); return; } a.run(() => signInWithRecoveryCode(code)); }} style={col}>
          <Field label="Recovery code"><input style={inputStyle} autoComplete="off" autoCapitalize="none" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Muted>Each code works once. After you use one, add a new passkey right away.</Muted>
          <Btn type="submit" disabled={a.busy || code.trim() === ''}>Use this code</Btn>
        </form>
      ) : null}
      <Err>{a.error}</Err>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {recovery ? null : <Btn kind="secondary" disabled={a.busy} onClick={() => { setRecovery(true); a.setError(null); }}>Use a recovery code</Btn>}
        <Btn kind="secondary" disabled={a.busy} onClick={() => { setSetup(true); a.setError(null); }}>I have a setup code</Btn>
        <Btn kind="secondary" disabled={a.busy} onClick={() => { signOut().catch(() => {}); }}>Sign out</Btn>
      </div>
      <SessionCode />
    </Card>
  );
}

/** The first passkey: the one-time setup code from the SQL Editor, then the device prompt. */
export function SetupScreen({ onBack }: { onBack?: () => void } = {}) {
  const { setUpPasskey, signOut } = useAuth();
  const a = useAction();
  const [setupCode, setSetupCode] = React.useState('');
  const [name, setName] = React.useState(DEFAULT_PASSKEY_NAME);
  return (
    <Card>
      <h2 style={{ margin: 0, fontSize: tokens.font.size.title, color: C.text }}>Set up your passkey</h2>
      <p style={p}>A passkey lets this device prove it is you with Face ID, a fingerprint or Windows Hello, so no code is needed.</p>
      <p style={p}>Ask for a one-time setup code in the Supabase SQL Editor (SETUP.md, section E10), type it here, then confirm on your device.</p>
      <form onSubmit={(e) => {
        e.preventDefault();
        const bad = validateCode(setupCode, 'setup') ?? validatePasskeyName(name);
        if (bad) { a.setError(bad); return; }
        a.run(() => setUpPasskey(name, setupCode));
      }} style={col}>
        <Field label="Setup code"><input style={inputStyle} autoComplete="off" autoCapitalize="none" spellCheck={false} value={setupCode} onChange={(e) => setSetupCode(e.target.value)} /></Field>
        <Field label="Name of this device"><input style={inputStyle} autoComplete="off" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Err>{a.error}</Err>
        <Btn big full kind="accent" type="submit" disabled={a.busy || setupCode.trim() === ''}>{a.busy ? 'Waiting for your device' : 'Create passkey'}</Btn>
      </form>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {onBack ? <Btn kind="secondary" disabled={a.busy} onClick={onBack}>Back</Btn> : null}
        <Btn kind="secondary" disabled={a.busy} onClick={() => { signOut().catch(() => {}); }}>Sign out</Btn>
      </div>
      <SessionCode />
    </Card>
  );
}

/** The ten recovery codes, shown once. "Continue" stays off until the person says they saved them. */
export function RecoveryCodes({ codes, onContinue, continueLabel = 'Continue' }: { codes: string[]; onContinue: () => void | Promise<void>; continueLabel?: string }) {
  const [saved, setSaved] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const text = recoveryCodesText(codes);
  const copy = () => {
    // The clipboard can be blocked; then the codes are still on the screen and in the file.
    navigator.clipboard.writeText(codes.join('\n')).then(() => setNote('Copied.'), () => setNote('Could not copy. Select the codes or download the file.'));
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'pawspal-admin-recovery-codes.txt';
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote('The file was downloaded.');
  };
  return (
    <Card>
      <h2 style={{ margin: 0, fontSize: tokens.font.size.title, color: C.text }}>Save your recovery codes</h2>
      <p style={p}>Each code works once. Keep them offline or in a password manager. They are the way in if both of your devices are lost.</p>
      <ol aria-label="Recovery codes" style={{ margin: 0, padding: '12px 12px 12px 36px', background: C.surfaceTint, borderRadius: tokens.radius.input, color: C.text, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: tokens.font.size.body, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '6px 16px' }}>
        {codes.map((c) => <li key={c} style={{ overflowWrap: 'anywhere' }}>{c}</li>)}
      </ol>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn kind="secondary" onClick={copy}>Copy</Btn>
        <Btn kind="secondary" onClick={download}>Download as text file</Btn>
      </div>
      <p role="status" style={{ margin: 0, color: C.textMuted, fontSize: tokens.font.size.small, minHeight: 20 }}>{note}</p>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', color: C.text, fontWeight: 600, minHeight: 44 }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ width: 22, height: 22, accentColor: C.navy }} />
        I saved these codes somewhere safe
      </label>
      <Btn kind="accent" disabled={!saved || busy} onClick={() => { setBusy(true); Promise.resolve(onContinue()).catch(() => {}).finally(() => setBusy(false)); }}>{continueLabel}</Btn>
    </Card>
  );
}

/** After sign-in, the codes are shown full screen; "Continue" opens the site. */
export function CodesScreen({ codes }: { codes: string[] }) {
  const { finishCodes } = useAuth();
  return <RecoveryCodes codes={codes} onContinue={finishCodes} />;
}

/** On every page until a passkey was added after a recovery code sign-in. */
export function RecoveryBanner() {
  return (
    <div role="alert" style={{ background: C.tint.orange, color: C.navy, padding: '12px 32px', fontWeight: 600, borderBottom: `2px solid ${C.accent}` }}>
      You came in with a recovery code. <Link href="/security" style={{ color: C.navy, textDecoration: 'underline' }}>Add a new passkey now.</Link>
    </div>
  );
}

/**
 * The small dialog for "touch your passkey again". Mounted once; passkey-api asks it to run a step-up and waits. Cancelling
 * rejects with the "closed" kind, so the screen that asked shows its calm one-line message and stops.
 */
export function StepUpHost() {
  const [ask, setAsk] = React.useState<{ run: () => Promise<void>; done: () => void; cancel: () => void } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setStepUpPrompter((run) => new Promise<void>((resolve, reject) => {
      setError(null); setBusy(false);
      setAsk({ run, done: () => { setAsk(null); resolve(); }, cancel: () => { setAsk(null); reject({ kind: 'cancelled' }); } });
    }));
    return () => setStepUpPrompter(null);
  }, []);
  if (!ask) return null;
  const touch = () => { setBusy(true); setError(null); ask.run().then(() => { setBusy(false); ask.done(); }, (e) => { setBusy(false); setError(describeError(e)); }); };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(31,45,61,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 50 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="stepup-title" style={{ background: C.surface, borderRadius: tokens.radius.card, padding: 24, maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 id="stepup-title" style={{ margin: 0, fontSize: tokens.font.size.title, color: C.text }}>Touch your passkey to continue</h2>
        <p style={p}>This change needs a fresh check that it is you. It takes a second.</p>
        <Err>{error}</Err>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn kind="accent" disabled={busy} onClick={touch}>{busy ? 'Waiting for your passkey' : 'Touch your passkey'}</Btn>
          <Btn kind="secondary" disabled={busy} onClick={ask.cancel}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}
