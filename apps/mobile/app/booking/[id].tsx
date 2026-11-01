import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { CalendarRange } from '../../src/components/CalendarRange';
import { Chip } from '../../src/components/Chip';
import { EmptyState } from '../../src/components/EmptyState';
import { Heading } from '../../src/components/Heading';
import { ErrorText } from '../../src/components/StepScreen';
import { TextField } from '../../src/components/TextField';
import { useToast } from '../../src/components/Toast';
import { useAuth } from '../../src/lib/auth';
import { fetchBooking, proposeTerms, requestBooking, StayLocation } from '../../src/lib/bookings';
import { fetchCard, fetchPets, Pet, PublicProfile } from '../../src/lib/profile';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr } from '../../src/i18n';

const digits = (v: string) => v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '').slice(0, 6);

/**
 * Ask for a stay (id "new"), or change the terms of a request (a booking id). Either side can change the terms
 * until the booking is confirmed; a change clears both people's acceptance, and the database makes that so.
 */
export default function BookingScreen() {
  const { id, other } = useLocalSearchParams<{ id: string; other?: string }>();
  const isNew = id === 'new';
  const { session, state: auth } = useAuth();
  const me = session?.user.id ?? '';
  const c = useTheme().color;
  const rtl = isRTL();
  const toast = useToast();
  const [ready, setReady] = React.useState<'loading' | 'ready' | 'missing'>('loading');
  const [otherCard, setOtherCard] = React.useState<PublicProfile | null>(null);
  const [myPets, setMyPets] = React.useState<Pet[]>([]);
  const [petId, setPetId] = React.useState<string | null>(null);
  const [start, setStart] = React.useState<string | null>(null);
  const [end, setEnd] = React.useState<string | null>(null);
  const [location, setLocation] = React.useState<StayLocation>('sitter_home');
  const [cost, setCost] = React.useState<'volunteer' | 'paid'>('volunteer');
  const [price, setPrice] = React.useState('');
  const [food, setFood] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    (async () => {
      if (isNew) {
        if (!other || !me) { if (live) setReady('missing'); return; }
        const [card, mine] = await Promise.all([fetchCard(other), fetchPets(me)]);
        if (!live) return;
        if (!card) { setReady('missing'); return; }
        setOtherCard(card); setMyPets(mine); setPetId(mine[0]?.id ?? null);
        setReady('ready');
      } else {
        const b = await fetchBooking(id!);
        if (!live) return;
        if (!b || b.status !== 'requested') { setReady('missing'); return; }
        setStart(b.starts_on); setEnd(b.ends_on); setLocation(b.stay_location);
        setCost(b.cost_type === 'paid' ? 'paid' : 'volunteer'); setPrice(b.price_per_night != null ? String(b.price_per_night) : ''); setFood(b.food_provided);
        setReady('ready');
      }
    })().catch(() => { if (live) setReady('missing'); });
    return () => { live = false; };
  }, [id, isNew, other, me]);

  const paid = cost === 'paid';
  // An owner asks a host. The database checks the same rules; this only keeps people from a request that would be refused.
  const allowed = !isNew || (auth?.role !== 'sitter' && otherCard?.role === 'sitter');
  const ok = !!start && !!end && (!isNew || !!petId) && (!paid || Number(price) > 0) && allowed;

  const submit = async () => {
    if (!start || !end) return;
    setBusy(true); setError(null);
    try {
      if (!isNew) {
        await proposeTerms(id!, { starts_on: start, ends_on: end, location, cost, price: paid ? Number(price) : null, food });
      } else {
        await requestBooking({ sitterId: other!, petId: petId!, starts_on: start, ends_on: end, location, cost, price: paid ? Number(price) : null, food });
      }
      toast.show(tr('post.posted'));
      router.back();
    } catch (e) {
      const m = (e as Error).message;
      setError(tr(m === 'duplicate' ? 'booking.duplicate' : m === 'too_many' ? 'booking.tooMany' : m === 'pet_booked' ? 'booking.petBooked' : 'booking.failed'));
    } finally { setBusy(false); }
  };

  if (ready === 'loading') return null;
  if (ready === 'missing') return <EmptyState message={tr('booking.failed')} />;
  if (isNew && myPets.length === 0) return <EmptyState message={tr('booking.noPets')} actionLabel={tr('pets.add')} onAction={() => router.push('/pets/new')} art="catMango" />;

  const label = (text: string) => <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('medium', rtl) }}>{text}</Text>;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? tr('booking.title.new') : tr('booking.title.edit') }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {isNew ? (
          <>
            <Heading>{tr('booking.yourPet')}</Heading>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{myPets.map((p) => <Chip key={p.id} label={p.name} selected={petId === p.id} onPress={() => setPetId(p.id)} />)}</View>
          </>
        ) : null}

        <Heading>{tr('post.dates')}</Heading>
        <View style={{ padding: 16, borderRadius: 24, backgroundColor: c.surface }}><CalendarRange start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} /></View>
        <Heading>{tr('booking.where')}</Heading>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label={tr('booking.at.sitter')} selected={location === 'sitter_home'} onPress={() => setLocation('sitter_home')} />
          <Chip label={tr('booking.at.owner')} selected={location === 'owner_home'} onPress={() => setLocation('owner_home')} />
        </View>
        <Heading>{tr('booking.cost')}</Heading>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label={tr('booking.cost.volunteer')} selected={cost === 'volunteer'} onPress={() => setCost('volunteer')} />
          <Chip label={tr('booking.cost.paid')} selected={cost === 'paid'} onPress={() => setCost('paid')} />
        </View>
        {cost === 'paid' ? <TextField label={tr('booking.price')} value={price} onChangeText={(v) => setPrice(digits(v))} keyboardType="number-pad" /> : null}
        <View style={{ flexDirection: 'row' }}><Chip label={tr('booking.food')} selected={food} onPress={() => setFood((v) => !v)} /></View>
        {label(tr('post.agree'))}
        {label(tr('terms.ownArrangement'))}
        {isNew ? (
          <Pressable accessibilityRole="link" accessibilityLabel={tr('booking.disclaimer')} onPress={() => router.push('/legal/termsOfService' as never)} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: c.link, fontSize: 14, fontFamily: fontFamily('medium', rtl), textDecorationLine: 'underline' }}>{tr('booking.disclaimer')}</Text>
          </Pressable>
        ) : null}
        <ErrorText>{error}</ErrorText>
        <Button title={isNew ? tr('booking.send') : tr('booking.save')} disabled={!ok || busy} onPress={() => { submit().catch(() => {}); }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
