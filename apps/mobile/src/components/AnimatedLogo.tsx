import React, { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Ellipse, G, Path } from 'react-native-svg';
import { M, ease, pop, squash, useReducedFadeIn, useReducedMotion } from '../motion';
import { useTheme } from '../theme';
import { t as tr } from '../i18n';

// Geometry copied from assets/logo/pawspal-icon.svg (viewBox 0 0 200 200, group shifted down 8).
const TOES = [
  { cx: 43, cy: 86, rx: 15, ry: 23, rot: -35 },     // outer left
  { cx: 78.4, cy: 52, rx: 17, ry: 26, rot: -8 },     // inner left
  { cx: 121.6, cy: 52, rx: 17, ry: 26, rot: 8 },     // inner right
  { cx: 157, cy: 86, rx: 15, ry: 23, rot: 35 },      // outer right
];
const PAD = 'M100 86 C118 87 152 112 152 138 C152 154 139 164 126 159 C118 156 112 163 100 163 C88 163 82 156 74 159 C61 164 48 154 48 138 C48 112 82 87 100 86Z';
const DOOR = 'M90 159 L90 141 Q90 130 100 130 Q110 130 110 141 L110 159Z';

function Toe({ i, size, play }: { i: number; size: number; play: boolean }) {
  const t = TOES[i];
  const brand = useTheme().brand;
  const reduced = useReducedMotion();
  const s = useSharedValue(play && !reduced ? 0 : 1);
  const wiggle = useSharedValue(0);
  useEffect(() => {
    if (!play || reduced) return;
    s.set(pop(200 + i * M.stagger.toes, M.overshoot.bouncy, 400));
    wiggle.set(withDelay(1600, withRepeat(withSequence(
      withTiming(1, { duration: 520, easing: Easing.inOut(Easing.sin) }),
      withTiming(-1, { duration: 520, easing: Easing.inOut(Easing.sin) })), -1, true)));
  }, [play, reduced, i, s, wiggle]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.get() }, { rotate: `${wiggle.get() * 4}deg` }] }));
  const k = size / 200;
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', start: 0, top: 0, width: size, height: size,
        transformOrigin: [t.cx * k, (t.cy + t.ry * 0.8) * k, 0] }, style]}>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        <Ellipse cx={t.cx} cy={t.cy} rx={t.rx} ry={t.ry} transform={`rotate(${t.rot} ${t.cx} ${t.cy})`} fill={brand.orange} />
      </Svg>
    </Animated.View>
  );
}

/** The PawsPal paw-house logo with the same entrance as the intro video: pad pops and squashes, toes pop one by one, then a gentle sway. */
export function AnimatedLogo({ size = 200, play = true }: { size?: number; play?: boolean }) {
  const brand = useTheme().brand;
  const reduced = useReducedMotion();
  const fade = useReducedFadeIn();
  const grow = useSharedValue(play && !reduced ? 0 : 1);
  const sq = useSharedValue(1);
  const sway = useSharedValue(0);

  useEffect(() => {
    if (!play || reduced) return;
    grow.set(pop(0, M.overshoot.pop, 750));
    sq.set(squash(0.08, 750, 450));
    sway.set(withDelay(1200, withRepeat(withTiming(1, { duration: 1650, easing: ease.inOut }), -1, true)));
  }, [play, reduced, grow, sq, sway]);

  const padStyle = useAnimatedStyle(() => {
    const g = grow.get();
    const q = sq.get();
    return {
      transform: [
        { translateY: (1 - Math.min(g, 1)) * 60 },
        { scaleX: g * q },
        { scaleY: g * (2 - q) },
        { rotate: `${(sway.get() - 0.5) * 3.2}deg` },
      ],
    };
  });

  return (
    <Animated.View accessible accessibilityRole="image" accessibilityLabel={tr('logo.label')} style={[{ width: size, height: size }, fade]}>
      <Animated.View style={[{ width: size, height: size, transformOrigin: ['50%', '100%', 0] }, padStyle]}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <G>
            <Path d={PAD} fill={brand.teal} />
            <Path d={DOOR} fill={brand.sand} />
          </G>
        </Svg>
        {TOES.map((_, i) => <Toe key={i} i={i} size={size} play={play} />)}
      </Animated.View>
    </Animated.View>
  );
}
