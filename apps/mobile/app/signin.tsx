import React from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { AuthScreen } from '../src/components/AuthScreen';
import { ErrorText } from '../src/components/StepScreen';
import { TextField } from '../src/components/TextField';
import { Button } from '../src/components/Button';
import { authErrorKey } from '../src/lib/api';
import { AUTH_CALLBACK } from '../src/lib/authLinks';
import { getPendingEmail } from '../src/lib/draft';
import { supabase } from '../src/lib/supabase';
import { isEmail } from '../src/lib/validate';
import { fontFamily, useTheme } from '../src/theme';
import { isRTL, t as tr } from '../src/i18n';

/** Sign in with email and password. One plain sentence for every wrong answer, so nobody can probe which emails exist. */
export default function SignIn() {
  const c = useTheme(true).color;
  const rtl = isRTL();
  const [email, setEmail] = React.useState(getPendingEmail());
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = React.useState(false);
  const [resent, setResent] = React.useState(false);

  const ready = isEmail(email) && password.length > 0;

  const submit = async () => {
    if (!ready) return;
    setBusy(true); setError(null); setUnconfirmed(false); setResent(false);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (!err) return;                                  // the screen gate takes it from here
      const key = authErrorKey(err);
      if (key === 'err.emailNotConfirmed') { setUnconfirmed(true); setError(tr(key)); }
      else if (key === 'err.network' || key === 'err.rateLimited') setError(tr(key));
      else setError(tr('signin.error'));
    } catch (e) { const key = authErrorKey(e); setError(tr(key === 'err.network' ? key : 'signin.error')); } finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: AUTH_CALLBACK } });
      if (err) setError(tr(authErrorKey(err))); else { setResent(true); setError(null); }
    } catch (e) { setError(tr(authErrorKey(e))); } finally { setBusy(false); }
  };

  return (
    <AuthScreen title={tr('signin.title')} sub={tr('signin.sub')}
      footer={
        <>
          <Button navy title={busy ? tr('common.loading') : tr('signin.submit')} disabled={!ready || busy} onPress={() => { submit().catch(() => {}); }} />
          <Button navy variant="secondary" title={tr('signin.create')} onPress={() => router.replace('/signup/account')} />
        </>}>
      <TextField label={tr('signup.account.email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false}
        keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <TextField label={tr('signup.account.password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
        autoCorrect={false} autoComplete="current-password" textContentType="password" />
      <ErrorText>{error}</ErrorText>
      {unconfirmed ? <Button navy variant="secondary" title={tr('signin.resend')} disabled={busy || !isEmail(email)} onPress={() => { resend().catch(() => {}); }} /> : null}
      {resent ? <Text accessibilityRole="alert" style={{ color: c.primary, fontSize: 15, fontFamily: fontFamily('medium', rtl) }}>{tr('signup.check.sent')}</Text> : null}
      <Pressable accessibilityRole="link" onPress={() => router.push('/forgot')} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: c.link, fontSize: 15, fontFamily: fontFamily('medium', rtl) }}>{tr('signin.forgot')}</Text>
      </Pressable>
    </AuthScreen>
  );
}
