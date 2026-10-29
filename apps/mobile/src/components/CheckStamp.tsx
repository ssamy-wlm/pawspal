import React, { useEffect } from 'react';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { M, ease, pop, squash, useReducedFadeIn, useReducedMotion } from '../motion';
import { useTheme } from '../theme';
import { t as tr } from '../i18n';

const APath = Animated.createAnimatedComponent(Path);
const TICK_LENGTH = 65; // length of the tick path below, in viewBox units

/** "Booking confirmed" check: stamps in, squashes, then the tick draws itself. */
export function CheckStamp({ size = 160, color }: { size?: number; color?: string }) {
  const brand = useTheme().brand;
  const reduced = useReducedMotion();
  const fade = useReducedFadeIn();
  const s = useSharedValue(reduced ? 1 : 0);
  const sq = useSharedValue(1);
  const draw = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    s.set(pop(0, M.overshoot.bouncy, M.duration.stamp));
    sq.set(squash(0.12, M.duration.stamp, 300));
    draw.set(withDelay(350, withTiming(1, { duration: 400, easing: ease.out })));
  }, [reduced, s, sq, draw]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: s.get() * sq.get() }, { scaleY: s.get() * (2 - sq.get()) }] }));
  const props = useAnimatedProps(() => ({ strokeDashoffset: TICK_LENGTH * (1 - draw.get()) }));
  return (
    <Animated.View accessible accessibilityRole="image" accessibilityLabel={tr('check.label')} style={[{ width: size, height: size }, style, fade]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={50} fill={color ?? brand.teal} />
        <APath d="M28 52 L44 67 L73 36" fill="none" stroke={brand.cream} strokeWidth={9} strokeLinecap="round"
          strokeLinejoin="round" strokeDasharray={TICK_LENGTH} animatedProps={props} />
      </Svg>
    </Animated.View>
  );
}
