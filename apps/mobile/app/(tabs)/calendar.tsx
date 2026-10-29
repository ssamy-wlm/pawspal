import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/EmptyState';
import { Heading } from '../../src/components/Heading';
import { useAuth } from '../../src/lib/auth';
import { Availability, deleteAvailability, deleteTravelPost, fetchAvailability, fetchTravelPosts, TravelPost } from '../../src/lib/explore';
import { fontFamily, useTheme } from '../../src/theme';
import { formatDay, isRTL, t as tr } from '../../src/i18n';

/** Your posted dates (hosting and travelling), with a button to post more. Bookings join them in phase 5. */
export default function CalendarTab() {
  const { session, state } = useAuth();
  const userId = session?.user.id;
  const role = state?.role ?? 'both';
  const c = useTheme().color;
  const rtl = isRTL();
  const [hosting, setHosting] = React.useState<Availability[]>([]);
  const [travelling, setTravelling] = React.useState<TravelPost[]>([]);
  const [sure, setSure] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!userId) return () => {};
    let live = true;
    if (role !== 'owner') fetchAvailability(userId).then((l) => { if (live) setHosting(l); }, () => {});
    if (role !== 'sitter') fetchTravelPosts(userId).then((l) => { if (live) setTravelling(l); }, () => {});
    return () => { live = false; };
  }, [userId, role]);
  useFocusEffect(load);

  const remove = async (kind: 'host' | 'travel', id: string) => {
    if (sure !== id) { setSure(id); return; }
    setSure(null);
    try {
      if (kind === 'host') { await deleteAvailability(id); setHosting((l) => l.filter((x) => x.id !== id)); }
      else { await deleteTravelPost(id); setTravelling((l) => l.filter((x) => x.id !== id)); }
    } catch { /* the post stays; the person can try again */ }
  };

  const post = (kind: 'host' | 'travel', id: string, text: string) => (
    <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingStart: 16, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
      <Text style={{ flex: 1, color: c.text, fontSize: 16, fontFamily: fontFamily('medium', rtl) }}>{text}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={sure === id ? tr('pet.deleteSure') : tr('post.remove')} onPress={() => { remove(kind, id).catch(() => {}); }}
        style={{ minHeight: 56, minWidth: 56, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: sure === id ? c.danger : c.textMuted, fontSize: sure === id ? 14 : 24, fontFamily: fontFamily('semibold', rtl) }}>{sure === id ? tr('pet.deleteSure') : '×'}</Text>
      </Pressable>
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 12, flexGrow: 1 }}>
      {hosting.length + travelling.length > 0 ? <Heading>{tr('calendar.myPosts')}</Heading> : null}
      {hosting.map((a) => post('host', a.id, tr('post.hosting', { from: formatDay(a.starts_on), to: formatDay(a.ends_on) })))}
      {travelling.map((t) => post('travel', t.id, tr('post.travelling', { from: formatDay(t.starts_on), to: formatDay(t.ends_on) })))}
      <Button title={tr('explore.post')} variant={hosting.length + travelling.length > 0 ? 'secondary' : 'primary'} onPress={() => router.push('/post-dates' as never)} />
      <EmptyState message={tr('calendar.empty')} actionLabel={tr('empty.findHost')} onAction={() => router.navigate('/(tabs)/explore')} />
    </ScrollView>
  );
}
