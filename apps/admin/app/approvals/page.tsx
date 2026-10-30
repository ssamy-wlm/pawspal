'use client';
import React from 'react';
import { ActionPanel } from '../../src/action-panel';
import { getPending, type Profile } from '../../src/data';
import { Badge, Card, Err, H1, Muted, pageStyle, Photo, PersonLink, useLoad, when } from '../../src/ui';

function Pending({ p, onDone }: { p: Profile; onDone: () => void }) {
  return (
    <Card>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <Photo bucket="faces" path={p.face_photo_path} alt={`Face photo of ${p.first_name ?? 'this person'}`} size={180} />
        {p.home_photo_path ? <Photo bucket="homes" path={p.home_photo_path} alt={`Home photo of ${p.first_name ?? 'this person'}`} size={180} /> : null}
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong style={{ fontSize: 20 }}><PersonLink id={p.id} name={p.first_name} /></strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge>{p.role}</Badge><Badge tone={p.face_verified ? 'good' : 'warn'}>Face {p.face_verified ? 'checked' : 'not checked'}</Badge>
            <Badge tone={p.id_verified ? 'good' : 'warn'}>ID {p.id_verified ? 'checked' : 'not checked'}</Badge><Badge tone={p.is_adult ? 'good' : 'warn'}>{p.is_adult ? 'Adult' : 'Age not confirmed'}</Badge>
          </div>
          <Muted>Signed up {when(p.created_at)}{p.area ? ` · ${p.area}` : ''}</Muted>
          {p.bio ? <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{p.bio}</p> : null}
        </div>
      </div>
      <Muted>Check that the face photo is a real person and the profile follows the rules, then approve. Approving lets them see hosts, message and book.</Muted>
      <ActionPanel userId={p.id} status={p.status} onDone={onDone} only={['approval', 'removal']} />
    </Card>
  );
}

export default function Approvals() {
  const list = useLoad(getPending, []);
  return (
    <div style={pageStyle}>
      <H1 sub="New profiles that passed the automatic checks and wait for a person.">Approvals</H1>
      <Err>{list.error}</Err>
      {list.data && list.data.length === 0 ? <Muted>No one is waiting.</Muted> : null}
      {(list.data ?? []).map((p) => <Pending key={p.id} p={p} onDone={list.reload} />)}
    </div>
  );
}
