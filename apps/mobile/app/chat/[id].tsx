import React from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { ChatBubble } from '../../src/components/ChatBubble';
import { EmptyState } from '../../src/components/EmptyState';
import { TermsCard } from '../../src/components/TermsCard';
import { TextField } from '../../src/components/TextField';
import { useAuth } from '../../src/lib/auth';
import { acceptedByMe, acceptedByOther, acceptTerms, Booking, cancelBooking, currentBookings, fetchBookingsBetween, termsText } from '../../src/lib/bookings';
import { Conversation, fetchConversations, fetchMessages, listenToActivity, listenToMessages, markRead, Message, PAGE_SIZE, sendMessage } from '../../src/lib/chat';
import { fetchCard, fetchPet, PublicProfile } from '../../src/lib/profile';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr } from '../../src/i18n';

/**
 * One conversation: the messages (new ones arrive live), the booking terms card when there is a request, and the way to
 * ask for a booking. Contact details in messages are hidden by the server until a booking is confirmed.
 */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, state: auth } = useAuth();
  const me = session?.user.id ?? '';
  const c = useTheme().color;
  const rtl = isRTL();
  const [state, setState] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const [other, setOther] = React.useState<Conversation | null>(null);
  const [otherCard, setOtherCard] = React.useState<PublicProfile | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);     // newest first
  const [more, setMore] = React.useState(false);
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [legs, setLegs] = React.useState<Booking[]>([]);
  const [petNames, setPetNames] = React.useState<Record<string, string>>({});
  const [sure, setSure] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const loadBookings = React.useCallback(async (otherId: string) => {
    const all = await fetchBookingsBetween(me, otherId).catch(() => [] as Booking[]);
    const current = currentBookings(all);
    setLegs(current);
    const names: Record<string, string> = {};
    await Promise.all(current.map(async (b) => { const p = await fetchPet(b.pet_id).catch(() => null); if (p) names[b.pet_id] = p.name; }));
    setPetNames((cur) => ({ ...cur, ...names }));
  }, [me]);

  React.useEffect(() => {
    if (!id) return;
    let live = true;
    (async () => {
      const list = await fetchConversations();
      const conv = list.find((x) => x.id === id) ?? null;
      if (!conv) { if (live) setState('failed'); return; }
      const [first, card] = await Promise.all([fetchMessages(id), fetchCard(conv.other_id).catch(() => null)]);
      if (!live) return;
      setOther(conv); setOtherCard(card); setMessages(first); setMore(first.length === PAGE_SIZE); setState('ready');
      markRead(id).catch(() => {});
      await loadBookings(conv.other_id);
    })().catch(() => { if (live) setState('failed'); });
    return () => { live = false; };
  }, [id, loadBookings]);

  React.useEffect(() => {
    if (!id || !other) return;
    const stopMessages = listenToMessages(id, (m) => {
      setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [m, ...cur]));
      if (m.sender_id !== me) markRead(id).catch(() => {});
    });
    const stopActivity = listenToActivity(() => { loadBookings(other.other_id).catch(() => {}); });
    return () => { stopMessages(); stopActivity(); };
  }, [id, other, me, loadBookings]);

  const send = async () => {
    const body = text.trim();
    if (!body || !id || sending) return;
    setSending(true); setError(null);
    try {
      const m = await sendMessage(id, me, body);
      setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [m, ...cur]));
      setText('');
    } catch (e) { setError(tr((e as Error).message === 'slow_down' ? 'chat.slowDown' : 'chat.sendFailed')); } finally { setSending(false); }
  };

  const loadOlder = async () => {
    if (!id || !more || messages.length === 0) return;
    const older = await fetchMessages(id, messages[messages.length - 1].id).catch(() => [] as Message[]);
    setMore(older.length === PAGE_SIZE);
    setMessages((cur) => [...cur, ...older.filter((o) => !cur.some((x) => x.id === o.id))]);
  };

  const accept = async () => { if (legs[0]) { setBusy(true); try { await acceptTerms(legs[0].id); await loadBookings(other!.other_id); } catch { setError(tr('booking.failed')); } finally { setBusy(false); } } };
  const cancel = async () => {
    if (!sure) { setSure(true); return; }
    if (!legs[0]) return;
    setBusy(true);
    try { await cancelBooking(legs[0].id); setSure(false); await loadBookings(other!.other_id); } catch { setError(tr('booking.failed')); } finally { setBusy(false); }
  };

  if (state === 'loading') return null;
  if (state === 'failed' || !other) return <EmptyState message={tr('chat.loadFailed')} />;

  const confirmed = legs.some((b) => b.status === 'confirmed' || b.status === 'in_progress');
  const status = legs[0]?.status;
  const mine = acceptedByMe(legs, me);
  const theirs = acceptedByOther(legs, me);
  // I can ask for a stay only if I have pets to place and they host (the database checks the same).
  const canRequest = !!otherCard && otherCard.role !== 'owner' && auth?.role !== 'sitter';

  const bookingPanel = (
    <View style={{ gap: 12, paddingHorizontal: 16, paddingTop: 12 }}>
      {legs.length > 0 && status !== 'cancelled' ? (
        <>
          {legs.map((b) => (
            <TermsCard key={b.id}
              title={legs.length > 1 ? tr(b.owner_id === me ? 'terms.leg.mine' : 'terms.leg.theirs') : undefined}
              terms={termsText(b, petNames[b.pet_id] ?? '')} accepted={mine}
              onAccept={() => { accept().catch(() => {}); }} onChange={() => router.push(`/booking/${b.id}?other=${other.other_id}` as never)} />
          ))}
          <Text accessibilityRole="alert" style={{ color: c.text, fontSize: 15, fontFamily: fontFamily('semibold', rtl) }}>
            {status === 'confirmed' || status === 'in_progress' ? tr('booking.status.confirmed')
              : status === 'terms_agreed' ? tr('booking.status.agreed')
              : mine && !theirs ? tr('booking.status.waiting', { name: other.first_name ?? '' }) : tr('booking.status.requested')}
          </Text>
          {!confirmed ? <Button variant="secondary" disabled={busy} title={sure ? tr('booking.cancelSure') : tr('booking.cancel')} onPress={() => { cancel().catch(() => {}); }} /> : null}
        </>
      ) : !canRequest ? null : (
        <Button variant="secondary" title={tr('booking.request')} onPress={() => router.push(`/booking/new?other=${other.other_id}` as never)} />
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: other.first_name ?? '' }} />
      <ScrollView style={{ maxHeight: '45%', flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }}>{bookingPanel}</ScrollView>
      <FlatList
        inverted
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        onEndReached={() => { loadOlder().catch(() => {}); }}
        ListEmptyComponent={<Text style={{ color: c.textMuted, textAlign: 'center', fontFamily: fontFamily('regular', rtl), transform: [{ scaleY: -1 }] }}>{tr('chat.noMessages')}</Text>}
        renderItem={({ item }) => <ChatBubble text={item.body} mine={item.sender_id === me} masked={item.masked} />}
      />
      {!confirmed ? <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 16, fontFamily: fontFamily('regular', rtl) }}>{tr('chat.hint')}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.danger, paddingHorizontal: 16, fontFamily: fontFamily('medium', rtl) }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12 }}>
        <View style={{ flex: 1 }}>
          <TextField label={tr('chat.input')} value={text} onChangeText={setText} multiline maxLength={2000} style={{ minHeight: 48, maxHeight: 120, paddingTop: 12 }} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('chat.send')} disabled={sending || text.trim().length === 0} onPress={() => { send().catch(() => {}); }}
          style={{ minWidth: 56, minHeight: 56, borderRadius: 28, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', opacity: sending || text.trim().length === 0 ? 0.5 : 1, marginBottom: 20 }}>
          <Text style={{ color: c.onPrimary, fontSize: 15, fontFamily: fontFamily('semibold', rtl) }}>{tr('chat.send')}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
