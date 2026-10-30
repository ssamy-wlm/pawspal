import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { fontFamily, ForceNavy, navyTheme } from '../theme';
import { isRTL } from '../i18n';

/** Wrap verification, safety, rules and suspension screens in this: everything inside is navy in every app theme. */
export function TrustScreen({ children }: { children: React.ReactNode }) {
  return (
    <ForceNavy>
      <View style={{ flex: 1, backgroundColor: navyTheme.color.background }}>
        <StatusBar style="light" />
        {children}
      </View>
    </ForceNavy>
  );
}

/** The navy header bar for a safety screen. Put it inside TrustScreen. */
export function TrustHeader({ title }: { title: string }) {
  return <Stack.Screen options={{ title, headerStyle: { backgroundColor: navyTheme.color.background }, headerTintColor: navyTheme.color.text, headerTitleStyle: { fontFamily: fontFamily('bold', isRTL()), color: navyTheme.color.text }, headerShadowVisible: false }} />;
}
