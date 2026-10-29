import React from 'react';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { StepScreen, ErrorText } from '../../src/components/StepScreen';
import { TextField } from '../../src/components/TextField';
import { CheckRow } from '../../src/components/CheckRow';
import { Button } from '../../src/components/Button';
import { useAuth } from '../../src/lib/auth';
import { nextStep } from '../../src/lib/gate';
import { supabase } from '../../src/lib/supabase';
import { t as tr } from '../../src/i18n';

/** Step 5: drop a pin. The server keeps the exact point private and shows neighbours only an approximate one. */
export default function LocationStep() {
  const { refresh } = useAuth();
  const [area, setArea] = React.useState('');
  const [pinned, setPinned] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const drop = async () => {
    setBusy(true); setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { setError(tr('signup.location.denied')); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const name = area.trim() || null;
      const r = await supabase.rpc('set_my_location', { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_address: name });
      if (r.error) throw r.error;
      if (name) await supabase.from('profiles').update({ area: name }).eq('id', (await supabase.auth.getUser()).data.user?.id ?? '');
      setPinned(true);
    } catch { setError(tr('signup.location.denied')); } finally { setBusy(false); }
  };

  const next = async () => {
    const state = await refresh();
    router.replace(`/signup/${state ? nextStep(state.missing) : 'rules'}` as never);
  };

  return (
    <StepScreen step={5} title={tr('signup.location.title')} sub={tr('signup.location.sub')}
      footer={pinned
        ? <Button navy title={tr('common.continue')} onPress={() => { next().catch(() => {}); }} />
        : <Button navy title={busy ? tr('common.loading') : tr('signup.location.use')} disabled={busy} onPress={() => { drop().catch(() => {}); }} />}>
      <TextField label={tr('signup.location.area')} value={area} onChangeText={setArea} maxLength={60} editable={!pinned} />
      {pinned ? <CheckRow title={tr('signup.location.done')} /> : null}
      <ErrorText>{error}</ErrorText>
    </StepScreen>
  );
}
