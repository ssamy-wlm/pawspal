import React, { useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { M, ease, pop, useReducedMotion } from '../motion';

/** Decorative background circle that pops in and slowly "breathes", as in the posts and video. */
export function Blob({ x, y, size, color, delay = 0 }: { x: number; y: number; size: number; color: string; delay?: number }) {
  const reduced = useReducedMotion();
  const enter = useSharedValue(reduced ? 1 : 0);
  const breathe = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    enter.set(pop(delay, M.overshoot.soft, 500));
    breathe.set(withDelay(delay + 500, withRepeat(withTiming(1, { duration: M.duration.breathe / 2, easing: ease.inOut }), -1, true)));
  }, [reduced, delay, enter, breathe]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: enter.get() * (0.98 + breathe.get() * 0.04) }] }));
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}
    />
  );
}
