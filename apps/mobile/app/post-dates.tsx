import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../src/components/Button';
import { CalendarRange } from '../src/components/CalendarRange';
import { Chip } from '../src/components/Chip';
import { Heading } from '../src/components/Heading';
import { ErrorText } from '../src/components/StepScreen';
import { TextField } from '../src/components/TextField';
import { useToast } from '../src/components/Toast';
import { useAuth } from '../src/lib/auth';
import { postAvailability, postTravel } from '../src/lib/explore';
import type { Offer, PetType } from '../src/lib/search';
import { fontFamily, useTheme } from '../src/theme';
import { isRTL, Key, t as tr } from '../src/i18n';

const PETS: { key: PetType; label: Key }[] = [{ key: 'dog', label: 'pet.dogs' }, { key: 'cat', label: 'pet.cats' }, { key: 'other', label: 'pet.others' }];
const OFFERS: { key: Offer; label: Key }[] = [
  { key: 'volunteer', label: 'offer.volunteer' }, { key: 'swap', label: 'offer.swap' }, { key: 'paid', label: 'offer.paid' },
  { key: 'food_provided', label: 'offer.food_provided' }, { key: 'stay_at_my_place', label: 'offer.stay_at_my_place' },
];
const digits = (v: string) => v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '').slice(0, 6);

/** "Post your dates" (mockup 05). Hosts post when they can host; pet owners post when they are travelling. */
export default function PostDates() {
  const { session, state } = useAuth();
  const userId = session?.user.id ?? '';
  const role = state?.role ?? 'both';
  const c = useTheme().color;
  const rtl = isRTL();
  const toast = useToast();
  const [kind, setKind] = React.useState<'host' | 'travel'>(role === 'owner' ? 'travel' : 'host');
  const [start, setStart] = React.useState<string | null>(null);
  const [end, setEnd] = React.useState<string | null>(null);
  const [pets, setPets] = React.useState<PetType[]>(['dog', 'cat']);
  const [offers, setOffers] = React.useState<Offer[]>(['paid']);
  const [price, setPrice] = React.useState('');
  const [negotiable, setNegotiable] = React.useState(false);
  const [travelPet, setTravelPet] = React.useState<PetType>('dog');
  const [budget, setBudget] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const paid = offers.includes('paid');
  const ready = !!start && !!end && (kind === 'travel' || (pets.length > 0 && offers.length > 0 && (!paid || price !== '')));

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = async () => {
    if (!start || !end) return;
    setBusy(true); setError(null);
    try {
      if (kind === 'host') {
        await postAvailability(userId, { starts_on: start, ends_on: end, pets_accepted: pets, offers, price_per_night: paid ? Number(price) : null, negotiable: paid && negotiable });
      } else {
        await postTravel(userId, { pet_type: travelPet, starts_on: start, ends_on: end, budget_per_night: budget === '' ? null : Number(budget), note });
      }
      toast.show(tr('post.posted'));
      router.back();
    } catch (e) { setError(tr((e as Error).message === 'too_many' ? 'post.tooMany' : 'post.failed')); } finally { setBusy(false); }
  };

  const label = (k: Key) => <Text style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{tr(k)}</Text>;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {role === 'both' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label={tr('post.host')} selected={kind === 'host'} onPress={() => setKind('host')} />
            <Chip label={tr('post.travel')} selected={kind === 'travel'} onPress={() => setKind('travel')} />
          </View>
        ) : null}
        <Heading>{tr('post.dates')}</Heading>
        <View style={{ padding: 16, borderRadius: 24, backgroundColor: c.surface }}>
          <CalendarRange start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
        </View>

        {kind === 'host' ? (
          <>
            {label('post.canHost')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PETS.map((p) => <Chip key={p.key} label={tr(p.label)} selected={pets.includes(p.key)} onPress={() => setPets((cur) => toggle(cur, p.key))} />)}
            </View>
            {label('post.offer')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {OFFERS.map((o) => <Chip key={o.key} label={tr(o.label)} selected={offers.includes(o.key)} onPress={() => setOffers((cur) => toggle(cur, o.key))} />)}
            </View>
            {paid ? (
              <>
                <TextField label={tr('post.price')} value={price} onChangeText={(v) => setPrice(digits(v))} keyboardType="number-pad" />
                <View style={{ flexDirection: 'row' }}><Chip label={tr('post.negotiable')} selected={negotiable} onPress={() => setNegotiable((v) => !v)} /></View>
              </>
            ) : null}
            <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>{tr('post.agree')}</Text>
          </>
        ) : (
          <>
            {label('post.travelPet')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PETS.map((p) => <Chip key={p.key} label={tr(p.label)} selected={travelPet === p.key} onPress={() => setTravelPet(p.key)} />)}
            </View>
            <TextField label={tr('post.budget')} value={budget} onChangeText={(v) => setBudget(digits(v))} keyboardType="number-pad" />
            <TextField label={tr('post.note')} value={note} onChangeText={setNote} maxLength={200} multiline style={{ minHeight: 90, textAlignVertical: 'top', paddingTop: 14 }} />
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <Button title={kind === 'host' ? tr('post.submit') : tr('post.submitTravel')} disabled={!ready || busy} onPress={() => { submit().catch(() => {}); }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
