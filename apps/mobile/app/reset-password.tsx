import React from 'react';
import { router } from 'expo-router';
import { AuthScreen } from '../src/components/AuthScreen';
import { ErrorText } from '../src/components/StepScreen';
import { TextField } from '../src/components/TextField';
import { Button } from '../src/components/Button';
import { useToast } from '../src/components/Toast';
import { authErrorKey } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { supabase } from '../src/lib/supabase';
import { isStrongPassword } from '../src/lib/validate';
import { t as tr } from '../src/i18n';

/** Where the password-reset email link lands: choose a new password twice. */
export default function ResetPassword() {
  const { session } = useAuth();
  const toast = useToast();
  const [password, setPassword] = React.useState('');
  const [again, setAgain] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!session) {
    return (
      <AuthScreen back={false} title={tr('reset.title')} sub={tr('reset.expired')}
        footer={<Button navy title={tr('reset.new')} onPress={() => router.replace('/forgot')} />} />
    );
  }

  const mismatch = again.length > 0 && again !== password;
  const ready = isStrongPassword(password) && again === password;

  const save = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) { setError(tr(authErrorKey(err))); return; }
      toast.show(tr('reset.done'), 'success');
      router.replace('/');
    } catch (e) { setError(tr(authErrorKey(e))); } finally { setBusy(false); }
  };

  return (
    <AuthScreen back={false} title={tr('reset.title')} sub={tr('reset.sub')}
      footer={<Button navy title={busy ? tr('common.loading') : tr('reset.submit')} disabled={!ready || busy} onPress={() => { save().catch(() => {}); }} />}>
      <TextField label={tr('reset.password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
        autoComplete="new-password" textContentType="newPassword" />
      <TextField label={tr('reset.confirm')} value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" autoCorrect={false}
        autoComplete="new-password" textContentType="newPassword" />
      <ErrorText>{mismatch ? tr('reset.mismatch') : error}</ErrorText>
    </AuthScreen>
  );
}
