'use client';
import React from 'react';
import { decideVerification, getPendingVerifications, refusal, type VerificationRow } from '../../src/data';
import { OVERDUE_HOURS, hoursWaiting, nice, waitingText } from '../../src/rules';
import { Badge, Btn, Card, Err, Field, H1, inputStyle, Muted, pageStyle, Photo, PersonLink, Status, useLoad, when } from '../../src/ui';

const LEFT_OVER = 'The decision is saved. The ID file will be deleted by the nightly clean-up.';

function Request({ r, onDone }: { r: VerificationRow; onDone: () => void }) {
  const p = r.profile;
  const name = p?.first_name ?? 'this person';
  const hours = hoursWaiting(r.submitted_at);
  const late = hours > OVERDUE_HOURS;
  const [adult, setAdult] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [sure, setSure] = React.useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);

  const decide = async (approve: boolean) => {
    if (approve && !adult) { setError('Tick the box to confirm the person is 18 or older and the photos match.'); return; }
    if (!approve && note.trim() === '') { setError('Write the reason. The person will read it.'); return; }
    if (sure !== (approve ? 'approve' : 'reject')) { setSure(approve ? 'approve' : 'reject'); setError(null); return; }
    setBusy(true); setError(null);
    try {
      const res = await decideVerification(r.user_id, approve, approve && adult, approve ? '' : note);
      if (res.fileLeft) { setWarning(LEFT_OVER); setSure(null); setBusy(false); return; }
      onDone();
    } catch (e) { setError(refusal(e)); setSure(null); setBusy(false); }
  };

  if (warning) return <Card><strong>{name}</strong><p role="status" style={{ margin: 0 }}>{warning}</p><Btn kind="secondary" onClick={onDone}>Done</Btn></Card>;
  return (
    <Card style={late ? { borderColor: 'currentColor' } : undefined}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Photo bucket="faces" path={r.face_path} alt={`Selfie of ${name}`} size={200} />
          <Muted>Selfie</Muted>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Photo bucket="ids" path={r.id_path} alt={`ID photo of ${name}`} size={200} />
          <Muted>ID photo</Muted>
        </div>
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong style={{ fontSize: 20 }}>{p ? <PersonLink id={p.id} name={p.first_name} /> : 'No name'}</strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge>{nice(p?.role)}</Badge>
            <Badge tone={late ? 'warn' : 'neutral'}>{waitingText(hours)}</Badge>
          </div>
          <Muted>Sent {when(r.submitted_at)}{p?.area ? ` · ${p.area}` : ''}</Muted>
          {p?.bio ? <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{p.bio}</p> : null}
        </div>
      </div>
      <Muted>ID photos are deleted as soon as you decide.</Muted>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600, minHeight: 44 }}>
        <input type="checkbox" checked={adult} onChange={(e) => { setAdult(e.target.checked); setSure(null); setError(null); }} style={{ width: 22, height: 22 }} />
        I checked that the person is 18 or older and that the photos match
      </label>
      <Field label="Reason (needed to reject, the person will read it)">
        <textarea style={{ ...inputStyle, minHeight: 80 }} maxLength={1000} value={note} onChange={(e) => { setNote(e.target.value); setSure(null); setError(null); }} />
      </Field>
      <Err>{error}</Err>
      {sure ? <Muted>{sure === 'approve' ? `Please check: approve ${name}. They can then see hosts, message and book once they have paid.` : `Please check: reject ${name}. They will see your reason and upload again.`} This is written to the audit log.</Muted> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn kind="primary" disabled={busy || !adult || sure === 'reject'} onClick={() => { decide(true).catch(() => {}); }}>{sure === 'approve' ? 'Yes, approve' : 'Approve'}</Btn>
        <Btn kind="danger" disabled={busy || sure === 'approve'} onClick={() => { decide(false).catch(() => {}); }}>{sure === 'reject' ? 'Yes, reject' : 'Reject'}</Btn>
        {sure ? <Btn kind="secondary" onClick={() => setSure(null)}>Cancel</Btn> : null}
      </div>
    </Card>
  );
}

export default function Verification() {
  const list = useLoad(getPendingVerifications, []);
  return (
    <div style={pageStyle}>
      <H1 sub="People who sent a selfie and an ID photo. We aim to answer within 1 business day.">Verification</H1>
      <Status l={list} />
      {!list.loading && list.data && list.data.length === 0 ? <Muted>No one is waiting.</Muted> : null}
      {(list.data ?? []).map((r) => <Request key={r.id} r={r} onDone={list.reload} />)}
    </div>
  );
}
