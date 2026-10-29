import React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ForceNavy, navyTheme } from '../theme';

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
