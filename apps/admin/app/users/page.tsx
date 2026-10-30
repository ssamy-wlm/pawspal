'use client';
import React from 'react';
import { searchUsers } from '../../src/data';
import { Badge, Card, Err, Field, H1, inputStyle, Muted, pageStyle, PersonLink, statusTone, Table, Td, useLoad, day } from '../../src/ui';

export default function Users() {
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState('');
  React.useEffect(() => { const s = new URLSearchParams(window.location.search).get('status'); if (s) setStatus(s); }, []);
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => { const t = setTimeout(() => setDebounced(query), 300); return () => clearTimeout(t); }, [query]);
  const list = useLoad(() => searchUsers(debounced, status), [debounced, status]);
  return (
    <div style={pageStyle}>
      <H1 sub="Search by first name or paste a user id. Phone numbers are never shown here.">Users</H1>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Field label="Search"><input style={{ ...inputStyle, minWidth: 260 }} value={query} onChange={(e) => setQuery(e.target.value)} /></Field>
        <Field label="Status">
          <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option><option value="pending_review">Waiting for review</option><option value="active">Active</option>
            <option value="suspended">Suspended</option><option value="removed">Removed</option><option value="pending_verification">Still verifying</option>
          </select>
        </Field>
      </div>
      <Err>{list.error}</Err>
      <Card>
        {list.data && list.data.length === 0 ? <Muted>No one found.</Muted> : (
          <Table head={['Name', 'Status', 'Role', 'Area', 'Joined']}>
            {(list.data ?? []).map((p) => (
              <tr key={p.id}>
                <Td><PersonLink id={p.id} name={p.first_name} /></Td>
                <Td><Badge tone={statusTone(p.status)}>{p.status.replace('_', ' ')}</Badge></Td>
                <Td>{p.role}</Td><Td>{p.area ?? ''}</Td><Td>{day(p.created_at)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
