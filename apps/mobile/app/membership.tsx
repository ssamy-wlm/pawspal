import React from 'react';
import { Image, KeyboardAvoidingView, Linking, Platform, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '../src/components/Button';
import { EmptyState } from '../src/components/EmptyState';
import { ErrorText } from '../src/components/StepScreen';
import { TextField } from '../src/components/TextField';
import { useAuth } from '../src/lib/auth';
import { errorKey } from '../src/lib/api';
import { fetchPaymentSettings, formatDate, hasPaymentDetails, isHttps, PaymentSettings, submitPaymentClaim } from '../src/lib/membership';
import { fontFamily, useTheme } from '../src/theme';
import { isRTL, Key, t as tr } from '../src/i18n';

function Row({ label, value }: { label: string; value: string }) {
  const c = useTheme().color;
  const rtl = isRTL();
  return (
    <View style={{ minHeight: 44, gap: 2, justifyContent: 'center' }}>
      <Text style={{ color: c.textMuted, fontSize: 13, fontFamily: fontFamily('medium', rtl) }}>{label}</Text>
      <Text selectable style={{ color: c.text, fontSize: 17, fontFamily: fontFamily('semibold', rtl) }}>{value}</Text>
    </View>
  );
}

/** Registration fee, renewal and "membership paused": what to pay, how, and a form to tell us you did. */
export default function Membership() {
  const { state, refresh, signOut } = useAuth();
  const c = useTheme().color;
  const rtl = isRTL();
  const m = state?.membership;
  const [settings, setSettings] = React.useState<PaymentSettings | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [reference, setReference] = React.useState('');
  const [shot, setShot] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [sentNow, setSentNow] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    fetchPaymentSettings().then((s) => { if (live) setSettings(s); }, () => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, []);

  if (!m) return <EmptyState message={tr('common.loading')} />;

  const date = formatDate(m.paid_until);
  const amount = m.amount_egp;
  const title: string = m.state === 'unpaid' ? tr('membership.registration', { amount })
    : m.state === 'paused' ? tr('membership.paused')
    : m.state === 'due_soon' ? tr('membership.renewalDue', { date })
    : tr('membership.active', { date });
  const body: Key | null = m.state === 'unpaid' ? 'membership.unpaidBody' : m.state === 'paused' ? 'membership.pausedBody' : m.state === 'due_soon' ? 'membership.dueBody' : null;
  const waiting = sentNow || m.claim_status === 'pending';
  const canPay = m.state !== 'active';

  const pickShot = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, exif: false });
      if (!r.canceled && r.assets[0]?.uri) setShot(r.assets[0].uri);
    } catch { setError(tr('err.generic')); }
  };

  const send = async () => {
    setBusy(true); setError(null);
    try {
      await submitPaymentClaim(reference, shot);
      setSentNow(true); setReference(''); setShot(null);
      await refresh();
    } catch (e) { setError(tr(errorKey(e))); } finally { setBusy(false); }
  };

  const section = (text: string) => <Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontFamily: fontFamily('bold', rtl) }}>{text}</Text>;
  const note = (text: string) => <Text style={{ color: c.textMuted, fontSize: 15, lineHeight: 22, fontFamily: fontFamily('regular', rtl) }}>{text}</Text>;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 20 }}>
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 28, fontFamily: fontFamily('extrabold', rtl) }}>{title}</Text>
          {m.state === 'paused' ? note(tr('membership.renewalFee', { amount })) : null}
          {body ? note(tr(body)) : null}
        </View>

        {canPay ? (
          <View style={{ gap: 12 }}>
            {section(tr('membership.howTitle'))}
            {loadFailed ? <ErrorText>{tr('membership.loadFailed')}</ErrorText> : null}
            {settings && !hasPaymentDetails(settings) ? note(tr('membership.soon')) : null}
            {settings && hasPaymentDetails(settings) ? (
              <>
                {isHttps(settings.instapay_link) ? <Button title={tr('membership.instapay')} onPress={() => { Linking.openURL(settings.instapay_link).catch(() => {}); }} /> : null}
                {isHttps(settings.instapay_qr_url) ? (
                  <Image source={{ uri: settings.instapay_qr_url }} accessible accessibilityRole="image" accessibilityLabel={tr('membership.qr')}
                    style={{ width: 220, height: 220, alignSelf: 'center', borderRadius: 16, backgroundColor: c.surface }} resizeMode="contain" />
                ) : null}
                {settings.bank_name || settings.bank_account_name || settings.bank_account_number || settings.bank_iban ? (
                  <View style={{ gap: 4, padding: 16, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
                    <Text accessibilityRole="header" style={{ color: c.text, fontSize: 16, fontFamily: fontFamily('bold', rtl) }}>{tr('membership.bank')}</Text>
                    {settings.bank_name ? <Row label={tr('membership.bankName')} value={settings.bank_name} /> : null}
                    {settings.bank_account_name ? <Row label={tr('membership.accountName')} value={settings.bank_account_name} /> : null}
                    {settings.bank_account_number ? <Row label={tr('membership.accountNumber')} value={settings.bank_account_number} /> : null}
                    {settings.bank_iban ? <Row label={tr('membership.iban')} value={settings.bank_iban} /> : null}
                  </View>
                ) : null}
                {settings.payment_note ? note(settings.payment_note) : null}
              </>
            ) : null}
            {note(tr('membership.byHand'))}
          </View>
        ) : null}

        {canPay && waiting ? (
          <View accessible style={{ padding: 16, borderRadius: 20, backgroundColor: c.surface, borderWidth: 2, borderColor: c.primary }}>
            <Text style={{ color: c.text, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('semibold', rtl) }}>{tr('membership.claimPending')}</Text>
          </View>
        ) : null}

        {canPay && !waiting && settings && hasPaymentDetails(settings) ? (
          <View style={{ gap: 12 }}>
            {section(tr('membership.claimTitle'))}
            {m.claim_status === 'rejected' ? <ErrorText>{m.claim_note ? tr('membership.claimRejected', { note: m.claim_note }) : tr('membership.claimRejectedPlain')}</ErrorText> : null}
            <TextField label={tr('membership.reference')} hint={tr('membership.referenceHint')} value={reference} onChangeText={setReference} maxLength={80} autoCapitalize="none" autoCorrect={false} />
            <Button variant="secondary" title={shot ? tr('membership.shotAdded') : tr('membership.addShot')} disabled={busy} onPress={() => { pickShot().catch(() => {}); }} />
            <ErrorText>{error}</ErrorText>
            <Button title={busy ? tr('common.loading') : tr('membership.send')} disabled={busy || (reference.trim().length === 0 && !shot)} onPress={() => { send().catch(() => {}); }} />
          </View>
        ) : null}

        <Button variant="secondary" title={tr('pending.signout')} onPress={() => { signOut().catch(() => {}); }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
