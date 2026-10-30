'use client';
import React from 'react';
import { getReportChat, getReports, refusal, setReportStatus, type ChatLine, type ReportRow } from '../../src/data';
import { nice, REPORT_REASONS } from '../../src/rules';
import { Badge, Btn, Card, C, Err, Field, H1, inputStyle, Muted, pageStyle, PersonLink, Status, statusTone, useLoad, when } from '../../src/ui';

const toggle = (on: boolean): React.CSSProperties => ({ minHeight: 40, padding: '0 18px', borderRadius: 999, border: `2px solid ${C.primary}`, background: on ? C.primary : 'transparent', color: on ? C.onPrimary : C.primary, fontWeight: 600, cursor: 'pointer' });

function Report({ r, onChanged }: { r: ReportRow; onChanged: () => void }) {
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [chat, setChat] = React.useState<ChatLine[] | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const change = async (status: 'in_review' | 'resolved' | 'dismissed') => {
    if (status !== 'in_review' && pending !== status) { setPending(status); return; }
    setBusy(true); setError(null);
    try { await setReportStatus(r.id, status, note); onChanged(); } catch (e) { setError(refusal(e)); } finally { setBusy(false); }
  };
  const readChat = async () => {
    setBusy(true); setError(null);
    try { setChat(await getReportChat(r.id)); } catch (e) { setError(refusal(e)); } finally { setBusy(false); }
  };
  const open = r.status === 'new' || r.status === 'in_review';
  return (
    <Card style={{ borderColor: r.priority === 'high' ? C.danger : C.border }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {r.emergency ? <Badge tone="bad">Emergency</Badge> : null}
        <Badge tone={r.priority === 'high' ? 'bad' : 'neutral'}>{r.priority} priority</Badge>
        <Badge tone={statusTone(r.status)}>{nice(r.status)}</Badge>
        <strong>{REPORT_REASONS[r.reason] ?? r.reason}</strong>
        <span style={{ color: C.textMuted, fontSize: 14 }}>{when(r.created_at)}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, fontSize: 15 }}>
        <span>About: {r.reported ? <PersonLink id={r.reported.id} name={r.reported.first_name} /> : 'unknown'}</span>
        <span>Reported by: {r.reporter ? <PersonLink id={r.reporter.id} name={r.reporter.first_name} /> : 'unknown'}</span>
      </div>
      {r.details ? <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.details}</p> : <Muted>No details.</Muted>}
      {r.conversation_id ? (
        chat ? (
          <div style={{ background: C.surfaceTint, borderRadius: 16, padding: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
            {chat.length === 0 ? <Muted>No messages.</Muted> : chat.map((m) => (
              <div key={m.id} style={{ fontSize: 14 }}><strong>{m.sender_id === r.reported?.id ? r.reported.first_name : m.sender_id === r.reporter?.id ? r.reporter.first_name : 'Someone'}:</strong> <span style={{ overflowWrap: 'anywhere' }}>{m.body}</span></div>
            ))}
          </div>
        ) : <div><Btn kind="secondary" disabled={busy} onClick={() => { readChat().catch(() => {}); }}>Read the conversation (recorded in the audit log)</Btn></div>
      ) : null}
      {open ? (
        <>
          <Field label="Note for the audit log (optional)"><textarea style={{ ...inputStyle, minHeight: 60 }} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Err>{error}</Err>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {r.status === 'new' ? <Btn kind="secondary" disabled={busy} onClick={() => { change('in_review').catch(() => {}); }}>Start review</Btn> : null}
            <Btn kind="secondary" disabled={busy} onClick={() => { change('resolved').catch(() => {}); }}>{pending === 'resolved' ? 'Yes, mark resolved' : 'Resolve'}</Btn>
            <Btn kind="secondary" disabled={busy} onClick={() => { change('dismissed').catch(() => {}); }}>{pending === 'dismissed' ? 'Yes, dismiss it' : 'Dismiss'}</Btn>
            {pending ? <Btn kind="secondary" onClick={() => setPending(null)}>Cancel</Btn> : null}
          </div>
          <Muted>To warn, suspend or remove, open the person&apos;s page.</Muted>
        </>
      ) : <Err>{error}</Err>}
    </Card>
  );
}

export default function Reports() {
  const [open, setOpen] = React.useState(true);
  const list = useLoad(() => getReports(open), [open]);
  return (
    <div style={pageStyle}>
      <H1 sub="High priority first. Emergencies come from the Safety Center in the app.">Reports</H1>
      <div style={{ display: 'flex', gap: 8 }}>
        <button aria-pressed={open} onClick={() => setOpen(true)} style={toggle(open)}>Open</button>
        <button aria-pressed={!open} onClick={() => setOpen(false)} style={toggle(!open)}>Closed</button>
      </div>
      <Status l={list} />
      {!list.loading && list.data && list.data.length === 0 ? <Muted>{open ? 'No open reports.' : 'No closed reports yet.'}</Muted> : null}
      {(list.data ?? []).map((r) => <Report key={r.id} r={r} onChanged={list.reload} />)}
    </div>
  );
}
