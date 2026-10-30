'use client';
import React from 'react';
import { getRecentHomes, getRecentPets, refusal, removePhoto } from '../../src/data';
import { Btn, Card, C, Err, Field, H1, H2, inputStyle, Muted, pageStyle, Photo, PersonLink, useLoad } from '../../src/ui';

function Removable({ kind, owner, path, name, bucket, onDone }: { kind: 'pet' | 'home'; owner: string; path: string; name: string | null; bucket: 'pets' | 'homes'; onDone: () => void }) {
  const [asking, setAsking] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const remove = async () => {
    setBusy(true); setError(null);
    try { await removePhoto(kind, owner, path, reason); onDone(); } catch (e) { setError(refusal(e)); } finally { setBusy(false); }
  };
  return (
    <div style={{ width: 200, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Photo bucket={bucket} path={path} size={200} alt={`${kind === 'pet' ? 'Pet' : 'Home'} photo from ${name ?? 'someone'}`} />
      <span style={{ fontSize: 14 }}><PersonLink id={owner} name={name} /></span>
      {asking ? (
        <>
          <Field label="Why remove it"><input style={inputStyle} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Err>{error}</Err>
          <div style={{ display: 'flex', gap: 6 }}><Btn kind="danger" disabled={busy || !reason.trim()} onClick={() => { remove().catch(() => {}); }}>Remove</Btn><Btn kind="secondary" onClick={() => setAsking(false)}>Cancel</Btn></div>
        </>
      ) : <Btn kind="secondary" onClick={() => setAsking(true)}>Remove photo</Btn>}
    </div>
  );
}

export default function Photos() {
  const pets = useLoad(getRecentPets, []);
  const homes = useLoad(getRecentHomes, []);
  return (
    <div style={pageStyle}>
      <H1 sub="The newest pet and home photos. Face photos are checked on the Approvals page.">Photo review</H1>
      <Err>{pets.error ?? homes.error}</Err>
      <H2>Pets</H2>
      <Card>
        {pets.data && pets.data.every((p) => p.photo_paths.length === 0) ? <Muted>No pet photos.</Muted> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          {(pets.data ?? []).flatMap((p) => p.photo_paths.map((path) => <Removable key={path} kind="pet" owner={p.owner_id} path={path} name={p.name} bucket="pets" onDone={pets.reload} />))}
        </div>
      </Card>
      <H2>Homes</H2>
      <Card>
        {homes.data && homes.data.length === 0 ? <Muted>No home photos.</Muted> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          {(homes.data ?? []).map((h) => <Removable key={h.home_photo_path} kind="home" owner={h.id} path={h.home_photo_path} name={h.first_name} bucket="homes" onDone={homes.reload} />)}
        </div>
      </Card>
      <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>A removed photo is taken off the profile and its file is deleted by the nightly clean-up.</p>
    </div>
  );
}
