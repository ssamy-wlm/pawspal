'use client';
import React from 'react';
import { decidePayment, getDecidedClaims, getPendingClaims, refusal, type PaymentClaim } from '../../src/data';
import { OVERDUE_HOURS, hoursWaiting, nice, waitingText } from '../../src/rules';
import { Badge, Btn, Card, Field, Err, H1, H2, inputStyle, Muted, pageStyle, Photo, PersonLink, Status, statusTone, Table, Td, useLoad, when } from '../../src/ui';

const LEFT_OVER = 'The decision is saved. The screenshot will be deleted by the nightly clean-up.';

function Claim({ c, onDone }: { c: PaymentClaim; onDone: () => void }) {
  const hours = hoursWaiting(c.created_at);
  const [note, setNote] = React.useState('');
  const [sure, setSure] = React.useState<'confirm' | 'reject' | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);

  const decide = async (confirm: boolean) => {
    if (!confirm && note.trim() === '') { setError('Write a note. The person will read it.'); return; }
    if (sure !== (confirm ? 'confirm' : 'reject')) { setSure(confirm ? 'confirm' : 'reject'); setError(null); return; }
    setBusy(true); setError(null);
    try {
      const res = await decidePayment(c.id, confirm, confirm ? '' : note);
      if (res.fileLeft) { setWarning(LEFT_OVER); setSure(null); setBusy(false); return; }
      onDone();
    } catch (e) { setError(refusal(e)); setSure(null); setBusy(false); }
  };

  if (warning) return <Card><strong>{c.user?.first_name ?? 'No name'}</strong><p role="status" style={{ margin: 0 }}>{warning}</p><Btn kind="secondary" onClick={onDone}>Done</Btn></Card>;
  return (
    <Card>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Photo bucket="payments" path={c.screenshot_path} alt={`Payment screenshot from ${c.user?.first_name ?? 'this person'}`} size={220} />
          <Muted>Screenshot</Muted>
        </div>
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong style={{ fontSize: 20 }}>{c.user ? <PersonLink id={c.user.id} name={c.user.first_name} /> : 'No name'}</strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge>{nice(c.kind)}</Badge><Badge>{c.amount_egp} EGP</Badge>
            <Badge tone={hours > OVERDUE_HOURS ? 'warn' : 'neutral'}>{waitingText(hours)}</Badge>
          </div>
          <Muted>Sent {when(c.created_at)}</Muted>
          <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{c.reference ? <>Reference: {c.reference}</> : <Muted>No reference written.</Muted>}</p>
        </div>
      </div>
      <Muted>Check the payment arrived in your InstaPay or bank account, then confirm. The screenshot is deleted as soon as you decide.</Muted>
      <Field label="Note (needed to reject, the person will read it)">
        <textarea style={{ ...inputStyle, minHeight: 70 }} maxLength={1000} value={note} onChange={(e) => { setNote(e.target.value); setSure(null); setError(null); }} />
      </Field>
      <Err>{error}</Err>
      {sure ? <Muted>{sure === 'confirm' ? `Please check: confirm ${c.amount_egp} EGP from ${c.user?.first_name ?? 'this person'}. Their membership starts or extends.` : 'Please check: reject this payment. The person will see your note.'} This is written to the audit log.</Muted> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn kind="primary" disabled={busy || sure === 'reject'} onClick={() => { decide(true).catch(() => {}); }}>{sure === 'confirm' ? 'Yes, confirm' : 'Confirm'}</Btn>
        <Btn kind="danger" disabled={busy || sure === 'confirm'} onClick={() => { decide(false).catch(() => {}); }}>{sure === 'reject' ? 'Yes, reject' : 'Reject'}</Btn>
        {sure ? <Btn kind="secondary" onClick={() => setSure(null)}>Cancel</Btn> : null}
      </div>
    </Card>
  );
}

export default function Payments() {
  const pending = useLoad(getPendingClaims, []);
  const decided = useLoad(getDecidedClaims, []);
  const reload = () => { pending.reload(); decided.reload(); };
  return (
    <div style={pageStyle}>
      <H1 sub="People who say they paid. Oldest first.">Payments</H1>
      <Status l={pending} />
      {!pending.loading && pending.data && pending.data.length === 0 ? <Muted>No payments are waiting.</Muted> : null}
      {(pending.data ?? []).map((c) => <Claim key={c.id} c={c} onDone={reload} />)}
      <H2>Recently decided</H2>
      <Status l={decided} />
      <Card>
        {decided.data && decided.data.length === 0 ? <Muted>Nothing decided yet.</Muted> : (
          <Table head={['Decided', 'Person', 'Kind', 'Amount', 'Result', 'Note']}>
            {(decided.data ?? []).map((c) => (
              <tr key={c.id}>
                <Td>{when(c.decided_at)}</Td><Td>{c.user ? <PersonLink id={c.user.id} name={c.user.first_name} /> : ''}</Td><Td>{nice(c.kind)}</Td>
                <Td>{c.amount_egp} EGP</Td><Td><Badge tone={statusTone(c.status)}>{nice(c.status)}</Badge></Td><Td wide>{c.note ?? ''}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
