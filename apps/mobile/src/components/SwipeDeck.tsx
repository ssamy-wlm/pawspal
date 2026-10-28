import React, { useCallback, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { M, ease, useReducedMotion } from '../motion';

export type SwipeDirection = 'pass' | 'like';

interface Props<T> {
  items: T[];
  keyOf: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onSwipe: (item: T, dir: SwipeDirection) => void;
  /** Lets buttons trigger a swipe: called once with a function you can store and call later. */
  bindControls?: (swipe: (dir: SwipeDirection) => void) => void;
  cardHeight?: number;
}

/** Browse stack. Motion matches the "Swipe a sitter" scene of the intro video (docs/motion.md section 3). */
export function SwipeDeck<T>({ items, keyOf, renderCard, onSwipe, bindControls, cardHeight = 560 }: Props<T>) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const x = useSharedValue(0);
  const promote = useSharedValue(0);

  const done = useCallback((dir: SwipeDirection) => {
    const item = items[index];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setIndex((i) => i + 1);
    x.value = 0;
    promote.value = 0;
    if (item) onSwipe(item, dir);
  }, [index, items, onSwipe]);

  const fling = useCallback((dir: SwipeDirection, fromButton: boolean) => {
    'worklet';
    const sign = dir === 'like' ? 1 : -1;
    const out = withTiming(sign * width * 1.4, { duration: M.duration.swipeOut, easing: ease.in }, (fin) => {
      if (fin) runOnJS(done)(dir);
    });
    // Buttons get the small anticipation nudge from the video; finger swipes do not.
    x.value = fromButton && !reduced ? withSequence(withTiming(-sign * 30, { duration: 200, easing: ease.out }), out) : out;
    promote.value = withDelay(150, withTiming(1, { duration: M.duration.promote, easing: ease.out }));
  }, [width, done, reduced]);

  React.useEffect(() => { bindControls?.((dir) => fling(dir, true)); }, [bindControls, fling]);

  const pan = Gesture.Pan()
    .onUpdate((e) => { x.value = e.translationX; })
    .onEnd((e) => {
      const commit = Math.abs(e.translationX) > width * 0.35 || Math.abs(e.velocityX) > 800;
      if (commit) fling(e.translationX > 0 ? 'like' : 'pass', false);
      else x.value = withSpring(0, { damping: 15, stiffness: 180 });
    });

  const top = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { rotate: reduced ? '0deg' : `${x.value / 20}deg` }],
    opacity: Math.abs(x.value) > width ? 1 - (Math.abs(x.value) - width) / (width * 0.4) : 1,
  }));

  const visible = items.slice(index, index + 3);
  return (
    <View style={{ height: cardHeight + 60 }}>
      {visible.map((item, depth) => <Layer key={keyOf(item)} depth={depth} promote={promote} topStyle={top} pan={pan} height={cardHeight}>{renderCard(item)}</Layer>).reverse()}
    </View>
  );
}

function Layer({ depth, promote, topStyle, pan, height, children }: any) {
  const style = useAnimatedStyle(() => {
    const level = depth === 0 ? 0 : depth - promote.value;
    const rot = depth === 0 ? 0 : (depth % 2 ? -5 : 5) * Math.min(level, 1);
    return { transform: [{ translateY: level * 26 }, { scale: 1 - level * 0.05 }, { rotate: `${rot}deg` }] };
  });
  const card = (
    <Animated.View style={[{ position: 'absolute', left: 0, right: 0, height, zIndex: 10 - depth }, style, depth === 0 ? topStyle : null]}>
      {children}
    </Animated.View>
  );
  return depth === 0 ? <GestureDetector gesture={pan}>{card}</GestureDetector> : card;
}
