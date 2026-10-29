import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { M, ease, useReducedMotion } from '../motion';
import { useTheme } from '../theme';
import { t as tr } from '../i18n';

/** The ✕ under the deck. It shrinks to 0.88 while pressed (docs/motion.md section 3). */
export function PassButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.get() }] }));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={tr('swipe.pass')} onPress={onPress}
      onPressIn={() => { if (!reduced) s.set(withTiming(0.88, { duration: M.duration.tap, easing: ease.out })); }}
      onPressOut={() => { if (!reduced) s.set(withTiming(1, { duration: M.duration.tap, easing: ease.out })); }}>
      <Animated.View style={[{ width: 68, height: 68, borderRadius: 34, borderWidth: 4, borderColor: t.brand.coral, alignItems: 'center', justifyContent: 'center' }, style]}>
        <Text style={{ fontSize: 26, color: t.brand.coral }}>✕</Text>
      </Animated.View>
    </Pressable>
  );
}

/** The ♥. On press it scales 0.86, then 1.10, then settles at 1, over 700 ms in all. `children` sits on top (the heart burst). */
export function LikeButton({ onPress, children }: { onPress: () => void; children?: React.ReactNode }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.get() }] }));
  const press = () => {
    if (!reduced) {
      s.set(withSequence(
        withTiming(0.86, { duration: 220, easing: ease.out, reduceMotion: ReduceMotion.Never }),
        withTiming(1.1, { duration: 280, easing: ease.inOut, reduceMotion: ReduceMotion.Never }),
        withTiming(1, { duration: 200, easing: ease.out, reduceMotion: ReduceMotion.Never }),
      ));
    }
    onPress();
  };
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('swipe.like')} onPress={press}>
        <Animated.View style={[{ width: 84, height: 84, borderRadius: 42, backgroundColor: t.color.primary, alignItems: 'center', justifyContent: 'center' }, style]}>
          <Text style={{ fontSize: 32, color: t.color.onPrimary }}>♥</Text>
        </Animated.View>
      </Pressable>
      {children}
    </View>
  );
}
