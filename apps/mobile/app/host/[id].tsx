import React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CardArt } from '../../src/components/CardArt';
import { EmptyState } from '../../src/components/EmptyState';
import { Heading } from '../../src/components/Heading';
import { PetPhoto } from '../../src/components/PetPhoto';
import { fetchCard, fetchPets, Pet, PublicProfile, useSignedUrl } from '../../src/lib/profile';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr } from '../../src/i18n';

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

/** A host's public profile (mockup 03): card art, name, area, stats, about, their pets and home. Booking buttons arrive with chat and bookings. */
export default function HostProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useTheme().color;
  const rtl = isRTL();
  const [state, setState] = React.useState<'loading' | 'ready' | 'missing'>('loading');
  const [p, setP] = React.useState<PublicProfile | null>(null);
  const [pets, setPets] = React.useState<Pet[]>([]);
  const homeUrl = useSignedUrl('homes', p?.home_photo_path);

  React.useEffect(() => {
    if (!id) return;
    let live = true;
    (async () => {
      const card = await fetchCard(id);
      if (!live) return;
      if (!card) { setState('missing'); return; }
      setP(card); setState('ready');
      const list = await fetchPets(id).catch(() => [] as Pet[]);
      if (live) setPets(list);
    })().catch(() => { if (live) setState('missing'); });
    return () => { live = false; };
  }, [id]);

  if (state === 'loading') return null;
  if (state === 'missing' || !p) return <EmptyState message={tr('host.notFound')} />;
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      <CardArt illustration={p.card_illustration} background={p.card_background} height={240} label={tr(`art.${p.card_illustration}`)} />
      <View style={{ padding: 24, gap: 14 }}>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 28, fontFamily: fontFamily('extrabold', rtl) }}>{p.first_name}</Text>
          {p.area ? <Text style={{ color: c.textMuted, fontSize: 16, fontFamily: fontFamily('regular', rtl) }}>{p.area}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat value={p.rating_avg != null ? String(p.rating_avg) : tr('host.noRating')} label={tr('host.ratingLabel')} />
          <Stat value={String(p.stays_count)} label={tr('host.staysLabel')} />
        </View>
        <Heading>{tr('host.about')}</Heading>
        <Text style={{ color: p.bio ? c.text : c.textMuted, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('regular', rtl) }}>{p.bio || tr('host.noBio')}</Text>
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
            <Image source={{ uri: homeUrl }} accessibilityLabel={tr('host.home')} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 20 }} resizeMode="cover" />
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}
