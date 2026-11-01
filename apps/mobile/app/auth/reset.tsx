import React from 'react';
import { Text, View } from 'react-native';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr } from '../../src/i18n';

/** The address our email links open (pawspal://auth/reset). The link itself is read by the app's link listener; this only gives it a screen to land on. */
export default function AuthReset() {
  const c = useTheme().color;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background }}>
      <Text style={{ color: c.textMuted, fontSize: 16, fontFamily: fontFamily('regular', isRTL()) }}>{tr('common.loading')}</Text>
    </View>
  );
}
