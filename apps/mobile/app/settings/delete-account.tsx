import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { ErrorText } from '../../src/components/StepScreen';
import { ApiError, deleteAccount, errorKey } from '../../src/lib/api';
import { clearLocalData } from '../../src/lib/privacy';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, Key, t as tr } from '../../src/i18n';

const DELETE_ERRORS: Record<string, Key> = {
  wrong_password: 'delete.err.wrong_password', active_booking: 'delete.err.active_booking',
  too_many_attempts: 'delete.err.too_many_attempts', open_case: 'delete.err.open_case', admin_account: 'delete.err.admin_account', not_allowed: 'err.notAllowed',
};

/** The word to type, compared without case or stray spaces (and in the language the screen is in). */
export const sameWord = (typed: string, word: string): boolean => typed.trim().toLocaleLowerCase() === word.trim().toLocaleLowerCase();

/**
 * Delete my account: says what happens and what is kept, asks for the password and the typed word, and only then enables the
 * button. The server checks the password and any active booking; on success this phone is signed out and cleared.
 */
export default function DeleteAccount() {
  const c = useTheme().color;
  const rtl = isRTL();
  const word = tr('delete.word');
  const [password, setPassword] = React.useState('');
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [code, setCode] = React.useState<string | null>(null);
  const ready = password.length > 0 && sameWord(typed, word) && !busy;

  const submit = async () => {
    setBusy(true);
    setCode(null);
    try {
      await deleteAccount(password);
      setPassword('');
      await clearLocalData();
      router.replace('/goodbye');
    } catch (e) {
      setCode(e instanceof ApiError ? e.code : 'generic');
      setBusy(false);
    }
  };

  const message = code ? tr(DELETE_ERRORS[code] ?? errorKey(new ApiError(code, 0))) : null;
  const body = { color: c.text, fontSize: 16, lineHeight: 24, fontFamily: fontFamily('regular', rtl) } as const;
  const head = { color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) } as const;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: tr('delete.title') }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 24 }}>
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={head}>{tr('delete.what')}</Text>
          <Text style={body}>{`• ${tr('delete.w1')}`}</Text>
          <Text style={body}>{`• ${tr('delete.w2')}`}</Text>
          <Text style={body}>{`• ${tr('delete.w3')}`}</Text>
        </View>
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={head}>{tr('delete.kept')}</Text>
          <Text style={body}>{tr('delete.keptBody')}</Text>
        </View>
        <View style={{ gap: 16 }}>
          <TextField label={tr('delete.password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
            autoComplete="current-password" textContentType="password" editable={!busy} />
          <TextField label={tr('delete.confirm', { word })} value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false}
            autoComplete="off" editable={!busy} />
        </View>
        <View accessibilityLiveRegion="assertive" style={{ gap: 12 }}>
          <ErrorText>{message}</ErrorText>
          {code === 'active_booking' ? <Button variant="secondary" title={tr('delete.viewBookings')} onPress={() => router.push('/(tabs)/calendar')} /> : null}
        </View>
        <Button variant="danger" title={tr(busy ? 'delete.busy' : 'delete.button')} disabled={!ready} onPress={() => { submit().catch(() => {}); }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
