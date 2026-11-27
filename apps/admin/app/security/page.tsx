'use client';
import React from 'react';
import { useAuth } from '../../src/auth';
import { createPasskey, getStatus, makeRecoveryCodes, removePasskey, renamePasskey } from '../../src/passkey-api';
import { canRemovePasskey, codesLeftText, describeError, LAST_PASSKEY_NOTE, needsNewPasskey, passkeyHint, validatePasskeyName, type PasskeyRow } from '../../src/passkey-rules';
import { RecoveryCodes } from '../../src/passkey-ui';
import { Badge, Btn, Card, C, Err, Field, H1, H2, inputStyle, Muted, pageStyle, Status, useLoad, when } from '../../src/ui';

function PasskeyItem({ p, count, onChanged }: { p: PasskeyRow; count: number; onChanged: () => void }) {
  const [mode, setMode] = React.useState<'view' | 'rename' | 'remove'>('view');
  const [name, setName] = React.useState(p.name);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const work = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); setMode('view'); onChanged(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  };
  const last = !canRemovePasskey(count);
  return (
    <Card>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ color: C.text }}>{p.name}</strong>
        <Badge tone="neutral">{passkeyHint(p)}</Badge>
      </div>
      <Muted>Added {when(p.created_at)}. {p.last_used_at ? `Last used ${when(p.last_used_at)}.` : 'Not used yet.'}</Muted>
      {mode === 'rename' ? (
        <form onSubmit={(e) => { e.preventDefault(); const bad = validatePasskeyName(name); if (bad) { setError(bad); return; } work(() => renamePasskey(p.id, name.replace(/\s+/g, ' ').trim())).catch(() => {}); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Field label="New name"><input style={inputStyle} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn type="submit" disabled={busy}>Save name</Btn>
            <Btn kind="secondary" disabled={busy} onClick={() => { setMode('view'); setName(p.name); setError(null); }}>Cancel</Btn>
          </div>
        </form>
      ) : mode === 'remove' ? (
        <div role="alertdialog" aria-label={`Remove ${p.name}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, color: C.text }}>Remove the passkey &quot;{p.name}&quot;? It will stop working at once.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn kind="danger" disabled={busy} onClick={() => { work(() => removePasskey(p.id)).catch(() => {}); }}>Yes, remove it</Btn>
            <Btn kind="secondary" disabled={busy} onClick={() => { setMode('view'); setError(null); }}>Cancel</Btn>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn kind="secondary" onClick={() => setMode('rename')}>Rename</Btn>
          <Btn kind="secondary" disabled={last} onClick={() => setMode('remove')}>Remove</Btn>
        </div>
      )}
      {last && mode === 'view' ? <Muted>{LAST_PASSKEY_NOTE}</Muted> : null}
      <Err>{error}</Err>
    </Card>
  );
}

function AddPasskey({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  return (
    <Card>
      <H2>Add a passkey on this device</H2>
      <Muted>Give it a name you will recognise, like &quot;My iPhone&quot; or &quot;My laptop&quot;. Then confirm on this device.</Muted>
      <form onSubmit={(e) => {
        e.preventDefault();
        const bad = validatePasskeyName(name);
        if (bad) { setError(bad); return; }
        setBusy(true); setError(null); setDone(false);
        createPasskey(name.replace(/\s+/g, ' ').trim()).then(() => { setName(''); setDone(true); onAdded(); }, (er) => setError(describeError(er))).finally(() => setBusy(false));
      }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Name of this device"><input style={inputStyle} value={name} maxLength={60} placeholder="My laptop" onChange={(e) => setName(e.target.value)} /></Field>
        <Err>{error}</Err>
        {done ? <p role="status" style={{ margin: 0, color: C.primary, fontWeight: 600 }}>Passkey added.</p> : null}
        <div><Btn kind="accent" type="submit" disabled={busy || name.trim() === ''}>{busy ? 'Waiting for your device' : 'Add a passkey'}</Btn></div>
      </form>
    </Card>
  );
}

function Codes({ left, onChanged }: { left: number; onChanged: () => void }) {
  const [step, setStep] = React.useState<'idle' | 'sure' | 'show'>('idle');
  const [codes, setCodes] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (step === 'show') return <RecoveryCodes codes={codes} continueLabel="Done" onContinue={() => { setCodes([]); setStep('idle'); onChanged(); }} />;
  return (
    <Card>
      <H2>Recovery codes</H2>
      <p style={{ margin: 0, color: C.text }}>{codesLeftText(left)}</p>
      <Muted>A recovery code gets you in if both of your devices are lost. Each one works once.</Muted>
      {step === 'sure' ? (
        <div role="alertdialog" aria-label="Make new recovery codes" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, color: C.text }}>Make new codes? The old codes stop working at once.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn kind="danger" disabled={busy} onClick={() => { setBusy(true); setError(null); makeRecoveryCodes().then((c) => { setCodes(c); setStep('show'); }, (e) => setError(describeError(e))).finally(() => setBusy(false)); }}>Yes, make new codes</Btn>
            <Btn kind="secondary" disabled={busy} onClick={() => { setStep('idle'); setError(null); }}>Cancel</Btn>
          </div>
        </div>
      ) : <div><Btn kind="secondary" onClick={() => setStep('sure')}>Make new codes</Btn></div>}
      <Err>{error}</Err>
    </Card>
  );
}

export default function Security() {
  const { state, passkeyAdded } = useAuth();
  const list = useLoad(getStatus, []);
  const s = list.data;
  const recovery = state.kind === 'ready' && needsNewPasskey(s?.via ?? state.via, state.added);
  return (
    <div style={pageStyle}>
      <H1 sub="The passkeys that open this site, and your recovery codes.">Security</H1>
      {recovery ? (
        <div role="alert" style={{ background: C.tint.orange, color: C.navy, borderRadius: 16, padding: 16, border: `2px solid ${C.accent}`, fontWeight: 600 }}>
          You came in with a recovery code. Add a new passkey now.
        </div>
      ) : null}
      <Status l={list} />
      {s ? (
        <>
          <H2>Your passkeys</H2>
          {s.passkeys.length === 0 ? <Muted>No passkeys yet.</Muted> : null}
          {s.passkeys.map((p) => <PasskeyItem key={p.id} p={p} count={s.passkeys.length} onChanged={list.reload} />)}
          <AddPasskey onAdded={() => { passkeyAdded(); list.reload(); }} />
          <Codes left={s.recovery_codes_left} onChanged={list.reload} />
        </>
      ) : null}
    </div>
  );
}
