'use client';
import { useParams } from 'next/navigation';
import React from 'react';
import { ActionPanel } from '../../../src/action-panel';
import { getProfile, getUserCase } from '../../../src/data';
import { REPORT_REASONS } from '../../../src/rules';
import { Badge, Card, Err, H1, H2, Muted, pageStyle, Photo, PersonLink, statusTone, Table, Td, useLoad, when } from '../../../src/ui';

const Check = ({ ok, label }: { ok: boolean; label: string }) => <Badge tone={ok ? 'good' : 'warn'}>{ok ? '✓' : '·'} {label}</Badge>;

export default function UserCase() {
  const { id } = useParams<{ id: string }>();
  const profile = useLoad(() => getProfile(id), [id]);
  const kase = useLoad(() => getUserCase(id), [id]);
  const p = profile.data;
  const reload = () => { profile.reload(); kase.reload(); };
  if (profile.error) return <div style={pageStyle}><Err>{profile.error}</Err></div>;
  if (!p) return <div style={pageStyle}><Muted>{profile.data === null && !profile.error ? 'Loading…' : 'No such user.'}</Muted></div>;
  const k = kase.data;
  const strikes = (k?.actions ?? []).filter((a) => a.action === 'warning' || a.action === 'suspension' || a.action === 'removal').length;
  return (
    <div style={pageStyle}>
      <H1 sub={`User id ${p.id}`}>{p.first_name ?? 'No name'}</H1>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Card style={{ flex: '1 1 380px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={statusTone(p.status)}>{p.status.replace('_', ' ')}</Badge><Badge>{p.role}</Badge>
            <Check ok={p.phone_verified} label="Phone" /><Check ok={p.face_verified} label="Face" /><Check ok={p.id_verified} label="ID" /><Check ok={p.is_adult} label="Adult" />
          </div>
          <Muted>Joined {when(p.created_at)} · {p.stays_count} stays · rating {p.rating_avg ?? 'none yet'} · {strikes} strike(s)</Muted>
          {p.area ? <span>Area: {p.area}</span> : null}
          {p.bio ? <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{p.bio}</p> : null}
          <div style={{ display: 'flex', gap: 12 }}>
            <Photo bucket="faces" path={p.face_photo_path} alt={`Face photo of ${p.first_name ?? 'this person'}`} />
            <Photo bucket="homes" path={p.home_photo_path} alt={`Home photo of ${p.first_name ?? 'this person'}`} />
          </div>
        </Card>
        <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ActionPanel key={p.status} userId={p.id} status={p.status} onDone={reload} />
        </div>
      </div>
      <Err>{kase.error}</Err>
      <H2>Strike history</H2>
      <Card>
        {k && k.actions.length === 0 ? <Muted>No actions yet.</Muted> : (
          <Table head={['When', 'Action', 'Rule', 'Length', 'Message']}>
            {(k?.actions ?? []).map((a) => (
              <tr key={a.id}><Td>{when(a.created_at)}</Td><Td><Badge tone={a.action === 'removal' || a.action === 'suspension' ? 'bad' : 'neutral'}>{a.action}</Badge></Td><Td>{a.rule ?? ''}</Td>
                <Td>{a.until_fixed ? 'until fixed' : a.duration_days ? `${a.duration_days} days` : ''}</Td><Td wide>{a.message ?? ''}</Td></tr>
            ))}
          </Table>
        )}
      </Card>
      {k && k.appeals.length > 0 ? (
        <>
          <H2>Appeals</H2>
          <Card>{k.appeals.map((a) => (
            <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span><Badge tone={statusTone(a.status)}>{a.status}</Badge> {when(a.created_at)} · against {a.action?.action ?? 'an action'}</span>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{a.body}</p>
            </div>
          ))}<Muted>Decide appeals on the Appeals page.</Muted></Card>
        </>
      ) : null}
      <H2>Reports about this person</H2>
      <Card>
        {k && k.reportsAbout.length === 0 ? <Muted>None.</Muted> : (
          <Table head={['When', 'Reason', 'Status', 'By', 'Details']}>
            {(k?.reportsAbout ?? []).map((r) => (
              <tr key={r.id}><Td>{when(r.created_at)}</Td><Td>{REPORT_REASONS[r.reason] ?? r.reason}</Td><Td><Badge tone={statusTone(r.status)}>{r.status.replace('_', ' ')}</Badge></Td>
                <Td>{r.reporter ? <PersonLink id={r.reporter.id} name={r.reporter.first_name} /> : ''}</Td><Td wide>{r.details ?? ''}</Td></tr>
            ))}
          </Table>
        )}
      </Card>
      <H2>Reports this person filed</H2>
      <Card>
        {k && k.reportsBy.length === 0 ? <Muted>None.</Muted> : (
          <Table head={['When', 'Reason', 'Status', 'About']}>
            {(k?.reportsBy ?? []).map((r) => (
              <tr key={r.id}><Td>{when(r.created_at)}</Td><Td>{REPORT_REASONS[r.reason] ?? r.reason}</Td><Td><Badge tone={statusTone(r.status)}>{r.status.replace('_', ' ')}</Badge></Td>
                <Td>{r.reported ? <PersonLink id={r.reported.id} name={r.reported.first_name} /> : ''}</Td></tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
