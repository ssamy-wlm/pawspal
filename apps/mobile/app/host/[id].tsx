import React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { startConversation } from '../../src/lib/chat';
import { useAuth } from '../../src/lib/auth';
import { CardArt } from '../../src/components/CardArt';
import { EmptyState } from '../../src/components/EmptyState';
import { Heading } from '../../src/components/Heading';
import { PetPhoto } from '../../src/components/PetPhoto';
import { fetchCard, fetchPets, HOME_TAGS, Pet, PublicProfile, useSignedUrl } from '../../src/lib/profile';
import { Availability, fetchAvailability } from '../../src/lib/explore';
import { fontFamily, useTheme } from '../../src/theme';
import { formatDay, isRTL, Key, t as tr } from '../../src/i18n';

function Stat({ value, label }: { value: string; label: string }) {
  const t = useTheme();
  const rtl = isRTL();
  return (
    <View accessible accessibilityLabel={`${value} ${label}`} style={{ flex: 1, minHeight: 80, borderRadius: 24, borderWidth: 2, borderColor: t.brand.sand, backgroundColor: t.color.surface, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
      <Text style={{ color: t.color.primary, fontSize: 22, fontFamily: fontFamily('extrabold', rtl) }}>{value}</Text>
      <Text style={{ color: t.color.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>{label}</Text>
    </View>
  );
}

/** A small read-only label, like the chips on mockup 03. Not a button. */
function Tag({ label, strong }: { label: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ minHeight: 40, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', backgroundColor: strong ? t.color.primary : t.color.surface,
      borderWidth: strong ? 0 : 2, borderColor: t.brand.sand }}>
      <Text style={{ color: strong ? t.color.onPrimary : t.color.text, fontSize: 14, fontFamily: fontFamily(strong ? 'semibold' : 'medium', isRTL()) }}>{label}</Text>
    </View>
  );
}

const PET_LABEL: Record<string, Key> = { dog: 'pet.dogs', cat: 'pet.cats', other: 'pet.others' };
const OFFER_LABEL: Record<string, Key> = { volunteer: 'offer.volunteer', swap: 'offer.swap', food_provided: 'offer.food_provided', stay_at_my_place: 'offer.stay_at_my_place' };

/** A host's public profile (mockup 03): card art, name, area, stats, about, their pets and home, and the Message and Request booking buttons. */
export default function HostProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme().color;
  const rtl = isRTL();
  const { session, state: auth } = useAuth();
  const insets = useSafeAreaInsets();
  const [state, setState] = React.useState<'loading' | 'ready' | 'missing'>('loading');
  const [busy, setBusy] = React.useState(false);
  const [p, setP] = React.useState<PublicProfile | null>(null);
  const [pets, setPets] = React.useState<Pet[]>([]);
  const [posts, setPosts] = React.useState<Availability[]>([]);
  const homeUrl = useSignedUrl('homes', p?.home_photo_path);

  React.useEffect(() => {
    if (!id) return;
    let live = true;
    (async () => {
      const card = await fetchCard(id);
      if (!live) return;
      if (!card) { setState('missing'); return; }
      setP(card); setState('ready');
      const [list, avail] = await Promise.all([fetchPets(id).catch(() => [] as Pet[]), fetchAvailability(id).catch(() => [] as Availability[])]);
      if (live) { setPets(list); setPosts(avail); }
    })().catch(() => { if (live) setState('missing'); });
    return () => { live = false; };
  }, [id]);

  const open = async (then: 'chat' | 'booking') => {
    if (!id || busy) return;
    setBusy(true);
    try {
      const cid = await startConversation(id);
      router.push((then === 'chat' ? `/chat/${cid}` : `/booking/new?other=${id}`) as never);
    } catch { /* the buttons stay; the person can try again */ } finally { setBusy(false); }
  };

  if (state === 'loading') return null;
  if (state === 'missing' || !p) return <EmptyState message={tr('host.notFound')} />;
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <CardArt illustration={p.card_illustration} background={p.card_background} height={240} label={tr(`art.${p.card_illustration}`)} />
      <View style={{ padding: 24, gap: 14 }}>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 28, fontFamily: fontFamily('extrabold', rtl) }}>{p.first_name}</Text>
          {p.area ? <Text style={{ color: c.textMuted, fontSize: 16, fontFamily: fontFamily('regular', rtl) }}>{p.area}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat value={p.rating_avg != null ? p.rating_avg.toFixed(1) : tr('host.noRating')} label={tr('host.ratingLabel')} />
          <Stat value={String(p.stays_count)} label={tr('host.staysLabel')} />
        </View>
        {(() => {
          const accepts = [...new Set(posts.flatMap((a) => a.pets_accepted))];
          const tags = [...accepts.filter((k) => PET_LABEL[k]).map((k) => tr(PET_LABEL[k])), ...p.home_tags.filter((k) => HOME_TAGS.includes(k)).map((k) => tr(`tag.${k}`))];
          return tags.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }} accessible accessibilityLabel={tags.join(', ')}>
              {tags.map((x) => <Tag key={x} label={x} />)}
            </View>
          ) : null;
        })()}
        <Heading>{tr('host.about')}</Heading>
        <Text style={{ color: p.bio ? c.text : c.textMuted, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('regular', rtl) }}>{p.bio || tr('host.noBio')}</Text>
        {posts.length > 0 ? (
          <>
            <Heading>{tr('host.available')}</Heading>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {posts.map((a) => <Tag key={a.id} strong label={`${formatDay(a.starts_on)} – ${formatDay(a.ends_on)}`} />)}
            </View>
            <Heading>{tr('host.terms')}</Heading>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[...new Set(posts.flatMap((a) => a.offers))].map((o) => {
                if (o === 'paid') {
                  const paidPost = posts.find((a) => a.offers.includes('paid') && a.price_per_night != null);
                  return paidPost ? <Tag key={o} strong label={`${tr('price.egp', { amount: paidPost.price_per_night as number })} ${tr(paidPost.negotiable ? 'card.perNightNegotiable' : 'card.perNight')}`} /> : null;
                }
                return OFFER_LABEL[o] ? <Tag key={o} label={tr(OFFER_LABEL[o])} /> : null;
              })}
            </View>
          </>
        ) : null}
        {pets.length > 0 ? (
          <>
            <Heading>{tr('host.pets')}</Heading>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {pets.map((pet) => (
                <Pressable key={pet.id} accessibilityRole="button" accessibilityLabel={pet.name} onPress={() => router.push(`/pets/${pet.id}` as never)} style={{ alignItems: 'center', gap: 4, minWidth: 88, minHeight: 44 }}>
                  <PetPhoto path={pet.photo_paths[0]} size={88} />
                  <Text style={{ color: c.text, fontSize: 14, fontFamily: fontFamily('medium', rtl) }}>{pet.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        {homeUrl ? (
          <>
            <Heading>{tr('host.home')}</Heading>
            <Image source={{ uri: homeUrl }} accessible accessibilityLabel={tr('host.home')} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 20 }} resizeMode="cover" />
          </>
        ) : null}
      </View>
    </ScrollView>
    {session && id !== session.user.id ? (
      <View style={{ flexDirection: 'row', gap: 12, padding: 16, paddingBottom: insets.bottom + 16, backgroundColor: c.background }}>
        <View style={{ flex: 1 }}><Button variant="secondary" title={tr('booking.message')} disabled={busy} onPress={() => { open('chat').catch(() => {}); }} /></View>
        {p.role !== 'owner' && auth?.role !== 'sitter' ? <View style={{ flex: 1 }}><Button title={tr('booking.request')} disabled={busy} onPress={() => { open('booking').catch(() => {}); }} /></View> : null}
      </View>
    ) : null}
    </View>
  );
}
