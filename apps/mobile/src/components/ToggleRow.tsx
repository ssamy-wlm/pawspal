import React from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { fontFamily, useTheme } from '../theme';
import { isRTL } from '../i18n';

/**
 * A whole row you can tap to flip a switch: one 56 pt target that a screen reader reads as "label, switch, on/off".
 * The switch itself is only the picture of the state. Works with Space and Enter on the web.
 */
export function ToggleRow({ label, note, value, onValueChange, disabled }:
  { label: string; note?: string; value: boolean; onValueChange: (next: boolean) => void; disabled?: boolean }) {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityHint={note}
      accessibilityState={{ checked: value, disabled: !!disabled }} disabled={disabled} onPress={() => onValueChange(!value)}
      style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.text, fontSize: 17, fontFamily: fontFamily('semibold', rtl) }}>{label}</Text>
        {note ? <Text style={{ color: c.textMuted, fontSize: 14, lineHeight: 20, fontFamily: fontFamily('regular', rtl) }}>{note}</Text> : null}
      </View>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden pointerEvents="none">
        <Switch value={value} disabled={disabled} trackColor={{ false: c.border, true: c.primary }} thumbColor={t.brand.cream} />
      </View>
    </Pressable>
  );
}
