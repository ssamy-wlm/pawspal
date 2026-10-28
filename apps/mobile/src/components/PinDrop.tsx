import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Illustration } from './Illustration';
import { M, ease, squash, useReducedMotion } from '../motion';

/** The exact-pin reveal: pin falls, squashes on landing, teal glow ring spreads. */
export function PinDrop({ delay = 1000, size = 56 }: { delay?: number; size?: number }) {
  const reduced = useReducedMotion();
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
    opacity: glow.get() > 0 ? 0.9 - 0.4 * glow.get() : 0,
    transform: [{ scale: 0.3 + 0.9 * glow.get() }],
  }));
  const h = size * (80 / 60);
  return (
    <View accessible accessibilityLabel="Exact location pin" style={{ width: size * 2.4, height: size * 2.4, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size * 2.4, height: size * 2.4, borderRadius: size * 1.2, backgroundColor: 'rgba(31,163,163,0.3)' }, ring]} />
      <Animated.View style={[{ width: size, height: h, marginTop: -h, transformOrigin: ['50%', '100%', 0] }, pin]}>
        <Illustration name="mapPin" width={size} height={h} />
      </Animated.View>
    </View>
  );
}
