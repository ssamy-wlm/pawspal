import React, { useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Illustration } from './Illustration';
import { M, ease, squash, useReducedFadeIn, useReducedMotion } from '../motion';
import { useTheme } from '../theme';
import { t as tr } from '../i18n';

/** The exact-pin reveal: pin falls, squashes on landing, teal glow ring spreads. */
export function PinDrop({ delay = 1000, size = 56 }: { delay?: number; size?: number }) {
  const brand = useTheme().brand;
  const reduced = useReducedMotion();
  const fade = useReducedFadeIn();
  const fall = useSharedValue(reduced ? 1 : 0);
  const sq = useSharedValue(1);
  const glow = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    fall.set(withDelay(delay, withTiming(1, { duration: M.duration.pinDrop, easing: ease.in })));
    sq.set(squash(0.18, delay + M.duration.pinDrop, 300));
    glow.set(withDelay(delay + M.duration.pinDrop, withTiming(1, { duration: 1500, easing: ease.out })));
  }, [reduced, delay, fall, sq, glow]);
  const pin = useAnimatedStyle(() => ({
    opacity: fall.get() > 0 ? 1 : 0,
    transform: [{ translateY: (fall.get() - 1) * 320 }, { scaleX: sq.get() }, { scaleY: 2 - sq.get() }],
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: glow.get() > 0 ? (0.9 - 0.4 * glow.get()) * 0.3 : 0,   // 0.3 = glow strength
    transform: [{ scale: 0.3 + 0.9 * glow.get() }],
  }));
  const h = size * (80 / 60);
  return (
    <Animated.View accessible accessibilityLabel={tr('pin.label')} style={[{ width: size * 2.4, height: size * 2.4, alignItems: 'center', justifyContent: 'center' }, fade]}>
      <Animated.View style={[{ position: 'absolute', width: size * 2.4, height: size * 2.4, borderRadius: size * 1.2, backgroundColor: brand.teal }, ring]} />
      <Animated.View style={[{ width: size, height: h, marginTop: -h, transformOrigin: ['50%', '100%', 0] }, pin]}>
        <Illustration name="mapPin" width={size} height={h} />
      </Animated.View>
    </Animated.View>
  );
}
