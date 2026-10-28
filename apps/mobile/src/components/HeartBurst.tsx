import React, { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';
import Animated, { Easing, SharedValue, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Illustration } from './Illustration';
import { M, seeded, useReducedMotion } from '../motion';

const rnd = seeded(4);
const HEARTS = Array.from({ length: 9 }, (_, i) => ({
  dx: (rnd() - 0.5) * 450, dy: -150 - rnd() * 360, s: 0.5 + rnd() * 0.7, d: rnd() * 250, orange: i % 2 === 1,
}));

function Heart({ h, p }: { h: (typeof HEARTS)[number]; p: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const t = Math.max(0, Math.min(1, (p.value * M.duration.heartBurst - h.d) / (M.duration.heartBurst - 250)));
    const out = 1 - Math.pow(1 - t, 3);
    const grow = Math.min(1, t / 0.3);
    const back = 1 + 2.8 * Math.pow(grow - 1, 3) + 1.8 * Math.pow(grow - 1, 2);
    return {
      opacity: t <= 0 ? 0 : t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35,
      transform: [{ translateX: h.dx * out }, { translateY: h.dy * out }, { scale: h.s * (t <= 0 ? 0 : back) }],
    };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left: -22, top: -22, width: 44, height: 44 }, style]}>
      <Illustration name="heart" width={44} />
    </Animated.View>
  );
}

export interface HeartBurstHandle { burst: () => void }

/** Nine hearts rising from a point. Place it centred on the like button and call ref.burst(). */
export const HeartBurst = forwardRef<HeartBurstHandle>((_, ref) => {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  useImperativeHandle(ref, () => ({
    burst: () => {
      if (reduced) return;
      p.value = 0;
      p.value = withDelay(0, withTiming(1, { duration: M.duration.heartBurst, easing: Easing.linear }));
    },
  }));
  return (
    <View pointerEvents="none" accessible={false} style={{ position: 'absolute', left: '50%', top: '50%' }}>
      {HEARTS.map((h, i) => <Heart key={i} h={h} p={p} />)}
    </View>
  );
});
