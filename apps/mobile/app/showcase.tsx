import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SwipeDeck, SwipeDirection } from '../src/components/SwipeDeck';
import { HeartBurst, HeartBurstHandle } from '../src/components/HeartBurst';
import { CheckStamp } from '../src/components/CheckStamp';
import { PinDrop } from '../src/components/PinDrop';
import { Illustration } from '../src/components/Illustration';
import { AnimatedLogo } from '../src/components/AnimatedLogo';
import { Button } from '../src/components/Button';
import { useTheme, useThemeMode } from '../src/theme';
import type { SvgName } from '../src/illustrations';

// Developer screen: every animation from the intro video, side by side with the app components.
// Use it to check that app motion matches social media. Remove from production builds (phase 9).
const SAMPLE: { id: string; pet: string; who: string; price: string; art: SvgName; bg: string }[] = [
  { id: '1', pet: 'Mango', who: 'Karim, 31', price: 'Free', art: 'catMango', bg: '#FFE5C8' },
  { id: '2', pet: 'Midnight', who: 'Omar, 34', price: '300 EGP', art: 'catMidnight', bg: '#D6EFEF' },
  { id: '3', pet: 'Storm', who: 'Laila, 26', price: '200 EGP', art: 'huskyStorm', bg: '#E4DDF5' },
  { id: '4', pet: 'Biscuit', who: 'Mona, 29', price: '250 EGP', art: 'dogBiscuit', bg: '#FFE5C8' },
];

export default function Showcase() {
  const t = useTheme();
  const { mode, setMode } = useThemeMode();
  const burst = useRef<HeartBurstHandle>(null);
  const swipe = useRef<((d: SwipeDirection) => void) | null>(null);
  const [replay, setReplay] = useState(0);
  const c = t.color;

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 32 }}>
      <Button title={`Theme: ${mode} (tap to change)`} variant="secondary"
        onPress={() => setMode(mode === 'system' ? 'light' : mode === 'light' ? 'navy' : 'system')} />
      <Button title="Replay animations" onPress={() => setReplay((r) => r + 1)} />

      <View key={`logo${replay}`} style={{ alignItems: 'center' }}><AnimatedLogo size={180} /></View>

      <SwipeDeck
        items={SAMPLE}
        keyOf={(i) => i.id + replay}
        cardHeight={460}
        bindControls={(fn) => { swipe.current = fn; }}
        onSwipe={(_, dir) => { if (dir === 'like') burst.current?.burst(); }}
        renderCard={(i) => (
          <View style={{ flex: 1, borderRadius: 28, backgroundColor: c.surface, overflow: 'hidden' }}>
            <View style={{ height: 300, backgroundColor: i.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Illustration name={i.art} width={240} height={204} label={`${i.pet}, illustration`} />
            </View>
            <View style={{ padding: 20, flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ fontFamily: 'Poppins_700', fontSize: 24, color: c.text }}>{i.who}</Text>
                <Text style={{ color: c.textMuted }}>{i.pet} lives here</Text>
              </View>
              <Text style={{ fontFamily: 'Poppins_700', fontSize: 22, color: c.primary }}>{i.price}</Text>
            </View>
          </View>
        )}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 40, alignItems: 'center' }}>
        <Pressable accessibilityLabel="Pass" onPress={() => swipe.current?.('pass')}
          style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: t.brand.coral, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 30, color: t.brand.coral }}>✕</Text>
        </Pressable>
        <View>
          <Pressable accessibilityLabel="Like" onPress={() => swipe.current?.('like')}
            style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Illustration name="heart" width={40} />
          </Pressable>
          <HeartBurst ref={burst} />
        </View>
      </View>

      <View key={`booked${replay}`} style={{ alignItems: 'center', gap: 24 }}>
        <CheckStamp size={140} />
        <PinDrop />
      </View>
    </ScrollView>
  );
}
