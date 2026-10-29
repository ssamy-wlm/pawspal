import React from 'react';
import { Text } from 'react-native';
import { fontFamily, useTheme } from '../theme';
import { isRTL } from '../i18n';

/** A section heading inside a screen. */
export function Heading({ children }: { children: string }) {
  const c = useTheme().color;
  return <Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontFamily: fontFamily('bold', isRTL()), marginTop: 8 }}>{children}</Text>;
}
