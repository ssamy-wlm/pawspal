import React from 'react';
import { Pressable, Text } from 'react-native';
import { fontFamily, useTheme } from '../theme';
import { isRTL } from '../i18n';

export function Chip({ label, selected, onPress, disabled }: { label: string; selected?: boolean; onPress?: () => void; disabled?: boolean }) {
  const c = useTheme().color;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected, disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 18, borderRadius: 999, justifyContent: 'center',
        backgroundColor: selected ? c.primary : 'transparent', opacity: disabled ? 0.5 : 1, borderWidth: 2, borderColor: selected ? c.primary : c.border }}>
      <Text style={{ color: selected ? c.onPrimary : c.text, fontFamily: fontFamily(selected ? 'semibold' : 'regular', isRTL()), fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}
