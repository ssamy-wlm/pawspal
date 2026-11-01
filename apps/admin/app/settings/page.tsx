'use client';
import React from 'react';
import { getSettings, setSetting } from '../../src/data';
import { isNumberSetting, validateSetting } from '../../src/rules';
import { Btn, Card, Err, Field, H1, H2, inputStyle, Muted, pageStyle, Status, useLoad } from '../../src/ui';

interface Def { key: string; label: string; help: string; long?: boolean }
const GROUPS: { title: string; items: Def[] }[] = [
  { title: 'Fees', items: [
    { key: 'registration_fee_egp', label: 'Registration fee (EGP)', help: 'Shown to people when they pay for the first time. Whole pounds, 1 to 100000.' },
    { key: 'renewal_fee_egp', label: 'Renewal fee (EGP)', help: 'Shown to people when their membership is due. Whole pounds, 1 to 100000.' },
    { key: 'membership_months', label: 'Membership length (months)', help: 'How long one payment lasts, from 1 to 60 months.' },
    { key: 'reminder_days', label: 'Reminder days', help: 'How many days before the end people get a renewal reminder, from 1 to 60.' },
  ] },
  { title: 'InstaPay', items: [
    { key: 'instapay_link', label: 'InstaPay link', help: 'Shown to people when they pay. A full link that starts with https://' },
    { key: 'instapay_qr_url', label: 'InstaPay QR image link', help: 'Shown to people as a code to scan. A full link that starts with https://' },
  ] },
  { title: 'Bank transfer', items: [
    { key: 'bank_name', label: 'Bank name', help: 'Shown to people when they pay by bank transfer.' },
    { key: 'bank_account_name', label: 'Account holder name', help: 'Shown to people when they pay by bank transfer.' },
    { key: 'bank_account_number', label: 'Account number', help: 'Shown to people when they pay by bank transfer.' },
    { key: 'bank_iban', label: 'IBAN', help: 'Shown to people when they pay by bank transfer.' },
    { key: 'payment_note', label: 'Note for people paying', help: 'A short line shown under the payment details, for example what to write as the reference.', long: true },
  ] },
];

function Setting({ def, saved, onSaved }: { def: Def; saved: string; onSaved: (v: string) => void }) {
  const [value, setValue] = React.useState(saved);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  React.useEffect(() => { setValue(saved); }, [saved]);
  const id = `setting-${def.key}`;
  const save = async () => {
    const problem = validateSetting(def.key, value);
    if (problem) { setError(problem); setDone(false); return; }
    setBusy(true); setError(null);
    try { await setSetting(def.key, value); setDone(true); onSaved(value.trim()); } catch { setError('That did not save. Try again.'); setDone(false); } finally { setBusy(false); }
  };
  const numeric = isNumberSetting(def.key);
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Field label={def.label}>
          {def.long
            ? <textarea id={id} style={{ ...inputStyle, minHeight: 70 }} maxLength={500} value={value} aria-describedby={`${id}-help`} onChange={(e) => { setValue(e.target.value); setDone(false); setError(null); }} />
            : <input id={id} style={inputStyle} inputMode={numeric ? 'numeric' : undefined} maxLength={500} value={value} aria-describedby={`${id}-help`} onChange={(e) => { setValue(e.target.value); setDone(false); setError(null); }} />}
        </Field>
        <span id={`${id}-help`} style={{ fontSize: 13 }}><Muted>{def.help}</Muted></span>
        <Err>{error}</Err>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 40 }}>
        <Btn disabled={busy || value.trim() === saved.trim()} onClick={() => { save().catch(() => {}); }}>Save</Btn>
        {done ? <span role="status" style={{ fontWeight: 600 }}>Saved</span> : null}
      </div>
    </div>
  );
}

export default function Settings() {
  const s = useLoad(getSettings, []);
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const current = (k: string) => local[k] ?? s.data?.[k] ?? '';
  return (
    <div style={pageStyle}>
      <H1 sub="Fees and payment details people see in the app. Each field saves on its own.">Settings</H1>
      <Status l={s} />
      {s.data ? GROUPS.map((g) => (
        <React.Fragment key={g.title}>
          <H2>{g.title}</H2>
          <Card>{g.items.map((d) => <Setting key={d.key} def={d} saved={current(d.key)} onSaved={(v) => setLocal((m) => ({ ...m, [d.key]: v }))} />)}</Card>
        </React.Fragment>
      )) : null}
      <Muted>Every change is written to the audit log.</Muted>
    </div>
  );
}
