import React from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { ErrorText } from '../../src/components/StepScreen';
import { TextField } from '../../src/components/TextField';
import { TrustHeader, TrustScreen } from '../../src/components/TrustScreen';
import { useAuth } from '../../src/lib/auth';
import { fetchPet } from '../../src/lib/profile';
import { fetchPetCare, fetchRunningStays, PetCare, raiseEmergency } from '../../src/lib/safety';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr } from '../../src/i18n';

interface Running { id: string; pet: string }

/**
 * Emergency: something is wrong with the pet. Shows the vet's number first (calling comes before typing), then lets
 * either person alert the other and the PawsPal team. Only a stay that is confirmed or running can raise it.
 */
function Emergency() {
  const { booking } = useLocalSearchParams<{ booking?: string }>();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const c = useTheme().color;
  const rtl = isRTL();
  const [running, setRunning] = React.useState<Running[] | null>(null);
  const [picked, setPicked] = React.useState<string | null>(booking ?? null);
  const [care, setCare] = React.useState<PetCare | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    (async () => {
      const rows = await Promise.all((await fetchRunningStays(me)).map(async (b) => ({ id: b.id, pet: (await fetchPet(b.pet_id).catch(() => null))?.name ?? '' })));
      if (!live) return;
      setRunning(rows);
      setPicked((cur) => cur ?? (rows.length === 1 ? rows[0].id : null));
    })().catch(() => { if (live) setRunning([]); });
    return () => { live = false; };
  }, [me]);
  React.useEffect(() => {
    if (!picked) return;
    let live = true;
    fetchPetCare(picked).then((v) => { if (live) setCare(v); }, () => {});
    return () => { live = false; };
  }, [picked]);

  const send = async () => {
    if (!picked) return;
    setBusy(true); setError(null);
    try { await raiseEmergency(picked, note); setDone(true); } catch (e) {
      const code = (e as Error).message;
      setError(tr(code === 'not_allowed' ? 'emergency.notAllowed' : code === 'too_many' ? 'emergency.tooMany' : code === 'network' ? 'err.network' : 'emergency.failed'));
    } finally { setBusy(false); }
  };

  const text = (key: string, size = 16, weight: 'regular' | 'bold' | 'medium' = 'regular') => (
    <Text style={{ color: c.text, fontSize: size, lineHeight: size + 8, fontFamily: fontFamily(weight, rtl) }}>{key}</Text>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <TrustHeader title={tr('safety.emergencyTitle')} />
        {running && running.length === 0 && !picked ? text(tr('emergency.none'), 17, 'medium') : null}
        {running && running.length > 1 && !booking ? (
          <View style={{ gap: 10 }}>
            {text(tr('emergency.which'), 19, 'bold')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{running.map((r) => <Chip key={r.id} label={r.pet} selected={picked === r.id} onPress={() => setPicked(r.id)} />)}</View>
          </View>
        ) : null}
        {picked ? (
          done ? (
            <View accessible accessibilityRole="alert" style={{ padding: 18, borderRadius: 24, backgroundColor: c.surface, gap: 6 }}>
              {text(tr('emergency.sentTitle'), 19, 'bold')}
              {text(tr('emergency.sentBody'))}
            </View>
          ) : (
            <>
              {text(tr('emergency.intro'))}
              {care?.vet_phone ? (
                <View style={{ gap: 8, padding: 16, borderRadius: 24, backgroundColor: c.surface }}>
                  {text(care.vet_name ? tr('emergency.vetNamed', { name: care.vet_name }) : tr('emergency.vet'), 17, 'bold')}
                  <Button navy variant="secondary" title={tr('emergency.callVet', { phone: care.vet_phone })} onPress={() => { Linking.openURL(`tel:${care.vet_phone!.replace(/[^\d+]/g, '')}`).catch(() => {}); }} />
                </View>
              ) : null}
              <TextField label={tr('emergency.note')} hint={tr('emergency.noteHint')} value={note} onChangeText={setNote} multiline maxLength={500} style={{ minHeight: 100, paddingTop: 12, textAlignVertical: 'top' }} />
              <ErrorText>{error}</ErrorText>
              <Button navy variant="danger" title={tr('emergency.send')} disabled={busy} onPress={() => { send().catch(() => {}); }} />
              {text(tr('emergency.footer'), 14)}
            </>
          )
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function EmergencyScreen() {
  return <TrustScreen><Emergency /></TrustScreen>;
}
