import React, { useCallback, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { tap as buzz } from '../lib/haptics';
import { M, ease, useEntrance, useReducedMotion } from '../motion';

export type SwipeDirection = 'pass' | 'like';

interface Props<T> {
  items: T[];
  keyOf: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onSwipe: (item: T, dir: SwipeDirection) => void;
  /** Lets buttons trigger a swipe: called once with a function you can store and call later. */
  bindControls?: (swipe: (dir: SwipeDirection) => void) => void;
  /** A tap on the top card (not a swipe). */
  onPressCard?: (item: T) => void;
  cardHeight?: number;
  /** What a screen reader says about a card; the top card then reads as one button that opens it. */
  labelOf?: (item: T) => string;
}

/** Browse stack. Motion matches the "Swipe a sitter" scene of the intro video (docs/motion.md section 3). */
export function SwipeDeck<T>({ items, keyOf, renderCard, onSwipe, bindControls, onPressCard, labelOf, cardHeight = 560 }: Props<T>) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  // Only the cards on screen when the deck first appears fly in from below; later cards just move up the stack.
  const [firstKeys] = useState(() => new Set(items.slice(0, 3).map(keyOf)));
  const x = useSharedValue(0);
  const fade = useSharedValue(1);
  const promote = useSharedValue(0);

  const done = useCallback((dir: SwipeDirection) => {
    const item = items[index];
    buzz();                                      // the buzz is skipped when haptics are off in Settings
    setIndex((i) => i + 1);                      // the card on top is reset once the new top card is on screen (see below)
    if (item) onSwipe(item, dir);
  }, [index, items, onSwipe]);

  // After the next card has taken the top: bring the animated values back to rest, so the card that left cannot flash back.
  React.useEffect(() => { x.set(0); fade.set(1); promote.set(0); }, [index, x, fade, promote]);

  const fling = useCallback((dir: SwipeDirection, fromButton: boolean) => {
    'worklet';
    const sign = dir === 'like' ? 1 : -1;
    const out = withTiming(sign * width * 1.4, { duration: M.duration.swipeOut, easing: ease.in }, (fin) => {
      if (fin) runOnJS(done)(dir);
    });
    // Buttons get the small anticipation nudge from the video; finger swipes do not.
    x.set(fromButton && !reduced ? withSequence(withTiming(-sign * 30, { duration: 200, easing: ease.out }), out) : out);
    promote.set(withDelay(150, withTiming(1, { duration: M.duration.promote, easing: ease.out })));
    fade.set(withDelay(M.duration.swipeOut - 200, withTiming(0, { duration: 200 })));     // fades in the last 200 ms of the 500 ms exit
  }, [width, done, reduced, x, fade, promote]);

  React.useEffect(() => { bindControls?.((dir) => fling(dir, true)); }, [bindControls, fling]);

  const pan = Gesture.Pan()
    .onUpdate((e) => { x.set(e.translationX); })
    .onEnd((e) => {
      const commit = Math.abs(e.translationX) > width * 0.35 || Math.abs(e.velocityX) > 800;
      if (commit) fling(e.translationX > 0 ? 'like' : 'pass', false);
      else x.set(withSpring(0, { damping: 15, stiffness: 180 }));
    });

  const press = useCallback(() => { const item = items[index]; if (item) onPressCard?.(item); }, [items, index, onPressCard]);
  const tap = Gesture.Tap().maxDistance(10).onEnd((_e, ok) => { if (ok) runOnJS(press)(); });
  const gesture = Gesture.Exclusive(pan, tap);

  const top = useAnimatedStyle(() => {
    const dx = x.get();
    // 1:1 with the finger (x / 20 degrees) up to the commit point, then on towards 32 degrees as the card leaves.
    const a = Math.abs(dx);
    const deg = a <= width * 0.35 ? a / 20 : interpolate(a, [width * 0.35, width * 1.4], [(width * 0.35) / 20, 32], Extrapolation.CLAMP);
    return {
      transform: [{ translateX: dx }, { rotate: reduced ? '0deg' : `${Math.sign(dx) * deg}deg` }],
      opacity: fade.get(),
    };
  });

  const visible = items.slice(index, index + 3);
  return (
    <View style={{ height: cardHeight + 60 }}>
      {visible.map((item, depth) => <Layer key={keyOf(item)} depth={depth} enter={firstKeys.has(keyOf(item))} label={labelOf?.(item)} onPress={press} promote={promote} topStyle={top} pan={gesture} height={cardHeight}>{renderCard(item)}</Layer>).reverse()}
    </View>
  );
}

function Layer({ depth, enter, label, onPress, promote, topStyle, pan, height, children }: any) {
  // docs/motion.md section 3: from 300 px below, backOut(1.5), 600 ms, 120 ms apart (Reduce Motion: a 200 ms fade).
  // The entrance, the stack position and the drag each set a transform, so they sit on separate views (the last would win).
  const entrance = useEntrance({ delay: depth * 120, rise: 300, k: M.overshoot.card, duration: M.duration.enter, scale: false });
  const style = useAnimatedStyle(() => {
    const level = depth === 0 ? 0 : depth - promote.get();
    const rot = depth === 0 ? 0 : (depth % 2 ? -5 : 5) * Math.min(level, 1);
    return { transform: [{ translateY: level * 26 }, { scale: 1 - level * 0.05 }, { rotate: `${rot}deg` }] };
  });
  const top = depth === 0;
  const inner = (
    <Animated.View
      importantForAccessibility={top ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!top}
      accessible={top && !!label} accessibilityRole={top && label ? 'button' : undefined} accessibilityLabel={top ? label : undefined} onAccessibilityTap={top ? onPress : undefined}
      style={[{ flex: 1 }, style, top ? topStyle : null]}>
      {children}
    </Animated.View>
  );
  return (
    <Animated.View pointerEvents={top ? 'auto' : 'none'} style={[{ position: 'absolute', start: 0, end: 0, height, zIndex: 10 - depth }, enter ? entrance : null]}>
      {top ? <GestureDetector gesture={pan}>{inner}</GestureDetector> : inner}
    </Animated.View>
  );
}
