import React, { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { fontFamily, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';
import { M, ease, useEntrance } from '../motion';

export interface TermsData { dates: string; pet: string; location: string; cost: string }

/** The proposed-terms card from the chat. Accept and Change; either side changing the terms clears both acceptances. */
export function TermsCard({ terms, accepted, onAccept, onChange }: { terms: TermsData; accepted: boolean; onAccept: () => void; onChange: () => void }) {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const reduced = useReducedMotion();
  const entrance = useEntrance({ rise: 40, k: M.overshoot.bubble, duration: M.duration.pop, origin: 'bottom-start', rtl });
  const press = useSharedValue(1);
  const done = useSharedValue(accepted ? 1 : 0);     // 0 = "Accept terms", 1 = "Accepted"
  const ripple = useSharedValue(0);
  const wasAccepted = useRef(accepted);

  useEffect(() => {
    // The label cross-fade still plays with Reduce Motion on (200 ms); the ripple does not, and never replays on mount.
    done.set(withTiming(accepted ? 1 : 0, { duration: reduced ? 200 : M.duration.fast, easing: ease.inOut, reduceMotion: ReduceMotion.Never }));
    if (accepted && !wasAccepted.current && !reduced) { ripple.set(0); ripple.set(withTiming(1, { duration: M.duration.pop, easing: ease.out })); }
    wasAccepted.current = accepted;
  }, [accepted, reduced, done, ripple]);

  const button = useAnimatedStyle(() => ({ transform: [{ scale: press.get() }] }));
  const ring = useAnimatedStyle(() => ({ opacity: ripple.get() > 0 ? 1 - ripple.get() : 0, transform: [{ scale: 0.4 + 1.6 * ripple.get() }] }));
  const labelOff = useAnimatedStyle(() => ({ opacity: 1 - done.get() }));
  const labelOn = useAnimatedStyle(() => ({ opacity: done.get() }));

  const rows: [string, string][] = [[tr('terms.dates'), terms.dates], [tr('terms.pet'), terms.pet], [tr('terms.location'), terms.location], [tr('terms.cost'), terms.cost]];
  const text = { fontFamily: fontFamily('regular', rtl), fontSize: 15 } as const;

  return (
    <Animated.View style={[{ borderRadius: 24, padding: 20, gap: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }, entrance]}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{tr('terms.title')}</Text>
      <View style={{ gap: 8 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Text style={[text, { color: c.textMuted }]}>{label}</Text>
            <Text style={[text, { color: c.text, flexShrink: 1, textAlign: rtl ? 'left' : 'right', fontFamily: fontFamily('semibold', rtl) }]}>{value}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, borderRadius: 999, borderWidth: 4, borderColor: t.brand.orange }, ring]} />
          <Pressable accessibilityRole="button" accessibilityLabel={accepted ? tr('terms.accepted') : tr('terms.accept')} accessibilityState={{ selected: accepted }}
            disabled={accepted} onPress={onAccept}
            onPressIn={() => press.set(withTiming(0.92, { duration: M.duration.tap }))} onPressOut={() => press.set(withTiming(1, { duration: M.duration.tap }))}>
            <Animated.View style={[{ minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
              backgroundColor: accepted ? t.brand.orange : c.primary }, button]}>
              <Animated.Text style={[{ color: accepted ? t.color.onAccent : c.onPrimary, fontSize: 16, fontFamily: fontFamily('semibold', rtl) }, labelOff, { position: accepted ? 'absolute' : 'relative' }]}>{tr('terms.accept')}</Animated.Text>
              <Animated.Text style={[{ color: t.color.onAccent, fontSize: 16, fontFamily: fontFamily('semibold', rtl) }, labelOn, { position: accepted ? 'relative' : 'absolute' }]}>{tr('terms.accepted')}</Animated.Text>
            </Animated.View>
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('terms.change')} onPress={onChange}
          style={{ minHeight: 48, paddingHorizontal: 22, borderRadius: 999, borderWidth: 3, borderColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: c.primary, fontSize: 16, fontFamily: fontFamily('semibold', rtl) }}>{tr('terms.change')}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
