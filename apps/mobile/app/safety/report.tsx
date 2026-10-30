import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { ErrorText } from '../../src/components/StepScreen';
import { TextField } from '../../src/components/TextField';
import { TrustHeader, TrustScreen } from '../../src/components/TrustScreen';
import { useToast } from '../../src/components/Toast';
import { blockUser, fileReport, REPORT_REASONS, ReportReason } from '../../src/lib/safety';
import { Conversation, fetchConversations } from '../../src/lib/chat';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, Key, t as tr } from '../../src/i18n';

function Report() {
  const { user, booking, conversation, name } = useLocalSearchParams<{ user?: string; booking?: string; conversation?: string; name?: string }>();
  const c = useTheme().color;
  const rtl = isRTL();
  const toast = useToast();
  const [people, setPeople] = React.useState<Conversation[]>([]);
  const [picked, setPicked] = React.useState<string | null>(user ?? null);
  const [reason, setReason] = React.useState<ReportReason | null>(null);
  const [details, setDetails] = React.useState('');
  const [alsoBlock, setAlsoBlock] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (!user) fetchConversations().then(setPeople, () => {}); }, [user]);
  const who = user ? (name ?? '') : people.find((p) => p.other_id === picked)?.first_name ?? '';

  const send = async () => {
    if (!picked || !reason) return;
    setBusy(true); setError(null);
    try {
      await fileReport({ reportedId: picked, reason, details, bookingId: booking, conversationId: conversation });
      if (alsoBlock) await blockUser(picked).catch(() => toast.show(tr('safety.failed'), 'error'));
      toast.show(tr('report.sent'));
      router.back();
    } catch (e) { setError(tr((e as Error).message === 'too_many' ? 'report.tooMany' : 'report.failed')); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <TrustHeader title={tr('safety.reportTitle')} />
        <Text style={{ color: c.textMuted, fontSize: 16, lineHeight: 24, fontFamily: fontFamily('regular', rtl) }}>{tr('report.intro')}</Text>
        {!user ? (
          <View style={{ gap: 10 }}>
            <Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontFamily: fontFamily('bold', rtl) }}>{tr('report.who')}</Text>
            {people.length === 0 ? <Text style={{ color: c.textMuted, fontSize: 15, fontFamily: fontFamily('regular', rtl) }}>{tr('report.noPeople')}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {people.map((p) => <Chip key={p.other_id} label={p.first_name ?? tr('safety.someone')} selected={picked === p.other_id} onPress={() => setPicked(p.other_id)} />)}
            </View>
          </View>
        ) : null}
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontFamily: fontFamily('bold', rtl) }}>{tr('report.what', { name: who || tr('safety.someone') })}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {REPORT_REASONS.map((r) => <Chip key={r} label={tr(`report.reason.${r}` as Key)} selected={reason === r} onPress={() => setReason(r)} />)}
        </View>
        <TextField label={tr('report.details')} hint={tr('report.detailsHint')} value={details} onChangeText={setDetails} multiline maxLength={2000} style={{ minHeight: 120, paddingTop: 12, textAlignVertical: 'top' }} />
        <View style={{ flexDirection: 'row' }}><Chip label={tr('report.alsoBlock')} selected={alsoBlock} onPress={() => setAlsoBlock((v) => !v)} /></View>
        <ErrorText>{error}</ErrorText>
        <Button navy title={tr('report.send')} disabled={busy || !picked || !reason} onPress={() => { send().catch(() => {}); }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function ReportScreen() {
  return <TrustScreen><Report /></TrustScreen>;
}
