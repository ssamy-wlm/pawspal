import React from 'react';
import { Text } from 'react-native';
import { AuthScreen } from '../src/components/AuthScreen';
import { ErrorText } from '../src/components/StepScreen';
import { TextField } from '../src/components/TextField';
import { Button } from '../src/components/Button';
import { authErrorKey } from '../src/lib/api';
import { AUTH_RESET } from '../src/lib/authLinks';
import { getPendingEmail } from '../src/lib/draft';
import { supabase } from '../src/lib/supabase';
import { isEmail } from '../src/lib/validate';
import { fontFamily, useTheme } from '../src/theme';
import { isRTL, t as tr } from '../src/i18n';

/** Asks for a reset link. The answer is always the same sentence, so nobody can learn which emails have an account. */
export default function Forgot() {
  const c = useTheme(true).color;
  const [email, setEmail] = React.useState(getPendingEmail());
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const send = async () => {
    if (!isEmail(email)) return;
    setBusy(true); setError(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: AUTH_RESET });
      if (err && authErrorKey(err) === 'err.network') { setError(tr('err.network')); return; }
      setDone(true);
    } catch (e) {
      if (authErrorKey(e) === 'err.network') setError(tr('err.network')); else setDone(true);
    } finally { setBusy(false); }
  };

  return (
    <AuthScreen title={tr('forgot.title')} sub={tr('forgot.sub')}
      footer={<Button navy title={busy ? tr('common.loading') : tr('forgot.send')} disabled={!isEmail(email) || busy} onPress={() => { send().catch(() => {}); }} />}>
      <TextField label={tr('signup.account.email')} value={email} onChangeText={(v) => { setEmail(v); setDone(false); }} autoCapitalize="none" autoCorrect={false}
        keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      {done ? <Text accessibilityRole="alert" style={{ color: c.text, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('medium', isRTL()) }}>{tr('forgot.sent')}</Text> : null}
      <ErrorText>{error}</ErrorText>
    </AuthScreen>
  );
}
