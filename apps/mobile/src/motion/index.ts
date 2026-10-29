// Shared motion vocabulary. Same timings as the social media animations (docs/motion.md).
import { useEffect } from 'react';
import { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import tokens from '../theme/tokens.json';

export const M = tokens.motion;

export const ease = {
  out: Easing.out(Easing.cubic),
  in: Easing.in(Easing.cubic),
  inOut: Easing.inOut(Easing.cubic),
  backOut: (k: number = M.overshoot.pop) => Easing.out(Easing.back(k)),
};

/** Pop from 0 to 1 with overshoot. Falls back to a plain fade-length timing when Reduce Motion is on. */
export function pop(delay = 0, k: number = M.overshoot.pop, duration = M.duration.pop) {
  'worklet';
  return withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.back(k)), reduceMotion: ReduceMotion.System }));
}

/** Landing squash: returns a sequence for a scale factor 1 -> 1+a -> 1. Use scaleX = s, scaleY = 2 - s. */
export function squash(a = 0.08, delay = 0, duration = 450) {
  'worklet';
  return withDelay(
    delay,
    withSequence(
      withTiming(1 + a, { duration: duration * 0.35, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System }),
      withTiming(1, { duration: duration * 0.65, easing: Easing.out(Easing.elastic(1.2)), reduceMotion: ReduceMotion.System })
    )
  );
}

export { useReducedMotion };

/** Deterministic pseudo-random numbers so bursts look identical every time (and in the video). */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What an "arriving" element does. Reduce Motion: no overshoot, no travel, just a 200 ms fade (docs/motion.md section 8). */
export function entranceSpec(reduced: boolean, opts: { rise?: number; k?: number; duration?: number; scale?: boolean } = {}) {
  return reduced
    ? { rise: 0, overshoot: 0, duration: 200, scales: false }
    : { rise: opts.rise ?? 40, overshoot: opts.k ?? M.overshoot.pop, duration: opts.duration ?? M.duration.pop, scales: opts.scale ?? true };
}

// The 200 ms Reduce Motion fade must still play when the system setting is on, so it opts out of Reanimated's
// default "skip animations when Reduce Motion is on" (that default is what makes the overshoot and loops stop).
const reducedFade = { duration: 200, easing: Easing.inOut(Easing.cubic), reduceMotion: ReduceMotion.Never };

/** Fade from 0 to 1 over 200 ms when Reduce Motion is on; shown at once otherwise (the component animates itself). */
export function useReducedFadeIn() {
  const reduced = useReducedMotion();
  const o = useSharedValue(reduced ? 0 : 1);
  useEffect(() => { o.set(reduced ? withTiming(1, reducedFade) : 1); }, [reduced, o]);
  return useAnimatedStyle(() => ({ opacity: o.get() }));
}

/**
 * Entrance for bubbles, cards and toasts: rises, scales from 0 with a soft overshoot, opacity reaches 1 early.
 * `origin` is the corner it grows from ('start' or 'end' side of the bottom edge, or 'center').
 * `scale: false` gives a plain rise and fade (the map card).
 */
export function useEntrance(opts: { delay?: number; rise?: number; k?: number; duration?: number; scale?: boolean; origin?: 'bottom-start' | 'bottom-end' | 'center'; rtl?: boolean } = {}) {
  const reduced = useReducedMotion();
  const spec = entranceSpec(reduced, opts);
  const delay = opts.delay ?? 0;
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(reduced
      ? withDelay(delay, withTiming(1, reducedFade))
      : spec.scales ? pop(delay, spec.overshoot, spec.duration)
        : withDelay(delay, withTiming(1, { duration: spec.duration, easing: ease.out, reduceMotion: ReduceMotion.System })));
  }, [p, reduced, delay, spec.duration, spec.overshoot, spec.scales]);
  const fadeEnd = Math.min(1, 150 / spec.duration);
  const side = opts.origin === 'bottom-end' ? 'end' : 'start';
  const x = opts.origin === 'center' ? '50%' : (side === 'start') !== !!opts.rtl ? '0%' : '100%';
  const y = opts.origin === 'center' ? '50%' : '100%';
  const rise = spec.rise;
  const scales = spec.scales;
  const fades = reduced;
  return useAnimatedStyle(() => {
    const v = p.get();
    if (fades) return { opacity: v };
    return {
      opacity: Math.min(1, v / fadeEnd),
      transform: scales
        ? [{ translateY: (1 - Math.min(v, 1)) * rise }, { scale: v }]
        : [{ translateY: (1 - Math.min(v, 1)) * rise }],
      transformOrigin: [x, y, 0],
    };
  });
}
