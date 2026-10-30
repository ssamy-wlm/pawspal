'use client';
import React from 'react';
import { refusal, takeAction } from './data';
import { actionsFor, LADDER, needsReason, RULES, validateAction, ZERO_TOLERANCE, type AccountStatus, type ActionForm, type ActionKind, type SuspensionLength } from './rules';
import { Btn, C, Card, Err, Field, H2, inputStyle, Muted } from './ui';

const LABEL: Record<ActionKind, string> = { reminder: 'Reminder', warning: 'Warning', suspension: 'Suspension', removal: 'Removal', reinstatement: 'Reinstate', approval: 'Approve' };

/** The "Take action" panel. Only the actions that fit the account's status are offered; the database checks again. */
export function ActionPanel({ userId, status, onDone, only }: { userId: string; status: AccountStatus; onDone: () => void; only?: ActionKind[] }) {
  const options = actionsFor(status).filter((a) => !only || only.includes(a));
  const [form, setForm] = React.useState<ActionForm>({ action: options[0] ?? 'reminder', rule: '', message: '', length: '3', checklist: '' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sure, setSure] = React.useState(false);
  const set = (patch: Partial<ActionForm>) => { setForm((f) => ({ ...f, ...patch })); setSure(false); setError(null); };
  if (options.length === 0) return <Card><H2>Take action</H2><Muted>Nothing can be done for this account right now.</Muted></Card>;
  const serious = form.action === 'removal' || form.action === 'suspension';

  const submit = async () => {
    const problem = validateAction(status, form);
    if (problem) { setError(problem); return; }
    if (serious && !sure) { setSure(true); return; }
    setBusy(true); setError(null);
    try { await takeAction(userId, form); setSure(false); setForm((f) => ({ ...f, message: '', checklist: '' })); onDone(); } catch (e) { setError(refusal(e)); } finally { setBusy(false); }
  };

  return (
    <Card>
      <H2>Take action</H2>
      <div role="radiogroup" aria-label="Action" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={form.action === a} onClick={() => set({ action: a })}
            style={{ minHeight: 40, padding: '0 16px', borderRadius: 999, border: `2px solid ${form.action === a ? C.primary : C.border}`, background: form.action === a ? C.primary : 'transparent', color: form.action === a ? C.onPrimary : C.text, fontWeight: 600, cursor: 'pointer' }}>
            {LABEL[a]}
          </button>
        ))}
      </div>
      {form.action === 'suspension' ? (
        <Field label="How long">
          <select style={inputStyle} value={form.length} onChange={(e) => set({ length: e.target.value as SuspensionLength })}>
            <option value="3">3 days</option><option value="7">7 days</option><option value="fixed">Until fixed</option>
          </select>
        </Field>
      ) : null}
      {needsReason(form.action) ? (
        <Field label="Rule that was broken">
          <select style={inputStyle} value={form.rule} onChange={(e) => set({ rule: e.target.value })}>
            <option value="">Choose a rule</option>
            <optgroup label="Community rules">{RULES.map((r) => <option key={r} value={r}>{r}</option>)}</optgroup>
            <optgroup label="Zero tolerance">{ZERO_TOLERANCE.map((r) => <option key={r} value={r}>{r}</option>)}</optgroup>
          </select>
        </Field>
      ) : null}
      <Field label={needsReason(form.action) ? 'Message the person will read' : 'Message (optional)'}>
        <textarea style={{ ...inputStyle, minHeight: 90 }} maxLength={1000} value={form.message} onChange={(e) => set({ message: e.target.value })} />
      </Field>
      {form.action === 'suspension' && form.length === 'fixed' ? (
        <Field label="What they must fix (one per line)">
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.checklist} onChange={(e) => set({ checklist: e.target.value })} />
        </Field>
      ) : null}
      {form.action === 'removal' ? <Muted>Removing a person also bans their phone number, ID document and device so they cannot return.</Muted> : null}
      <Err>{error}</Err>
      <div><Btn kind={serious ? 'danger' : 'primary'} disabled={busy} onClick={() => { submit().catch(() => {}); }}>{sure ? `Yes, ${LABEL[form.action].toLowerCase()} this person` : LABEL[form.action]}</Btn></div>
      <Muted>Ladder: {LADDER.join(' → ')}. Every action is written to the audit log.</Muted>
    </Card>
  );
}
