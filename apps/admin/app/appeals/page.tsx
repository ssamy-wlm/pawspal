'use client';
import React from 'react';
import { decideAppeal, getOpenAppeals, refusal, type AppealRow } from '../../src/data';
import { Badge, Btn, C, Card, Err, Field, H1, inputStyle, Muted, pageStyle, PersonLink, Status, useLoad, when } from '../../src/ui';

function Appeal({ a, onDone }: { a: AppealRow; onDone: () => void }) {
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<boolean | null>(null);
  const decide = async (upheld: boolean) => {
    if (pending !== upheld) { if (!upheld && message.trim() === '') { setError('Write the reason the person will read.'); return; } setPending(upheld); setError(null); return; }
    setBusy(true); setError(null);
    try { await decideAppeal(a.id, upheld, message); onDone(); } catch (e) { setError(refusal(e)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <PersonLink id={a.user_id} name={a.user?.first_name} />
        <Badge tone="warn">appealing a {a.action?.action ?? 'decision'}</Badge>
        <span style={{ color: C.textMuted, fontSize: 14 }}>{when(a.created_at)}</span>
      </div>
      {a.action?.rule ? <Muted>Rule: {a.action.rule}</Muted> : null}
      {a.action?.message ? <Muted>Our message: {a.action.message}</Muted> : null}
      <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{a.body}</p>
      <Field label="Message to the person (required if you keep the decision)"><textarea style={{ ...inputStyle, minHeight: 60 }} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      <Err>{error}</Err>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn disabled={busy} onClick={() => { decide(true).catch(() => {}); }}>{pending === true ? 'Yes, reinstate the account' : 'Reinstate the account'}</Btn>
        <Btn kind="secondary" disabled={busy} onClick={() => { decide(false).catch(() => {}); }}>{pending === false ? 'Yes, keep the decision' : 'Keep the decision'}</Btn>
        {pending !== null ? <Btn kind="secondary" onClick={() => setPending(null)}>Cancel</Btn> : null}
      </div>
    </Card>
  );
}

export default function Appeals() {
  const list = useLoad(getOpenAppeals, []);
  return (
    <div style={pageStyle}>
      <H1 sub="People who asked a person to look again. Reinstating lifts the suspension or removal; keeping the decision leaves it as it is.">Appeals</H1>
      <Status l={list} />
      {!list.loading && list.data && list.data.length === 0 ? <Muted>No open appeals.</Muted> : null}
      {(list.data ?? []).map((a) => <Appeal key={a.id} a={a} onDone={list.reload} />)}
    </div>
  );
}
