// Shared motion vocabulary. Same timings as the social media animations (docs/motion.md).
import { Easing, ReduceMotion, useReducedMotion, withDelay, withSequence, withTiming } from 'react-native-reanimated';
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
