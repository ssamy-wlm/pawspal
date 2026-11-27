'use client';
import React from 'react';
import { getSettings, setSetting } from '../../src/data';
import { isNumberSetting, isSwitchSetting, validateSetting } from '../../src/rules';
import { Badge, Btn, Card, Err, Field, H1, H2, inputStyle, Muted, pageStyle, Status, Toggle, useLoad } from '../../src/ui';

interface Def { key: string; label: string; help: string; long?: boolean; /** A placeholder the founder and a lawyer still have to confirm. */ confirm?: string }
const GROUPS: { title: string; items: Def[] }[] = [
  { title: 'Fees', items: [
    { key: 'registration_fee_egp', label: 'Registration fee (EGP)', help: 'Shown to people when they pay for the first time. Whole pounds, 1 to 100000.' },
    { key: 'renewal_fee_egp', label: 'Renewal fee (EGP)', help: 'Shown to people when their membership is due. Whole pounds, 1 to 100000.' },
    { key: 'membership_months', label: 'Membership length (months)', help: 'How long one payment lasts, from 1 to 60 months.' },
    { key: 'reminder_days', label: 'Reminder days', help: 'How many days before the end people get a renewal reminder, from 1 to 60.' },
  ] },
  { title: 'InstaPay', items: [
    { key: 'instapay_address', label: 'InstaPay address', help: 'For example yourname@instapay' },
    { key: 'instapay_link', label: 'InstaPay link (optional)', help: 'Adds an "Open InstaPay" button. Starts with https://' },
  ] },
  { title: 'Vodafone Cash', items: [
    { key: 'vodafone_cash_number', label: 'Vodafone Cash number', help: 'For example 01012345678' },
    { key: 'vodafone_cash_link', label: 'Vodafone Cash link (optional)', help: 'Adds an "Open Vodafone Cash" button. Starts with https://' },
  ] },
  { title: 'Note for people paying', items: [
    { key: 'payment_note', label: 'Payment note (optional)', help: 'A short line shown under the payment options.', long: true },
  ] },
  { title: 'Notifications and data', items: [
    { key: 'push_enabled', label: 'Push notifications', help: 'Nothing is sent to anyone\'s phone until this is on. Push also needs the notification cron job set up first (see SETUP).' },
    { key: 'deletion_grace_days', label: 'Days before a deleted account is wiped', help: 'How many days pass between someone deleting their account and the final clean-up of their data. Whole days, 1 to 365.',
      confirm: 'The 30 days is a placeholder from the privacy policy. You and a lawyer still need to confirm it.' },
    { key: 'shared_history_months', label: 'Months chats and bookings are kept', help: 'After this many months the nightly clean-up deletes old messages and bookings for both people. Whole months, 1 to 120.',
      confirm: 'The 24 months is a placeholder from the privacy policy. You and a lawyer still need to confirm it.' },
  ] },
];

/** The three phase 9 settings are hidden from the read policy (migration 0017), so the page may not know their value. */
const UNREADABLE = 'The current value cannot be shown yet, because the database hides this setting from the admin page. You can still save a new one.';

function Setting({ def, saved, known, onSaved }: { def: Def; saved: string; known: boolean; onSaved: (v: string) => void }) {
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
  const help = (
    <>
      <span id={`${id}-help`} style={{ fontSize: 13 }}><Muted>{def.help}</Muted></span>
      {def.confirm ? <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}><Badge tone="warn">To confirm</Badge><Muted>{def.confirm}</Muted></span> : null}
      {!known ? <span role="note" style={{ fontSize: 13 }}><Muted>{UNREADABLE}</Muted></span> : null}
    </>
  );
  if (isSwitchSetting(def.key)) {
    const on = value.trim() === 'true', off = value.trim() === 'false';
    const pick = (v: 'true' | 'false') => { setValue(v); setDone(false); setError(null); };
    return (
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span id={`${id}-label`} style={{ fontSize: 14, fontWeight: 600 }}>{def.label}</span>
          <div role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} style={{ display: 'flex', gap: 8 }}>
            <Toggle pressed={on} onClick={() => pick('true')}>On</Toggle>
            <Toggle pressed={off} onClick={() => pick('false')}>Off</Toggle>
          </div>
          <span role="status" style={{ fontSize: 13, fontWeight: 600 }}>{!known ? 'Current state unknown' : saved.trim() === 'true' ? 'Push is on' : 'Push is off, nothing is sent'}</span>
          {help}
          <Err>{error}</Err>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 40 }}>
          <Btn disabled={busy || (!on && !off) || (known && value.trim() === saved.trim())} onClick={() => { save().catch(() => {}); }}>Save</Btn>
          {done ? <span role="status" style={{ fontWeight: 600 }}>Saved</span> : null}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Field label={def.label}>
          {def.long
            ? <textarea id={id} style={{ ...inputStyle, minHeight: 70 }} maxLength={500} value={value} aria-describedby={`${id}-help`} onChange={(e) => { setValue(e.target.value); setDone(false); setError(null); }} />
            : <input id={id} style={inputStyle} inputMode={numeric ? 'numeric' : undefined} maxLength={500} value={value} aria-describedby={`${id}-help`} onChange={(e) => { setValue(e.target.value); setDone(false); setError(null); }} />}
        </Field>
        {help}
        <Err>{error}</Err>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 40 }}>
        <Btn disabled={busy || (known && value.trim() === saved.trim())} onClick={() => { save().catch(() => {}); }}>Save</Btn>
        {done ? <span role="status" style={{ fontWeight: 600 }}>Saved</span> : null}
      </div>
    </div>
  );
}

export default function Settings() {
  const s = useLoad(getSettings, []);
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const current = (k: string) => local[k] ?? s.data?.[k] ?? '';
  const known = (k: string) => k in local || (!!s.data && k in s.data);
  return (
    <div style={pageStyle}>
      <H1 sub="Fees and payment details people see in the app, and the notification and data-keeping switches. Each field saves on its own.">Settings</H1>
      <Status l={s} />
      {s.data ? GROUPS.map((g) => (
        <React.Fragment key={g.title}>
          <H2>{g.title}</H2>
          <Card>{g.items.map((d) => <Setting key={d.key} def={d} saved={current(d.key)} known={known(d.key)} onSaved={(v) => setLocal((m) => ({ ...m, [d.key]: v }))} />)}</Card>
        </React.Fragment>
      )) : null}
      <Muted>Every change is written to the audit log.</Muted>
    </div>
  );
}
