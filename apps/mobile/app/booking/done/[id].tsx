import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '../../../src/components/Toast';
import { success as celebrate } from '../../../src/lib/haptics';
import { Button } from '../../../src/components/Button';
import { CardArt } from '../../../src/components/CardArt';
import { CheckStamp } from '../../../src/components/CheckStamp';
import { EmptyState } from '../../../src/components/EmptyState';
import { MapCard } from '../../../src/components/MapCard';
import { PetPhoto } from '../../../src/components/PetPhoto';
import { useAuth } from '../../../src/lib/auth';
import { Booking, BookingLocation, fetchBooking, fetchBookingLocation, termsText } from '../../../src/lib/bookings';
import { startConversation } from '../../../src/lib/chat';
import { fetchCard, fetchPet, Pet, PublicProfile } from '../../../src/lib/profile';
import { fontFamily, useTheme } from '../../../src/theme';
import { formatDay, isRTL, t as tr, tn } from '../../../src/i18n';
import { nights } from '../../../src/lib/search';

/**
 * "Booking confirmed" (mockup 17): the stamp, the dates, who stays with whom, and the exact pin with directions. The pin
 * comes from get_booking_location, which only answers the two people in a paid booking.
 */
export default function BookingDone() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [state, setState] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const [booking, setBooking] = React.useState<Booking | null>(null);
  const [pet, setPet] = React.useState<Pet | null>(null);
  const [host, setHost] = React.useState<PublicProfile | null>(null);
  const [other, setOther] = React.useState<PublicProfile | null>(null);
  const [place, setPlace] = React.useState<BookingLocation | null>(null);

  React.useEffect(() => {
    if (!id) return;
    let live = true;
    (async () => {
      const b = await fetchBooking(id);
      if (!live) return;
      if (!b || (b.status !== 'confirmed' && b.status !== 'in_progress' && b.status !== 'completed') || ![b.owner_id, b.sitter_id].includes(me)) { setState('failed'); return; }
      const hostId = b.stay_location === 'sitter_home' ? b.sitter_id : b.owner_id;
      const otherId = b.owner_id === me ? b.sitter_id : b.owner_id;
      const [p, h, o, loc] = await Promise.all([fetchPet(b.pet_id), fetchCard(hostId), fetchCard(otherId), fetchBookingLocation(id)]);
      if (!live) return;
      setBooking(b); setPet(p); setHost(h); setOther(o); setPlace(loc); setState('ready');
    })().catch(() => { if (live) setState('failed'); });
    return () => { live = false; };
  }, [id, me]);

  React.useEffect(() => { if (state === 'ready') celebrate(); }, [state]);     // one success buzz when the confirmation appears

  if (state === 'loading') return null;
  if (state === 'failed' || !booking) return <EmptyState message={tr('confirmed.failed')} />;

  const n = nights(booking.starts_on, booking.ends_on);
  const terms = termsText(booking, pet?.name ?? '');
  const messageOther = async () => {
    if (!other) return;
    try { router.push(`/chat/${await startConversation(booking.owner_id === me ? booking.sitter_id : booking.owner_id)}` as never); } catch { toast.show(tr('chat.loadFailed'), 'error'); }
  };

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, paddingBottom: 24 + insets.bottom, gap: 16, alignItems: 'stretch' }}>
      <Stack.Screen options={{ title: '' }} />
      <View style={{ alignItems: 'center', gap: 8 }}>
        <CheckStamp size={140} />
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 28, fontFamily: fontFamily('extrabold', rtl), textAlign: 'center' }}>{tr('confirmed.title')}</Text>
        <Text style={{ color: c.textMuted, fontSize: 16, fontFamily: fontFamily('regular', rtl), textAlign: 'center' }}>
          {tr('confirmed.dates', { from: formatDay(booking.starts_on), to: formatDay(booking.ends_on), nights: tn('count.night', n) })}
        </Text>
      </View>

      <View accessible accessibilityLabel={`${tr('confirmed.stays', { pet: pet?.name ?? '', host: host?.first_name ?? '' })}. ${terms.cost}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 28, backgroundColor: c.surface, borderWidth: 2, borderColor: t.brand.sand }}>
        {host ? <CardArt illustration={host.card_illustration} background={host.card_background} compact /> : null}
        <PetPhoto path={pet?.photo_paths[0]} size={64} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{tr('confirmed.stays', { pet: pet?.name ?? '', host: host?.first_name ?? '' })}</Text>
          <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>{terms.cost}</Text>
        </View>
      </View>

      {place ? (
        <MapCard exact lat={place.lat} lng={place.lng} address={place.address} />
      ) : (
        <Text style={{ color: c.textMuted, fontSize: 15, lineHeight: 22, fontFamily: fontFamily('regular', rtl), textAlign: 'center' }}>{tr('confirmed.noPin')}</Text>
      )}

      <Button variant="secondary" title={tr('confirmed.message', { name: other?.first_name ?? '' })} onPress={() => { messageOther().catch(() => {}); }} />

      <View accessible style={{ padding: 18, borderRadius: 24, backgroundColor: t.tint.orange, gap: 2 }}>
        <Text style={{ color: t.brand.navy, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{tr('confirmed.handover')}</Text>
        <Text style={{ color: t.brand.navy, fontSize: 15, fontFamily: fontFamily('regular', rtl) }}>{tr('confirmed.handoverBody', { pet: pet?.name ?? '' })}</Text>
      </View>
      <Button title={tr(booking.status === 'completed' ? 'review.leave' : 'handover.open')} onPress={() => router.push((booking.status === 'completed' ? `/review/${booking.id}` : `/handover/${booking.id}`) as never)} />
      {booking.status === 'completed' ? <Button variant="secondary" title={tr('handover.open')} onPress={() => router.push(`/handover/${booking.id}` as never)} /> : (
        <Pressable accessibilityRole="button" accessibilityLabel={tr('safety.emergencyTitle')} onPress={() => router.push(`/safety/emergency?booking=${booking.id}` as never)} style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: c.danger, fontSize: 15, fontFamily: fontFamily('semibold', rtl) }}>{tr('safety.emergencyTitle')}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
