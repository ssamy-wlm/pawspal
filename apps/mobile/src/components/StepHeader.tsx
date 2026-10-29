import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from './Icon';
import { fontFamily, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';

/** Back button, "Step n of total" and a segmented progress bar. Used by the sign-up and verification steps. */
export function StepHeader({ step, total = 6, onBack }: { step: number; total?: number; onBack?: () => void }) {
  const c = useTheme().color;
  const label = tr('step.of', { n: step, total });
  return (
    <View style={{ gap: 12, paddingHorizontal: 24, paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel={tr('common.back')} onPress={onBack} hitSlop={8}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="back" color={c.text} />
          </Pressable>
        ) : <View style={{ width: 44, height: 44 }} />}
        <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('medium', isRTL()) }}>{label}</Text>
      </View>
      <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 1, max: total, now: step }}
        style={{ flexDirection: 'row', gap: 6 }}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i < step ? c.primary : c.border }} />
        ))}
      </View>
    </View>
  );
}
