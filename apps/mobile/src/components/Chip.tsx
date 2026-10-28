import React from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '../theme';

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const c = useTheme().color;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 18, borderRadius: 999, justifyContent: 'center',
        backgroundColor: selected ? c.primary : 'transparent', borderWidth: 2, borderColor: selected ? c.primary : c.border }}>
      <Text style={{ color: selected ? c.onPrimary : c.text, fontFamily: selected ? 'Poppins_600' : 'Poppins_400', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}
