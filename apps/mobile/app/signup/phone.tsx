import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StepScreen, ErrorText } from '../../src/components/StepScreen';
import { TextField } from '../../src/components/TextField';
import { Button } from '../../src/components/Button';
import { Turnstile, turnstileSiteKey } from '../../src/components/Turnstile';
import { ApiError, errorKey, requestOtp, verifyOtp } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { nextStep } from '../../src/lib/gate';
import { setRoleHint } from '../../src/lib/draft';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr } from '../../src/i18n';

/** Step 1: phone number, then the code. The code can be asked for again after a short wait. */
export default function PhoneStep() {
  const { role } = useLocalSearchParams<{ role?: string }>();
  const { refresh } = useAuth();
  const c = useTheme(true).color;
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [wait, setWait] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const siteKey = turnstileSiteKey();
  const [challenge, setChallenge] = React.useState<{ for: 'send' | 'verify'; n: number } | null>(null);

  React.useEffect(() => { setRoleHint(role); }, [role]);
  React.useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const send = async (captchaToken?: string) => {
    setBusy(true); setError(null); setChallenge(null);
    try {
      const r = await requestOtp(phone, captchaToken);
      setSent(true); setCode(''); setWait(r.resend_after_seconds);
    } catch (e) {
      setError(tr(errorKey(e)));
      if (e instanceof ApiError && e.code === 'captcha_failed') setChallenge((c) => ({ for: 'send', n: (c?.n ?? 0) + 1 }));
      if (e instanceof ApiError && typeof e.data.retry_after_seconds === 'number') setWait(e.data.retry_after_seconds);
    } finally { setBusy(false); }
  };

  const verify = async (captchaToken?: string) => {
    setBusy(true); setError(null); setChallenge(null);
    try {
      await verifyOtp(phone, code, captchaToken);
      const state = await refresh();
      if (state?.status === 'pending_verification') router.replace(`/signup/${nextStep(state.missing)}` as never);
    } catch (e) {
      setError(tr(errorKey(e)));
      if (siteKey && e instanceof ApiError && e.data.captcha_required === true) setChallenge((c) => ({ for: 'verify', n: (c?.n ?? 0) + 1 }));
    } finally { setBusy(false); }
  };

  const press = (what: 'send' | 'verify') => {
    // A code request needs the check first. A code is tried straight away; the check only follows two wrong tries.
    if (what === 'send' && siteKey) setChallenge((c) => ({ for: 'send', n: (c?.n ?? 0) + 1 })); else (what === 'send' ? send() : verify()).catch(() => {});
  };
  const widget = challenge ? (
    <Turnstile key={challenge.n} siteKey={siteKey}
      onToken={(tok) => { (challenge.for === 'send' ? send(tok) : verify(tok)).catch(() => {}); }}
      onError={() => { setChallenge(null); setError(tr('err.captcha_failed')); }} />
  ) : null;

  if (!sent) {
    return (
      <StepScreen step={1} title={tr('signup.phone.title')} sub={tr('signup.phone.sub')}
        footer={<Button navy title={tr('signup.phone.send')} disabled={busy || phone.trim().length < 10} onPress={() => press('send')} />}>
        <TextField label={tr('signup.phone.label')} hint={tr('signup.phone.hint')} value={phone} onChangeText={setPhone}
          keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={20} />
        {widget}
        <ErrorText>{error}</ErrorText>
      </StepScreen>
    );
  }
  return (
    <StepScreen step={1} title={tr('signup.code.title')} sub={tr('signup.code.sub', { phone: `\u2066${phone}\u2069` })}
      onBack={() => { setSent(false); setError(null); }}
      footer={<Button navy title={tr('signup.code.verify')} disabled={busy || code.length < 4} onPress={() => press('verify')} />}>
      <TextField label={tr('signup.code.label')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
        keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={8} />
      {widget}
      <ErrorText>{error}</ErrorText>
      <View style={{ gap: 4 }}>
        {wait > 0
          ? <Text style={{ color: c.textMuted, fontSize: 15, fontFamily: fontFamily('regular', isRTL()) }}>{tr('signup.code.resendIn', { n: wait })}</Text>
          : <Pressable accessibilityRole="button" onPress={() => press('send')} disabled={busy} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: c.link, fontSize: 16, fontFamily: fontFamily('semibold', isRTL()) }}>{tr('signup.code.resend')}</Text>
            </Pressable>}
        <Pressable accessibilityRole="button" onPress={() => { setSent(false); setError(null); }} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: c.link, fontSize: 16, fontFamily: fontFamily('semibold', isRTL()) }}>{tr('signup.code.change')}</Text>
        </Pressable>
      </View>
    </StepScreen>
  );
}
