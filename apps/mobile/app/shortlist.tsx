import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CardArt } from '../src/components/CardArt';
import { EmptyState } from '../src/components/EmptyState';
import { fetchShortlist, removeFromShortlist, ShortlistCard } from '../src/lib/explore';
import { fontFamily, useTheme } from '../src/theme';
import { isRTL, t as tr, tn } from '../src/i18n';

/** Hosts you liked. Tap one to open the profile; the × takes it off the list. */
export default function Shortlist() {
  const c = useTheme().color;
  const rtl = isRTL();
  const [items, setItems] = React.useState<ShortlistCard[] | null>(null);

  useFocusEffect(React.useCallback(() => {
    let live = true;
    fetchShortlist().then((l) => { if (live) setItems(l); }, () => { if (live) setItems([]); });
    return () => { live = false; };
  }, []));

  const remove = (id: string) => {
    setItems((cur) => (cur ?? []).filter((x) => x.id !== id));
    removeFromShortlist(id).catch(() => { fetchShortlist().then(setItems, () => {}); });
  };

  if (items === null) return null;
  if (items.length === 0) return <EmptyState message={tr('shortlist.empty')} art="heart" />;
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 12 }}>
      {items.map((h) => {
        const sub = [h.area, h.stays_count > 0 ? tn('count.stay', h.stays_count) : tr('card.new')].filter(Boolean).join(' · ');
        return (
          <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${h.first_name}. ${sub}`} onPress={() => router.push(`/host/${h.id}` as never)}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 96 }}>
              <CardArt illustration={h.card_illustration} background={h.card_background} compact />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{h.first_name}</Text>
                <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>{sub}</Text>
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={tr('shortlist.remove', { name: h.first_name ?? '' })} onPress={() => remove(h.id)}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: c.textMuted, fontSize: 24 }}>×</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}
