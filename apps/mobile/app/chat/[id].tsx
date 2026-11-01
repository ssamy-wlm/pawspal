import React from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { ChatBubble } from '../../src/components/ChatBubble';
import { EmptyState } from '../../src/components/EmptyState';
import { TermsCard } from '../../src/components/TermsCard';
import { TextField } from '../../src/components/TextField';
import { useAuth } from '../../src/lib/auth';
import { acceptedByMe, acceptedByOther, acceptTerms, Booking, cancelBooking, currentBooking, fetchBookingsBetween, termsText } from '../../src/lib/bookings';
import { success } from '../../src/lib/haptics';
import { blockUser, hasReviewed, reviewOpen } from '../../src/lib/safety';
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
  const insets = useSafeAreaInsets();
  const [typing, setTyping] = React.useState(false);                  // the keyboard is up: give the messages the room
  React.useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const [state, setState] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const [other, setOther] = React.useState<Conversation | null>(null);
  const [otherCard, setOtherCard] = React.useState<PublicProfile | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);     // newest first
  const [more, setMore] = React.useState(false);
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [booking, setBooking] = React.useState<Booking | null>(null);
  const [petNames, setPetNames] = React.useState<Record<string, string>>({});
  const [sure, setSure] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [reviewable, setReviewable] = React.useState<Booking | null>(null);   // a finished stay I can still review
  const [sureBlock, setSureBlock] = React.useState(false);
  const firstLoad = React.useRef<Set<number> | null>(null);    // the messages present when the chat opened do not pop in

  const loadBookings = React.useCallback(async (otherId: string) => {
    const all = await fetchBookingsBetween(me, otherId).catch(() => [] as Booking[]);
    const current = currentBooking(all);
    setBooking(current);
    const finished = all.find((b) => b.status === 'completed' && reviewOpen(b.ends_on));
    setReviewable(finished && !(await hasReviewed(finished.id, me).catch(() => true)) ? finished : null);
    if (current) {
      const p = await fetchPet(current.pet_id).catch(() => null);
      if (p) setPetNames((cur) => ({ ...cur, [current.pet_id]: p.name }));
    }
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
      firstLoad.current = new Set(first.map((m) => m.id));
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
    older.forEach((m) => firstLoad.current?.add(m.id));
    setMore(older.length === PAGE_SIZE);
    setMessages((cur) => [...cur, ...older.filter((o) => !cur.some((x) => x.id === o.id))]);
  };

  const accept = async (b: Booking) => {
    setBusy(true); setError(null);
    try {
      const next = await acceptTerms(b.id, b.terms_version);
      if (next === 'confirmed') success();                        // both accepted: the booking is confirmed on the spot
      await loadBookings(other!.other_id);
    } catch (e) {
      if ((e as Error).message === 'terms_changed') { await loadBookings(other!.other_id); setError(tr('booking.termsChanged')); } else setError(tr('booking.failed'));
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!sure) { setSure(true); return; }
    if (!booking) return;
    setBusy(true);
    try { await cancelBooking(booking.id); setSure(false); await loadBookings(other!.other_id); } catch { setSure(false); setError(tr('booking.cancelFailed')); } finally { setBusy(false); }
  };

  const block = async () => {
    if (!sureBlock) { setSureBlock(true); return; }
    try { await blockUser(other!.other_id); router.back(); } catch { setSureBlock(false); setError(tr('safety.failed')); }
  };

  if (state === 'loading') return null;
  if (state === 'failed' || !other) return <EmptyState message={tr('chat.loadFailed')} />;

  const confirmed = booking?.status === 'confirmed' || booking?.status === 'in_progress';
  const mine = acceptedByMe(booking, me);
  const theirs = acceptedByOther(booking, me);
  // An owner asks a host for a stay (the database checks the same).
  const canRequest = !!otherCard && otherCard.role === 'sitter' && auth?.role === 'owner';

  const bookingPanel = (
    <View style={{ gap: 12, paddingHorizontal: 16, paddingTop: 12 }}>
      {booking && booking.status !== 'cancelled' ? (
        <>
          {confirmed ? null : (
            <TermsCard terms={termsText(booking, petNames[booking.pet_id] ?? '')} accepted={mine}
              onAccept={() => { if (!busy) accept(booking).catch(() => {}); }} onChange={() => router.push(`/booking/${booking.id}?other=${other.other_id}` as never)} />
          )}
          <Text accessibilityRole={confirmed ? 'header' : undefined} style={{ color: c.text, fontSize: confirmed ? 18 : 15, fontFamily: fontFamily(confirmed ? 'bold' : 'semibold', rtl) }}>
            {confirmed ? tr('booking.status.confirmed')
              : mine && !theirs ? tr('booking.status.waiting', { name: other.first_name ?? '' }) : tr('booking.status.requested')}
          </Text>
          {confirmed ? <Button title={tr('booking.viewConfirmed')} onPress={() => router.push(`/booking/done/${booking.id}` as never)} /> : null}
          <Button variant="secondary" disabled={busy} title={sure ? tr('booking.cancelSure') : tr(confirmed ? 'booking.cancelBooking' : 'booking.cancel')} onPress={() => { cancel().catch(() => {}); }} />
        </>
      ) : !canRequest ? null : (
        <Button variant="secondary" title={tr('booking.request')} onPress={() => router.push(`/booking/new?other=${other.other_id}` as never)} />
      )}
      {reviewable ? <Button variant="secondary" title={tr('review.leave')} onPress={() => router.push(`/review/${reviewable.id}` as never)} /> : null}
      <View style={{ flexDirection: 'row', gap: 20 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('chat.report', { name: other.first_name ?? '' })} style={{ minHeight: 44, justifyContent: 'center' }}
          onPress={() => router.push(`/safety/report?user=${other.other_id}&name=${encodeURIComponent(other.first_name ?? '')}&conversation=${id}` as never)}>
          <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('medium', rtl) }}>{tr('chat.report', { name: other.first_name ?? '' })}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={sureBlock ? tr('chat.blockSure', { name: other.first_name ?? '' }) : tr('chat.block', { name: other.first_name ?? '' })} style={{ minHeight: 44, justifyContent: 'center' }}
          onPress={() => { block().catch(() => {}); }}>
          <Text style={{ color: sureBlock ? c.danger : c.textMuted, fontSize: 14, fontFamily: fontFamily(sureBlock ? 'bold' : 'medium', rtl) }}>{sureBlock ? tr('chat.blockSure', { name: other.first_name ?? '' }) : tr('chat.block', { name: other.first_name ?? '' })}</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}>
      <Stack.Screen options={{ title: other.first_name ?? '' }} />
      {typing ? null : <ScrollView style={{ maxHeight: '45%', flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }}>{bookingPanel}</ScrollView>}
      <FlatList
        inverted
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        onEndReached={() => { loadOlder().catch(() => {}); }}
        ListEmptyComponent={<Text style={{ color: c.textMuted, textAlign: 'center', fontFamily: fontFamily('regular', rtl), transform: [{ scaleY: -1 }] }}>{tr('chat.noMessages')}</Text>}
        renderItem={({ item }) => <ChatBubble text={item.body} mine={item.sender_id === me} masked={item.masked} animate={!firstLoad.current?.has(item.id)} />}
      />
      {!confirmed ? <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 16, fontFamily: fontFamily('regular', rtl) }}>{tr('chat.hint')}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.danger, paddingHorizontal: 16, fontFamily: fontFamily('medium', rtl) }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12) }}>
        <View style={{ flex: 1 }}>
          <TextField label={tr('chat.input')} value={text} onChangeText={setText} multiline maxLength={2000} style={{ minHeight: 48, maxHeight: 120, paddingTop: 12 }} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('chat.send')} disabled={sending || text.trim().length === 0} onPress={() => { send().catch(() => {}); }}
          accessibilityState={{ disabled: sending || text.trim().length === 0 }}
          style={{ minHeight: 56, paddingHorizontal: 20, borderRadius: 999, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', opacity: sending || text.trim().length === 0 ? 0.5 : 1, marginBottom: 20 }}>
          <Text style={{ color: c.onPrimary, fontSize: 15, fontFamily: fontFamily('semibold', rtl) }}>{tr('chat.send')}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
