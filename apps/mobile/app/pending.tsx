import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrustScreen } from '../src/components/TrustScreen';
import { Illustration } from '../src/components/Illustration';
import { Button } from '../src/components/Button';
import { TextField } from '../src/components/TextField';
import { ErrorText } from '../src/components/StepScreen';
import { CheckRow } from '../src/components/CheckRow';
import { useAuth } from '../src/lib/auth';
import { supabase } from '../src/lib/supabase';
import { fontFamily, useTheme } from '../src/theme';
import { isRTL, t as tr } from '../src/i18n';

interface Decision { id: string; message: string | null; appealed: boolean }

/** The latest decision about this account and whether an appeal is already open for it. */
async function loadDecision(userId: string): Promise<Decision | null> {
  const a = await supabase.from('enforcement_actions').select('id, message').eq('user_id', userId)
    .in('action', ['suspension', 'removal']).order('created_at', { ascending: false }).limit(1);
  const action = a.data?.[0] as { id: string; message: string | null } | undefined;
  if (a.error || !action) return null;
  const ap = await supabase.from('appeals').select('id').eq('action_id', action.id).limit(1);
  return { id: action.id, message: action.message, appealed: (ap.data?.length ?? 0) > 0 };
}

/** Shown to everyone who is not active yet: waiting for review, or an account that has been suspended or removed. */
export default function Pending() {
  const { state, session, signOut, refresh } = useAuth();
  const c = useTheme(true).color;
  const rtl = isRTL();
  const insets = useSafeAreaInsets();
  const stopped = state?.status === 'suspended' || state?.status === 'removed';
  const userId = session?.user.id;
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (stopped) return;
    const id = setInterval(() => { refresh().catch(() => {}); }, 30000);   // lets the person in soon after approval
    return () => clearInterval(id);
  }, [stopped, refresh]);

  React.useEffect(() => {
    if (!stopped || !userId) return;
    let live = true;
    loadDecision(userId).then((d) => { if (live) setDecision(d); }, () => {});
    return () => { live = false; };
  }, [stopped, userId]);

  const sendAppeal = async () => {
    if (!decision || !userId) return;
    setBusy(true); setError(null);
    try {
      const r = await supabase.from('appeals').insert({ action_id: decision.id, user_id: userId, body: body.trim() });
      if (r.error && r.error.code !== '23505') throw r.error;    // 23505: an appeal is already open, which is fine
      setDecision({ ...decision, appealed: true });
    } catch { setError(tr('appeal.failed')); } finally { setBusy(false); }
  };

  return (
    <TrustScreen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 24 + insets.top, justifyContent: 'center', gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 16 }}>
          <Illustration name="pawspalIcon" width={96} />
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 28, textAlign: 'center', fontFamily: fontFamily('extrabold', rtl) }}>
            {stopped ? tr('pending.stoppedTitle') : tr('pending.title')}
          </Text>
          <Text style={{ color: c.textMuted, fontSize: 16, lineHeight: 23, textAlign: 'center', fontFamily: fontFamily('regular', rtl) }}>
            {stopped ? tr('pending.suspended') : tr('pending.body')}
          </Text>
        </View>

        {stopped && decision ? (
          <View style={{ gap: 12 }}>
            {decision.message ? (
              <View accessible style={{ gap: 4 }}>
                <Text style={{ color: c.text, fontSize: 15, fontFamily: fontFamily('semibold', rtl) }}>{tr('appeal.messageTitle')}</Text>
                <Text style={{ color: c.textMuted, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('regular', rtl) }}>{decision.message}</Text>
              </View>
            ) : null}
            {decision.appealed ? (
              <CheckRow title={tr('appeal.sent')} description={tr('appeal.sentBody')} />
            ) : (
              <>
                <Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontFamily: fontFamily('bold', rtl) }}>{tr('appeal.title')}</Text>
                <Text style={{ color: c.textMuted, fontSize: 15, lineHeight: 22, fontFamily: fontFamily('regular', rtl) }}>{tr('appeal.sub')}</Text>
                <TextField label={tr('appeal.label')} value={body} onChangeText={setBody} multiline maxLength={2000}
                  style={{ minHeight: 120, textAlignVertical: 'top', paddingTop: 14 }} />
                <ErrorText>{error}</ErrorText>
                <Button navy title={tr('appeal.send')} disabled={busy || body.trim().length === 0} onPress={() => { sendAppeal().catch(() => {}); }} />
              </>
            )}
          </View>
        ) : null}
      </ScrollView>
      <View style={{ padding: 24, paddingBottom: 24 + insets.bottom }}>
        <Button navy variant="secondary" title={tr('pending.signout')} onPress={() => { signOut().catch(() => {}); }} />
      </View>
    </TrustScreen>
  );
}
