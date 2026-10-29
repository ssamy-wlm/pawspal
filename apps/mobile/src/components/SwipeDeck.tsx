import React, { useCallback, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
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
}

/** Browse stack. Motion matches the "Swipe a sitter" scene of the intro video (docs/motion.md section 3). */
export function SwipeDeck<T>({ items, keyOf, renderCard, onSwipe, bindControls, onPressCard, cardHeight = 560 }: Props<T>) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  // Only the cards on screen when the deck first appears fly in from below; later cards just move up the stack.
  const [firstKeys] = useState(() => new Set(items.slice(0, 3).map(keyOf)));
  const x = useSharedValue(0);
  const promote = useSharedValue(0);

  const done = useCallback((dir: SwipeDirection) => {
    const item = items[index];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setIndex((i) => i + 1);
    x.set(0);
    promote.set(0);
    if (item) onSwipe(item, dir);
  }, [index, items, onSwipe, x, promote]);

  const fling = useCallback((dir: SwipeDirection, fromButton: boolean) => {
    'worklet';
    const sign = dir === 'like' ? 1 : -1;
    const out = withTiming(sign * width * 1.4, { duration: M.duration.swipeOut, easing: ease.in }, (fin) => {
      if (fin) runOnJS(done)(dir);
    });
    // Buttons get the small anticipation nudge from the video; finger swipes do not.
    x.set(fromButton && !reduced ? withSequence(withTiming(-sign * 30, { duration: 200, easing: ease.out }), out) : out);
    promote.set(withDelay(150, withTiming(1, { duration: M.duration.promote, easing: ease.out })));
  }, [width, done, reduced, x, promote]);

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
    return {
      transform: [{ translateX: dx }, { rotate: reduced ? '0deg' : `${dx / 20}deg` }],
      opacity: Math.abs(dx) > width ? 1 - (Math.abs(dx) - width) / (width * 0.4) : 1,
    };
  });

  const visible = items.slice(index, index + 3);
  return (
    <View style={{ height: cardHeight + 60 }}>
      {visible.map((item, depth) => <Layer key={keyOf(item)} depth={depth} enter={firstKeys.has(keyOf(item))} promote={promote} topStyle={top} pan={gesture} height={cardHeight}>{renderCard(item)}</Layer>).reverse()}
    </View>
  );
}

function Layer({ depth, enter, promote, topStyle, pan, height, children }: any) {
  // docs/motion.md section 3: from 300 px below, backOut(1.5), 600 ms, 120 ms apart (Reduce Motion: a 200 ms fade).
  const entrance = useEntrance({ delay: depth * 120, rise: 300, k: M.overshoot.card, duration: M.duration.enter, scale: false });
  const style = useAnimatedStyle(() => {
    const level = depth === 0 ? 0 : depth - promote.get();
    const rot = depth === 0 ? 0 : (depth % 2 ? -5 : 5) * Math.min(level, 1);
    return { transform: [{ translateY: level * 26 }, { scale: 1 - level * 0.05 }, { rotate: `${rot}deg` }] };
  });
  const card = (
    <Animated.View importantForAccessibility={depth === 0 ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={depth !== 0}
      style={[{ position: 'absolute', start: 0, end: 0, height, zIndex: 10 - depth }, style, depth === 0 ? topStyle : null, enter ? entrance : null]}>
      {children}
    </Animated.View>
  );
  return depth === 0 ? <GestureDetector gesture={pan}>{card}</GestureDetector> : card;
}
