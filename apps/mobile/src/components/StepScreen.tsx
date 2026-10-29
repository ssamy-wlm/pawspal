import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrustScreen } from './TrustScreen';
import { StepHeader } from './StepHeader';
import { fontFamily, useTheme } from '../theme';
import { isRTL } from '../i18n';

function Body({ step, title, sub, onBack, children, footer }: Props) {
  const c = useTheme().color;
  const rtl = isRTL();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, paddingTop: insets.top }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StepHeader step={step} onBack={onBack ?? (router.canGoBack() ? () => router.back() : undefined)} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 20 }}>
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 28, fontFamily: fontFamily('extrabold', rtl) }}>{title}</Text>
          {sub ? <Text style={{ color: c.textMuted, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('regular', rtl) }}>{sub}</Text> : null}
        </View>
        {children}
      </ScrollView>
      <View style={{ padding: 24, paddingBottom: 24 + insets.bottom, gap: 12 }}>{footer}</View>
    </KeyboardAvoidingView>
  );
}

interface Props { step: number; title: string; sub?: string; onBack?: () => void; children?: React.ReactNode; footer?: React.ReactNode }

/** Shared frame for the six sign-up steps: navy trust screen, step header, title, content and a footer for buttons. */
export function StepScreen(props: Props) {
  return <TrustScreen><Body {...props} /></TrustScreen>;
}

/** An error line under a field. Read out by screen readers when it appears. */
export function ErrorText({ children }: { children?: string | null }) {
  const c = useTheme().color;
  if (!children) return null;
  return <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 15, fontFamily: fontFamily('medium', isRTL()) }}>{children}</Text>;
}
