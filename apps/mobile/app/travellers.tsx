import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CardArt } from '../src/components/CardArt';
import { EmptyState } from '../src/components/EmptyState';
import { Chip } from '../src/components/Chip';
import { browseTravellers, Traveller } from '../src/lib/explore';
import type { PetType } from '../src/lib/search';
import { fontFamily, useTheme } from '../src/theme';
import { formatDay, isRTL, Key, t as tr } from '../src/i18n';

const PETS: PetType[] = ['dog', 'cat', 'other'];
const PET_PLURAL: Record<PetType, Key> = { dog: 'pet.dogs', cat: 'pet.cats', other: 'pet.others' };

/** For hosts: pet owners who are travelling and looking for someone. */
export default function Travellers() {
  const c = useTheme().color;
  const rtl = isRTL();
  const [pet, setPet] = React.useState<PetType | null>(null);
  const [items, setItems] = React.useState<Traveller[] | null>(null);

  React.useEffect(() => {
    let live = true;
    browseTravellers(pet).then((l) => { if (live) setItems(l); }, () => { if (live) setItems([]); });
    return () => { live = false; };
  }, [pet]);

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 12, flexGrow: 1 }}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {PETS.map((p) => <Chip key={p} label={tr(PET_PLURAL[p])} selected={pet === p} onPress={() => setPet(pet === p ? null : p)} />)}
      </View>
      {items === null ? null : items.length === 0 ? <EmptyState message={tr('travellers.empty')} art="catMango" /> : items.map((t) => {
        const dates = `${formatDay(t.starts_on)} – ${formatDay(t.ends_on)}`;
        const budget = t.budget_per_night != null ? `${tr('price.egp', { amount: t.budget_per_night })} ${tr('card.perNight')}` : null;
        return (
          <Pressable key={t.post_id} accessibilityRole="button" accessibilityLabel={[t.first_name, tr(PET_PLURAL[t.pet_type]), dates, budget, t.note].filter(Boolean).join('. ')}
            onPress={() => router.push(`/host/${t.user_id}` as never)}
            style={{ flexDirection: 'row', gap: 12, padding: 12, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
            <CardArt illustration={t.card_illustration} background={t.card_background} compact />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{t.first_name}</Text>
              <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>{[t.area, tr(PET_PLURAL[t.pet_type])].filter(Boolean).join(' · ')}</Text>
              <Text style={{ color: c.text, fontSize: 14, fontFamily: fontFamily('medium', rtl) }}>{dates}</Text>
              {budget ? <Text style={{ color: c.primary, fontSize: 14, fontFamily: fontFamily('semibold', rtl) }}>{budget}</Text> : null}
              {t.note ? <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }} numberOfLines={2}>{t.note}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
