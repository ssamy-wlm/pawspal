'use client';
import React from 'react';
import { nice } from '../../src/rules';
import { getBookings } from '../../src/data';
import { Badge, Card, Status, Field, H1, inputStyle, Muted, pageStyle, PersonLink, statusTone, Table, Td, useLoad, day } from '../../src/ui';

export default function Bookings() {
  const [status, setStatus] = React.useState('');
  const list = useLoad(() => getBookings(status), [status]);
  return (
    <div style={pageStyle}>
      <H1 sub="The 100 newest bookings. Read only: people cancel and confirm in the app.">Bookings</H1>
      <Field label="Status">
        <select style={{ ...inputStyle, maxWidth: 260 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any</option>
          {['requested', 'terms_agreed', 'confirmed', 'in_progress', 'completed', 'cancelled', 'disputed'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Status l={list} />
      <Card>
        {!list.loading && list.data && list.data.length === 0 ? <Muted>No bookings.</Muted> : (
          <Table head={['Dates', 'Pet', 'Owner', 'Sitter', 'Type', 'Status', 'Fee']}>
            {(list.data ?? []).map((b) => (
              <tr key={b.id}>
                <Td>{day(b.starts_on)} – {day(b.ends_on)}</Td><Td>{b.pet?.name ?? ''}</Td>
                <Td>{b.owner ? <PersonLink id={b.owner.id} name={b.owner.first_name} /> : ''}</Td><Td>{b.sitter ? <PersonLink id={b.sitter.id} name={b.sitter.first_name} /> : ''}</Td>
                <Td>{nice(b.cost_type)}</Td><Td><Badge tone={statusTone(b.status)}>{nice(b.status)}</Badge></Td><Td>{nice(b.fee_status)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
