import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CardArt } from '../../src/components/CardArt';
import { EmptyState } from '../../src/components/EmptyState';
import { Conversation, fetchConversations, listenToActivity } from '../../src/lib/chat';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr } from '../../src/i18n';

const time = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(isRTL() ? 'ar-u-nu-latn' : 'en', sameDay ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(d);
};

/** Your conversations, newest first, with unread counts. Updates live when a message arrives. */
export default function ChatTab() {
  const c = useTheme().color;
  const t = useTheme();
  const rtl = isRTL();
  const [items, setItems] = React.useState<Conversation[] | null>(null);

  const load = React.useCallback(() => { fetchConversations().then(setItems, () => setItems((cur) => cur ?? [])); }, []);
  useFocusEffect(React.useCallback(() => { load(); return listenToActivity(load); }, [load]));

  if (items === null) return null;
  if (items.length === 0) return <View style={{ flex: 1, backgroundColor: c.background }}><EmptyState message={tr('chat.empty')} actionLabel={tr('empty.findHost')} onAction={() => router.navigate('/(tabs)/explore')} /></View>;
  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      contentContainerStyle={{ padding: 24, gap: 12 }}
      data={items}
      keyExtractor={(x) => x.id}
      renderItem={({ item }) => {
        const preview = item.last_body ? (item.last_mine ? tr('chat.you', { text: item.last_body }) : item.last_body) : tr('chat.noMessages');
        return (
          <Pressable accessibilityRole="button"
            accessibilityLabel={[item.first_name, item.unread > 0 ? tr('chat.unread', { n: item.unread }) : null, preview].filter(Boolean).join('. ')}
            onPress={() => router.push(`/chat/${item.id}` as never)}
            style={{ minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
            <CardArt illustration={item.card_illustration} background={item.card_background} compact />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text numberOfLines={1} style={{ flexShrink: 1, color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{item.first_name}</Text>
                <Text style={{ color: c.textMuted, fontSize: 12, fontFamily: fontFamily('regular', rtl) }}>{time(item.last_at)}</Text>
              </View>
              <Text numberOfLines={2} style={{ color: item.unread > 0 ? c.text : c.textMuted, fontSize: 14, fontFamily: fontFamily(item.unread > 0 ? 'semibold' : 'regular', rtl) }}>{preview}</Text>
            </View>
            {item.unread > 0 ? (
              <View accessible={false} style={{ minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 8, backgroundColor: t.brand.orange, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.color.onAccent, fontSize: 13, fontFamily: fontFamily('bold', false) }}>{item.unread}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}
