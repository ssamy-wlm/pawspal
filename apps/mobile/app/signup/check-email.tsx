import React from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { AuthScreen } from '../../src/components/AuthScreen';
import { ErrorText } from '../../src/components/StepScreen';
import { Button } from '../../src/components/Button';
import { CheckRow } from '../../src/components/CheckRow';
import { authErrorKey } from '../../src/lib/api';
import { AUTH_CALLBACK } from '../../src/lib/authLinks';
import { getPendingEmail } from '../../src/lib/draft';
import { supabase } from '../../src/lib/supabase';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr } from '../../src/i18n';

export const RESEND_SECONDS = 60;
const nowMs = () => Date.now();

/** After sign-up: open the email and tap the link. Resend is allowed once a minute. */
export default function CheckEmailStep() {
  const c = useTheme().color;
  const email = getPendingEmail();
  const [until, setUntil] = React.useState(() => nowMs() + RESEND_SECONDS * 1000);
  const [now, setNow] = React.useState(() => nowMs());
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const id = setInterval(() => setNow(nowMs()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((until - now) / 1000));

  const resend = async () => {
    if (left > 0 || !email) return;
    setBusy(true); setError(null); setSent(false);
    try {
      const { error: err } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: AUTH_CALLBACK } });
      if (err) { setError(tr(authErrorKey(err))); return; }
      setSent(true); setUntil(nowMs() + RESEND_SECONDS * 1000); setNow(nowMs());
    } catch (e) { setError(tr(authErrorKey(e))); } finally { setBusy(false); }
  };

  return (
    <AuthScreen back={false} title={tr('signup.check.title')} sub={tr('signup.check.sub', { email })}
      footer={
        <>
          <Button navy title={left > 0 ? tr('signup.check.resendIn', { n: left }) : tr('signup.check.resend')} variant="secondary" disabled={left > 0 || busy || !email}
            onPress={() => { resend().catch(() => {}); }} />
          <Button navy title={tr('signup.check.confirmed')} onPress={() => router.replace('/signin')} />
          <Button navy variant="secondary" title={tr('signup.check.change')} onPress={() => router.replace('/signup/account')} />
        </>}>
      <CheckRow title={email || tr('signup.check.title')} description={tr('signup.check.spam')} />
      {sent ? <Text accessibilityRole="alert" style={{ color: c.primary, fontSize: 15, fontFamily: fontFamily('medium', isRTL()) }}>{tr('signup.check.sent')}</Text> : null}
      <ErrorText>{error}</ErrorText>
    </AuthScreen>
  );
}
