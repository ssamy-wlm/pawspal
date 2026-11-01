import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrustScreen } from './TrustScreen';
import { Icon } from './Icon';
import { fontFamily, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';

function Body({ title, sub, children, footer, back }: Props) {
  const c = useTheme().color;
  const rtl = isRTL();
  const insets = useSafeAreaInsets();
  const goBack = back === false ? undefined : router.canGoBack() ? () => router.back() : undefined;
  return (
    <KeyboardAvoidingView style={{ flex: 1, paddingTop: insets.top }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
        {goBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel={tr('common.back')} onPress={goBack} hitSlop={8}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="back" color={c.text} />
          </Pressable>
        ) : <View style={{ width: 44, height: 44 }} />}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 20 }}>
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 28, fontFamily: fontFamily('extrabold', rtl) }}>{title}</Text>
          {sub ? <Text style={{ color: c.textMuted, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('regular', rtl) }}>{sub}</Text> : null}
        </View>
        {children}
      </ScrollView>
      {footer ? <View style={{ padding: 24, paddingBottom: 24 + insets.bottom, gap: 12 }}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

interface Props { title: string; sub?: string; children?: React.ReactNode; footer?: React.ReactNode; back?: boolean }

/** Frame for the account screens (create account, check email, sign in, forgot and reset password): navy, a back button, a title, content and a footer for buttons. */
export function AuthScreen(props: Props) {
  return <TrustScreen><Body {...props} /></TrustScreen>;
}
