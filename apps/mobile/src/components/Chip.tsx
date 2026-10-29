import React from 'react';
import { Pressable, Text } from 'react-native';
import { fontFamily, useTheme } from '../theme';
import { isRTL } from '../i18n';

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const c = useTheme().color;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 18, borderRadius: 999, justifyContent: 'center',
        backgroundColor: selected ? c.primary : 'transparent', borderWidth: 2, borderColor: selected ? c.primary : c.border }}>
      <Text style={{ color: selected ? c.onPrimary : c.text, fontFamily: fontFamily(selected ? 'semibold' : 'regular', isRTL()), fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}
