'use client';
import Link from 'next/link';
import React from 'react';
import { getOpenAppeals, getOverview, getReports } from '../src/data';
import { Badge, Card, C, Err, H1, H2, Muted, pageStyle, PersonLink, Table, Td, useLoad, when } from '../src/ui';
import { REPORT_REASONS, nice } from '../src/rules';

function Stat({ label, value, href, tone }: { label: string; value: number | undefined; href?: string; tone?: boolean }) {
  const inner = (
    <Card style={{ minWidth: 170, flex: '1 1 170px', borderColor: tone ? C.danger : C.border }}>
      <span style={{ fontSize: 32, fontWeight: 800, color: tone ? C.danger : C.primary }}>{value ?? <span role="status" aria-label="Loading">…</span>}</span>
      <span style={{ color: C.textMuted, fontSize: 14 }}>{label}</span>
    </Card>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none', display: 'flex', flex: '1 1 170px' }}>{inner}</Link> : inner;
}

export default function Overview() {
  const o = useLoad(getOverview, []);
  const reports = useLoad(() => getReports(true, 8), []);
  const appeals = useLoad(getOpenAppeals, []);
  const d = o.data ?? undefined;
  return (
    <div style={pageStyle}>
      <H1 sub="What needs a person today.">Overview</H1>
      <Err>{o.error}</Err>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <Stat label="Active users" value={d?.active_users} />
        <Stat label="New this week" value={d?.new_this_week} />
        <Stat label="Open reports" value={d?.open_reports} href="/reports" tone={(d?.high_priority ?? 0) > 0} />
        <Stat label="High priority" value={d?.high_priority} href="/reports" tone={(d?.high_priority ?? 0) > 0} />
        <Stat label="Waiting for approval" value={d?.pending_approvals} href="/approvals" />
        <Stat label="Open appeals" value={d?.open_appeals} href="/appeals" />
        <Stat label="Suspended" value={d?.suspended} href="/users?status=suspended" />
        <Stat label="Actions this month" value={d?.actions_this_month} href="/audit" />
      </div>
      <H2>Reports queue</H2>
      <Card>
        <Err>{reports.error}</Err>
        {reports.data && reports.data.length === 0 ? <Muted>No open reports.</Muted> : (
          <Table head={['When', 'Priority', 'Reason', 'About', 'Reported by']}>
            {(reports.data ?? []).map((r) => (
              <tr key={r.id}>
                <Td>{when(r.created_at)}</Td>
                <Td>{r.emergency ? <Badge tone="bad">Emergency</Badge> : <Badge tone={r.priority === 'high' ? 'bad' : 'neutral'}>{nice(r.priority)}</Badge>}</Td>
                <Td><Link href="/reports" style={{ color: C.link }}>{REPORT_REASONS[r.reason] ?? r.reason}</Link></Td>
                <Td>{r.reported ? <PersonLink id={r.reported.id} name={r.reported.first_name} /> : ''}</Td>
                <Td>{r.reporter ? <PersonLink id={r.reporter.id} name={r.reporter.first_name} /> : ''}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {appeals.data && appeals.data.length > 0 ? <Muted>{appeals.data.length === 1 ? '1 appeal is' : `${appeals.data.length} appeals are`} waiting on the Appeals page.</Muted> : null}
    </div>
  );
}
