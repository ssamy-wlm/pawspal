import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { router, Stack } from 'expo-router';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { ErrorText } from '../../src/components/StepScreen';
import { useToast } from '../../src/components/Toast';
import { ApiError, errorKey, exportMyData } from '../../src/lib/api';
import { saveExport } from '../../src/lib/exportFile';
import { exportFileName, exportJson } from '../../src/lib/privacy';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, Key, t as tr } from '../../src/i18n';

const ERRORS: Record<string, Key> = {
  wrong_password: 'delete.err.wrong_password', too_many_attempts: 'delete.err.too_many_attempts', not_allowed: 'err.notAllowed',
};

/** Download my data: the server asks for the password first. The password is cleared from memory as soon as the answer is back. */
export default function DownloadData() {
  const c = useTheme().color;
  const rtl = isRTL();
  const toast = useToast();
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [code, setCode] = React.useState<string | null>(null);

  const submit = async () => {
    const pw = password;
    setBusy(true);
    setCode(null);
    try {
      const r = await exportMyData(pw);
      setPassword('');
      const shared = await saveExport(exportFileName(r.exported_at), exportJson(r));
      toast.show(tr(shared ? 'privacy.downloaded' : 'privacy.shareUnavailable'), shared ? 'success' : 'error');
      if (shared) router.back();
    } catch (e) {
      setPassword('');
      setCode(e instanceof ApiError ? e.code : 'generic');
    } finally { setBusy(false); }
  };

  const message = code ? tr(ERRORS[code] ?? errorKey(new ApiError(code, 0))) : null;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: tr('privacy.download') }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 20 }}>
        <Text style={{ color: c.text, fontSize: 16, lineHeight: 24, fontFamily: fontFamily('regular', rtl) }}>{tr('privacy.downloadIntro')}</Text>
        <Text style={{ color: c.textMuted, fontSize: 14, lineHeight: 20, fontFamily: fontFamily('regular', rtl) }}>{tr('privacy.downloadNote')}</Text>
        <TextField label={tr('delete.password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
          autoComplete="current-password" textContentType="password" editable={!busy} />
        <ErrorText>{message}</ErrorText>
        <Button title={tr(busy ? 'privacy.downloading' : 'privacy.download')} disabled={!password || busy} onPress={() => { submit().catch(() => {}); }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
