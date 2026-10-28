import React from 'react';
import { Pressable, Text, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme';

type Variant = 'primary' | 'secondary' | 'accent' | 'danger';

export function Button({ title, onPress, variant = 'primary', disabled, style, navy }:
  { title: string; onPress: () => void; variant?: Variant; disabled?: boolean; style?: ViewStyle; navy?: boolean }) {
  const t = useTheme(navy);
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.get() }] }));
  const bg = { primary: t.color.primary, secondary: 'transparent', accent: t.color.accent, danger: t.color.danger }[variant];
  const fg = { primary: t.color.onPrimary, secondary: t.color.primary, accent: t.color.onAccent, danger: '#FFFFFF' }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => { s.set(withTiming(0.96, { duration: 120 })); }}
      onPressOut={() => { s.set(withTiming(1, { duration: 160 })); }}
    >
      <Animated.View style={[{
        minHeight: 56, borderRadius: 999, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center',
        backgroundColor: bg, borderWidth: variant === 'secondary' ? 3 : 0, borderColor: t.color.primary,
        opacity: disabled ? 0.5 : 1,
      }, anim, style]}>
        <Text style={{ color: fg, fontSize: 17, fontFamily: 'Poppins_600' }}>{title}</Text>
      </Animated.View>
    </Pressable>
  );
}
