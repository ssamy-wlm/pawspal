import React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorText } from '../../src/components/StepScreen';
import { useToast } from '../../src/components/Toast';
import { useAuth } from '../../src/lib/auth';
import { Booking, fetchBooking } from '../../src/lib/bookings';
import { fetchPet } from '../../src/lib/profile';
import { addHandoverPhoto, completeBooking, HandoverKind, HandoverPhoto, handoverPhotoUrl, listHandoverPhotos } from '../../src/lib/safety';
import { fontFamily, useTheme } from '../../src/theme';
import { formatDay, isRTL, t as tr } from '../../src/i18n';

/** One thumbnail. The link comes from the server (it checks you are in the booking) and works for a minute. */
function Thumb({ photo }: { photo: HandoverPhoto }) {
  const c = useTheme().color;
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    handoverPhotoUrl(photo.id).then((u) => { if (live) setUrl(u); }, () => {});
    return () => { live = false; };
  }, [photo.id]);
  const label = tr(photo.mine ? 'handover.photoMine' : 'handover.photoTheirs', { kind: tr(photo.kind === 'dropoff' ? 'handover.dropoff' : 'handover.pickup') });
  return (
    <View accessible accessibilityLabel={label} style={{ width: 104, gap: 4 }}>
      <View style={{ width: 104, height: 104, borderRadius: 20, backgroundColor: c.surface, overflow: 'hidden' }}>
        {url ? <Image source={{ uri: url }} accessibilityIgnoresInvertColors style={{ width: 104, height: 104 }} /> : null}
      </View>
      <Text style={{ color: c.textMuted, fontSize: 12, fontFamily: fontFamily('regular', isRTL()) }}>{label}</Text>
    </View>
  );
}

/**
 * Handover day: both people photograph the pet at drop-off (the first one starts the stay) and at pick-up. The owner
 * finishes the stay after the end date, which opens reviews. The server decides what is allowed and when.
 */
export default function Handover() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const c = useTheme().color;
  const rtl = isRTL();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [state, setState] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const [booking, setBooking] = React.useState<Booking | null>(null);
  const [petName, setPetName] = React.useState('');
  const [photos, setPhotos] = React.useState<HandoverPhoto[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchAll = React.useCallback(async () => {
    if (!id) throw new Error('no booking');
    const b = await fetchBooking(id);
    if (!b || ![b.owner_id, b.sitter_id].includes(me)) throw new Error('not yours');
    const [pet, list] = await Promise.all([fetchPet(b.pet_id).catch(() => null), listHandoverPhotos(id)]);
    return { b, name: pet?.name ?? '', list };
  }, [id, me]);
  const apply = (r: { b: Booking; name: string; list: HandoverPhoto[] }) => { setBooking(r.b); setPetName(r.name); setPhotos(r.list); setState('ready'); };
  const load = async () => { apply(await fetchAll()); };
  React.useEffect(() => {
    let live = true;
    fetchAll().then((r) => { if (live) apply(r); }, () => { if (live) setState('failed'); });
    return () => { live = false; };
  }, [fetchAll]);

  const take = async (kind: HandoverKind) => {
    if (!id) return;
    setError(null);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setError(tr('handover.noCamera')); return; }
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, exif: false });
      const uri = r.canceled ? null : r.assets[0]?.uri;
      if (!uri) return;
      setBusy(true);
      await addHandoverPhoto(id, kind, uri);
      await load();
      toast.show(tr('handover.saved'));
    } catch (e) {
      const code = (e as Error).message;
      setError(tr(code === 'not_yet' ? 'handover.notYet' : code === 'too_many' ? 'handover.tooMany' : code === 'network' ? 'err.network' : 'handover.failed'));
    } finally { setBusy(false); }
  };

  const finish = async () => {
    if (!id) return;
    setBusy(true); setError(null);
    try { await completeBooking(id); await load(); toast.show(tr('handover.completed')); } catch (e) {
      setError(tr((e as Error).message === 'not_yet' ? 'handover.notFinished' : 'handover.failed'));
    } finally { setBusy(false); }
  };

  if (state === 'loading') return null;
  if (state === 'failed' || !booking) return <EmptyState message={tr('handover.loadFailed')} />;

  const isOwner = booking.owner_id === me;
  const running = booking.status === 'in_progress';
  const canDropoff = booking.status === 'confirmed' || running;
  const today = new Date().toISOString().slice(0, 10);
  const canFinish = isOwner && running && today >= booking.ends_on;
  const done = booking.status === 'completed';
  const group = (kind: HandoverKind) => photos.filter((p) => p.kind === kind);
  const section = (kind: HandoverKind, title: string, hint: string, enabled: boolean) => (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontFamily: fontFamily('bold', rtl) }}>{title}</Text>
      <Text style={{ color: c.textMuted, fontSize: 15, lineHeight: 22, fontFamily: fontFamily('regular', rtl) }}>{hint}</Text>
      {group(kind).length > 0 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{group(kind).map((p) => <Thumb key={p.id} photo={p} />)}</View> : null}
      {enabled ? <Button variant="secondary" disabled={busy} title={tr('handover.take')} onPress={() => { take(kind).catch(() => {}); }} /> : null}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, paddingBottom: 24 + insets.bottom, gap: 24 }}>
      <Stack.Screen options={{ title: tr('handover.title') }} />
      <Text style={{ color: c.textMuted, fontSize: 15, fontFamily: fontFamily('regular', rtl) }}>
        {tr('handover.intro', { pet: petName, from: formatDay(booking.starts_on), to: formatDay(booking.ends_on) })}
      </Text>
      {section('dropoff', tr('handover.dropoffTitle'), tr('handover.dropoffHint'), canDropoff)}
      {section('pickup', tr('handover.pickupTitle'), tr('handover.pickupHint'), running)}
      <ErrorText>{error}</ErrorText>
      {canFinish ? <Button disabled={busy} title={tr('handover.complete')} onPress={() => { finish().catch(() => {}); }} /> : null}
      {isOwner && running && !canFinish ? <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>{tr('handover.completeLater', { date: formatDay(booking.ends_on) })}</Text> : null}
      {done ? <Button title={tr('review.leave')} onPress={() => router.push(`/review/${booking.id}` as never)} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={tr('safety.emergencyTitle')} onPress={() => router.push(`/safety/emergency?booking=${booking.id}` as never)}
        style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: c.danger, fontSize: 15, fontFamily: fontFamily('semibold', rtl) }}>{tr('safety.emergencyTitle')}</Text>
      </Pressable>
    </ScrollView>
  );
}
