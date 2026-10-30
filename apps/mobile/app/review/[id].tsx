import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorText } from '../../src/components/StepScreen';
import { TextField } from '../../src/components/TextField';
import { useToast } from '../../src/components/Toast';
import { useAuth } from '../../src/lib/auth';
import { Booking, fetchBooking } from '../../src/lib/bookings';
import { fetchCard } from '../../src/lib/profile';
import { hasReviewed, reviewOpen, submitReview } from '../../src/lib/safety';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr, tn } from '../../src/i18n';

/** Rate a finished stay, once, within 14 days. The database refuses a review before the stay is completed. */
export default function Review() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const toast = useToast();
  const [state, setState] = React.useState<'loading' | 'ready' | 'done' | 'closed' | 'failed'>('loading');
  const [booking, setBooking] = React.useState<Booking | null>(null);
  const [name, setName] = React.useState('');
  const [rating, setRating] = React.useState(0);
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) return;
    let live = true;
    (async () => {
      const b = await fetchBooking(id);
      if (!live) return;
      if (!b || ![b.owner_id, b.sitter_id].includes(me)) { setState('failed'); return; }
      const subject = b.owner_id === me ? b.sitter_id : b.owner_id;
      const [card, already] = await Promise.all([fetchCard(subject).catch(() => null), hasReviewed(id, me)]);
      if (!live) return;
      setBooking(b); setName(card?.first_name ?? '');
      setState(already ? 'done' : b.status !== 'completed' || !reviewOpen(b.ends_on) ? 'closed' : 'ready');
    })().catch(() => { if (live) setState('failed'); });
    return () => { live = false; };
  }, [id, me]);

  if (state === 'loading') return null;
  if (state === 'failed' || !booking) return <EmptyState message={tr('review.failed')} />;
  if (state === 'done') return <EmptyState message={tr('review.already')} actionLabel={tr('common.done')} onAction={() => router.back()} />;
  if (state === 'closed') return <EmptyState message={tr('review.closed')} actionLabel={tr('common.done')} onAction={() => router.back()} />;

  const send = async () => {
    setBusy(true); setError(null);
    try {
      await submitReview(booking.id, me, booking.owner_id === me ? booking.sitter_id : booking.owner_id, rating, body);
      toast.show(tr('review.thanks'));
      router.back();
    } catch (e) { setError(tr((e as Error).message === 'too_many' ? 'review.already' : 'review.notAllowed')); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: tr('review.title') }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 24, fontFamily: fontFamily('extrabold', rtl) }}>{tr('review.how', { name })}</Text>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 4 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} accessibilityRole="radio" accessibilityLabel={tn('count.star', n)} accessibilityState={{ selected: rating === n }} onPress={() => setRating(n)}
              style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 36, color: n <= rating ? c.primary : c.border }}>{'★'}</Text>
            </Pressable>
          ))}
        </View>
        <TextField label={tr('review.body')} hint={tr('review.hint')} value={body} onChangeText={setBody} multiline maxLength={1000} style={{ minHeight: 120, paddingTop: 12, textAlignVertical: 'top' }} />
        <ErrorText>{error}</ErrorText>
        <Button title={tr('review.send')} disabled={busy || rating === 0} onPress={() => { send().catch(() => {}); }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
