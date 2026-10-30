'use client';
import React from 'react';
import { getAudit, type AuditRow } from '../../src/data';
import { Badge, C, Card, Err, H1, Muted, pageStyle, PersonLink, Table, Td, when } from '../../src/ui';

const brief = (d: Record<string, unknown>) =>
  Object.entries(d).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');

export default function Audit() {
  const [rows, setRows] = React.useState<AuditRow[]>([]);
  const [more, setMore] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const load = React.useCallback(async (before?: number) => {
    try {
      const next = await getAudit(before);
      setRows((cur) => (before ? [...cur, ...next] : next)); setMore(next.length === 50); setError(null);
    } catch { setError('Could not load this. Try again.'); } finally { setLoaded(true); }
  }, []);
  React.useEffect(() => { load().catch(() => {}); }, [load]);
  return (
    <div style={pageStyle}>
      <H1 sub="Every admin action, newest first. Nobody can change or delete these entries.">Audit log</H1>
      <Err>{error}</Err>
      <Card>
        {loaded && rows.length === 0 ? <Muted>Nothing yet.</Muted> : (
          <Table head={['When', 'Admin', 'Action', 'Person', 'Details']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>{when(r.created_at)}</Td><Td>{r.admin_email ?? <Badge>system</Badge>}</Td><Td><Badge>{r.action.replace(/_/g, ' ')}</Badge></Td>
                <Td>{r.target_user ? <PersonLink id={r.target_user} name={r.target_name} /> : ''}</Td><Td wide>{brief(r.details)}</Td>
              </tr>
            ))}
          </Table>
        )}
        {more && rows.length > 0 ? <div><button onClick={() => { load(rows[rows.length - 1].id).catch(() => {}); }} style={{ minHeight: 40, borderRadius: 999, border: `2px solid ${C.primary}`, background: 'transparent', color: C.primary, fontWeight: 600, padding: '0 18px', cursor: 'pointer' }}>Load more</button></div> : null}
      </Card>
    </div>
  );
}
