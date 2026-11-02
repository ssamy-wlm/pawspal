import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { AuthScreen } from '../../src/components/AuthScreen';
import { ErrorText } from '../../src/components/StepScreen';
import { TextField } from '../../src/components/TextField';
import { Button } from '../../src/components/Button';
import { Icon } from '../../src/components/Icon';
import { authErrorKey, deviceId } from '../../src/lib/api';
import { AUTH_CALLBACK } from '../../src/lib/authLinks';
import { Role, setPendingEmail } from '../../src/lib/draft';
import { supabase } from '../../src/lib/supabase';
import { isEmail, isStrongPassword } from '../../src/lib/validate';
import { legal } from '../../src/legal';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, Key, t as tr } from '../../src/i18n';

const ROLES: { role: Role; title: Key; sub: Key }[] = [
  { role: 'owner', title: 'role.owner', sub: 'role.ownerSub' },
  { role: 'sitter', title: 'role.sitter', sub: 'role.sitterSub' },
];

/** Create an account: who you are, email, password, the disclaimer and the Terms. The server checks all of it again. */
export default function AccountStep() {
  const c = useTheme(true).color;
  const rtl = isRTL();
  const [role, setRole] = React.useState<Role | null>(null);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [accepted, setAccepted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const ready = !!role && isEmail(email) && isStrongPassword(password) && accepted;

  const submit = async () => {
    if (!ready || !role) return;
    setBusy(true); setError(null);
    try {
      const address = email.trim();
      const { data, error: err } = await supabase.auth.signUp({
        email: address, password,
        options: { emailRedirectTo: AUTH_CALLBACK, data: { role, terms_version: legal.termsOfService.version, device_id: await deviceId() } },
      });
      if (err) { setError(tr(authErrorKey(err))); return; }
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) { setError(tr('err.emailTaken')); return; }
      setPendingEmail(address);
      router.replace('/signup/check-email');
    } catch (e) { setError(tr(authErrorKey(e))); } finally { setBusy(false); }
  };

  return (
    <AuthScreen title={tr('signup.account.title')} sub={tr('signup.account.sub')}
      footer={<Button navy title={busy ? tr('common.loading') : tr('signup.account.submit')} disabled={!ready || busy} onPress={() => { submit().catch(() => {}); }} />}>
      <View style={{ gap: 10 }} accessibilityRole="radiogroup">
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontFamily: fontFamily('bold', rtl) }}>{tr('signup.account.roleTitle')}</Text>
        {ROLES.map((r) => {
          const on = role === r.role;
          return (
            <Pressable key={r.role} accessibilityRole="radio" accessibilityState={{ checked: on, selected: on }} accessibilityLabel={`${tr(r.title)}. ${tr(r.sub)}`}
              onPress={() => setRole(r.role)}
              style={{ minHeight: 64, borderRadius: 20, borderWidth: 2, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.surface : 'transparent', paddingHorizontal: 16, paddingVertical: 12, gap: 2, justifyContent: 'center' }}>
              <Text style={{ color: on ? c.primary : c.text, fontSize: 17, fontFamily: fontFamily('bold', rtl) }}>{tr(r.title)}</Text>
              <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>{tr(r.sub)}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextField label={tr('signup.account.email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false}
        keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <TextField label={tr('signup.account.password')} hint={tr('signup.account.passwordHint')} value={password} onChangeText={setPassword}
        secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" />

      <View accessible accessibilityLabel={`${tr('disclaimer.title')}. ${tr('disclaimer.text')}`}
        style={{ gap: 8, padding: 16, borderRadius: 20, backgroundColor: c.surface, borderWidth: 2, borderColor: c.primary }}>
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 17, fontFamily: fontFamily('bold', rtl) }}>{tr('disclaimer.title')}</Text>
        <Text style={{ color: c.text, fontSize: 15, lineHeight: 22, fontFamily: fontFamily('regular', rtl) }}>{tr('disclaimer.text')}</Text>
      </View>

      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} accessibilityLabel={tr('signup.account.accept')}
        onPress={() => setAccepted((v) => !v)} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, borderWidth: 2, borderColor: accepted ? c.primary : c.textMuted, backgroundColor: accepted ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {accepted ? <Icon name="check" color={c.onPrimary} size={18} /> : null}
        </View>
        <Text style={{ flex: 1, color: c.text, fontSize: 15, lineHeight: 21, fontFamily: fontFamily('medium', rtl) }}>{tr('signup.account.accept')}</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8 }}>
        {([['termsOfService', 'legal.terms'], ['privacyPolicy', 'legal.privacy']] as const).map(([slug, label]) => (
          <Link key={slug} href={`/legal/${slug}` as never} asChild>
            <Pressable accessibilityRole="link" style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
              <Text style={{ color: c.link, fontSize: 14, fontFamily: fontFamily('medium', rtl) }}>{tr(label)}</Text>
            </Pressable>
          </Link>
        ))}
      </View>
      <ErrorText>{error}</ErrorText>
    </AuthScreen>
  );
}
