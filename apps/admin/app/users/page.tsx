'use client';
import React from 'react';
import { matchesMembership, nice } from '../../src/rules';
import { getSettings, searchUsers } from '../../src/data';
import { Badge, MembershipBadge, Card, Status, Field, H1, inputStyle, Muted, pageStyle, PersonLink, statusTone, Table, Td, useLoad, day } from '../../src/ui';

export default function Users() {
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState('');
  React.useEffect(() => { const s = new URLSearchParams(window.location.search).get('status'); if (s) setStatus(s); }, []);
  const [membership, setMembership] = React.useState('');
  React.useEffect(() => { const m = new URLSearchParams(window.location.search).get('membership'); if (m) setMembership(m); }, []);
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => { const t = setTimeout(() => setDebounced(query), 300); return () => clearTimeout(t); }, [query]);
  const list = useLoad(() => searchUsers(debounced, status), [debounced, status]);
  const settings = useLoad(getSettings, []);
  const reminderDays = Number(settings.data?.reminder_days) || 7;
  const shown = (list.data ?? []).filter((p) => matchesMembership(membership, p.membership?.paid_until, new Date(), reminderDays)).slice(0, 50);
  return (
    <div style={pageStyle}>
      <H1 sub="Search by first name or paste a user id. Contact details are never shown here.">Users</H1>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Field label="Search"><input style={{ ...inputStyle, minWidth: 260 }} value={query} onChange={(e) => setQuery(e.target.value)} /></Field>
        <Field label="Status">
          <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option><option value="pending_review">Waiting for review</option><option value="active">Active</option>
            <option value="suspended">Suspended</option><option value="removed">Removed</option><option value="pending_verification">Still verifying</option>
          </select>
        </Field>
        <Field label="Membership">
          <select style={inputStyle} value={membership} onChange={(e) => setMembership(e.target.value)}>
            <option value="">Any</option><option value="unpaid">Unpaid</option><option value="expiring">Due soon</option><option value="paused">Paused</option>
          </select>
        </Field>
      </div>
      <Status l={list} />
      <Card>
        {!list.loading && list.data && shown.length === 0 ? <Muted>No one found.</Muted> : (
          <Table head={['Name', 'Status', 'Role', 'Area', 'Paid until', 'Joined']}>
            {shown.map((p) => (
              <tr key={p.id}>
                <Td><PersonLink id={p.id} name={p.first_name} /></Td>
                <Td><Badge tone={statusTone(p.status)}>{nice(p.status)}</Badge></Td>
                <Td>{nice(p.role)}</Td><Td>{p.area ?? ''}</Td><Td><MembershipBadge paidUntil={p.membership?.paid_until} reminderDays={reminderDays} /> {p.membership?.paid_until ? day(p.membership.paid_until) : ''}</Td><Td>{day(p.created_at)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
