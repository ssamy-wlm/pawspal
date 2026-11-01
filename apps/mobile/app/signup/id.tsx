import React from 'react';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { StepScreen, ErrorText } from '../../src/components/StepScreen';
import { CheckRow } from '../../src/components/CheckRow';
import { Button } from '../../src/components/Button';
import { errorKey, uploadPhoto } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { clearVerificationDraft, getFacePath, getIdPath, setIdPath } from '../../src/lib/draft';
import { nextStep } from '../../src/lib/gate';
import { supabase } from '../../src/lib/supabase';
import { t as tr } from '../../src/i18n';

/** Step 2: a photo of your passport or national ID. Only the team sees it, and it is deleted right after the check. */
export default function IdStep() {
  const { refresh } = useAuth();
  const [done, setDone] = React.useState(!!getIdPath());
  const [busy, setBusy] = React.useState<'photo' | 'send' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const add = async (camera: boolean) => {
    setError(null);
    try {
      let uri: string | null = null;
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setError(tr('signup.camera.denied')); return; }
        const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, exif: false });
        uri = r.canceled ? null : r.assets[0]?.uri ?? null;
      } else {
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, exif: false });
        uri = r.canceled ? null : r.assets[0]?.uri ?? null;
      }
      if (!uri) return;
      setBusy('photo');
      setIdPath(await uploadPhoto('id', uri));
      setDone(true);
    } catch (e) { setError(tr(errorKey(e))); } finally { setBusy(null); }
  };

  React.useEffect(() => { if (!getFacePath()) router.replace('/signup/selfie'); }, []);

  const send = async () => {
    const face = getFacePath();
    const id = getIdPath();
    if (!face) { router.replace('/signup/selfie'); return; }
    if (!id) return;
    setBusy('send'); setError(null);
    try {
      const r = await supabase.rpc('submit_verification', { p_face_path: face, p_id_path: id });
      if (r.error) throw r.error;
      clearVerificationDraft();
      const state = await refresh();
      router.replace(`/signup/${state ? nextStep(state.missing) : 'about'}` as never);
    } catch { setError(tr('err.generic')); } finally { setBusy(null); }
  };

  return (
    <StepScreen step={2} total={5} title={tr('signup.id.title')} sub={tr('signup.id.sub')}
      footer={done ? (
        <>
          <Button navy title={busy === 'send' ? tr('common.loading') : tr('signup.id.send')} disabled={busy !== null} onPress={() => { send().catch(() => {}); }} />
          <Button navy variant="secondary" title={tr('signup.id.choose')} disabled={busy !== null} onPress={() => { add(false).catch(() => {}); }} />
        </>
      ) : (
        <>
          <Button navy title={busy === 'photo' ? tr('signup.photo.checking') : tr('signup.id.take')} disabled={busy !== null} onPress={() => { add(true).catch(() => {}); }} />
          <Button navy variant="secondary" title={tr('signup.id.choose')} disabled={busy !== null} onPress={() => { add(false).catch(() => {}); }} />
        </>
      )}>
      {done ? <CheckRow title={tr('signup.id.done')} /> : null}
      <ErrorText>{error}</ErrorText>
    </StepScreen>
  );
}
