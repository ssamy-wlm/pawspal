import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../src/components/Button';
import { Illustration } from '../src/components/Illustration';
import { TrustScreen } from '../src/components/TrustScreen';
import { fontFamily, useTheme } from '../src/theme';
import { isRTL, t as tr } from '../src/i18n';

/** Shown once after the account is closed and this phone is cleared. Open to everyone: nobody is signed in any more. */
export default function Goodbye() {
  const c = useTheme(true).color;
  const rtl = isRTL();
  const insets = useSafeAreaInsets();
  return (
    <TrustScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom, gap: 24 }}>
        <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ alignItems: 'center' }}><Illustration name="heart" width={96} /></View>
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 28, textAlign: 'center', fontFamily: fontFamily('extrabold', rtl) }}>{tr('goodbye.title')}</Text>
        <Text style={{ color: c.textMuted, fontSize: 16, lineHeight: 24, textAlign: 'center', fontFamily: fontFamily('regular', rtl) }}>{tr('goodbye.body')}</Text>
        <Button navy title={tr('goodbye.button')} onPress={() => router.replace('/')} />
      </ScrollView>
    </TrustScreen>
  );
}
