import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SwipeDeck, SwipeDirection } from '../src/components/SwipeDeck';
import { HeartBurst, HeartBurstHandle } from '../src/components/HeartBurst';
import { CheckStamp } from '../src/components/CheckStamp';
import { PinDrop } from '../src/components/PinDrop';
import { Illustration } from '../src/components/Illustration';
import { AnimatedLogo } from '../src/components/AnimatedLogo';
import { Button } from '../src/components/Button';
import { ChatBubble } from '../src/components/ChatBubble';
import { TermsCard } from '../src/components/TermsCard';
import { MapCard } from '../src/components/MapCard';
import { StepHeader } from '../src/components/StepHeader';
import { CheckRow } from '../src/components/CheckRow';
import { EmptyState } from '../src/components/EmptyState';
import { TrustScreen } from '../src/components/TrustScreen';
import { useToast } from '../src/components/Toast';
import { fontFamily, useTheme, useThemeMode, type Theme } from '../src/theme';
import { isRTL, t as tr } from '../src/i18n';
import type { SvgName } from '../src/illustrations';

// Developer screen: every animation from the intro video, side by side with the app components.
// Use it to check that app motion matches social media. Remove from production builds (phase 9).
const SAMPLE: { id: string; pet: string; who: string; price: 'free' | number; art: SvgName; bg: keyof Theme['tint'] }[] = [
  { id: '1', pet: 'Mango', who: 'Karim, 31', price: 'free', art: 'catMango', bg: 'orange' },
  { id: '2', pet: 'Midnight', who: 'Omar, 34', price: 300, art: 'catMidnight', bg: 'teal' },
  { id: '3', pet: 'Storm', who: 'Laila, 26', price: 200, art: 'huskyStorm', bg: 'sea' },
  { id: '4', pet: 'Biscuit', who: 'Mona, 29', price: 250, art: 'dogBiscuit', bg: 'orange' },
];

export default function Showcase() {
  const t = useTheme();
  const { mode, setMode } = useThemeMode();
  const toast = useToast();
  const burst = useRef<HeartBurstHandle>(null);
  const swipe = useRef<((d: SwipeDirection) => void) | null>(null);
  const [replay, setReplay] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const c = t.color;
  const rtl = isRTL();

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 32 }}>
      <Button title={tr('dev.theme', { mode })} variant="secondary"
        onPress={() => setMode(mode === 'system' ? 'light' : mode === 'light' ? 'navy' : 'system')} />
      <Button title={tr('dev.replay')} onPress={() => { setReplay((r) => r + 1); setAccepted(false); }} />

      <View key={`logo${replay}`} style={{ alignItems: 'center' }}><AnimatedLogo size={180} /></View>

      <SwipeDeck
        items={SAMPLE}
        keyOf={(i) => i.id + replay}
        cardHeight={460}
        bindControls={(fn) => { swipe.current = fn; }}
        onSwipe={(_, dir) => { if (dir === 'like') burst.current?.burst(); }}
        renderCard={(i) => (
          <View style={{ flex: 1, borderRadius: 28, backgroundColor: c.surface, overflow: 'hidden' }}>
            <View style={{ height: 300, backgroundColor: t.tint[i.bg], alignItems: 'center', justifyContent: 'center' }}>
              <Illustration name={i.art} width={240} height={204} label={tr('illustration.label', { pet: i.pet })} />
            </View>
            <View style={{ padding: 20, flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ fontFamily: fontFamily('bold', rtl), fontSize: 24, color: c.text }}>{i.who}</Text>
                <Text style={{ color: c.textMuted, fontFamily: fontFamily('regular', rtl) }}>{tr('card.livesHere', { pet: i.pet })}</Text>
              </View>
              <Text style={{ fontFamily: fontFamily('bold', rtl), fontSize: 22, color: c.primary }}>
                {i.price === 'free' ? tr('price.free') : tr('price.egp', { amount: i.price })}
              </Text>
            </View>
          </View>
        )}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 40, alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('swipe.pass')} onPress={() => swipe.current?.('pass')}
          style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: t.brand.coral, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 30, color: t.brand.coral }}>✕</Text>
        </Pressable>
        <View>
          <Pressable accessibilityRole="button" accessibilityLabel={tr('swipe.like')} onPress={() => swipe.current?.('like')}
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

      <View key={`chat${replay}`} style={{ gap: 12 }}>
        <ChatBubble text={tr('card.livesHere', { pet: 'Mango' })} />
        <ChatBubble text={tr('terms.accept')} mine />
        <ChatBubble text={tr('chat.maskedHint')} masked />
        <TermsCard
          terms={{ dates: '2 – 9 Nov', pet: 'Mango', location: tr('card.petFriendly'), cost: tr('price.egp', { amount: 250 }) }}
          accepted={accepted} onAccept={() => setAccepted(true)} onChange={() => setAccepted(false)} />
      </View>

      <MapCard />
      <MapCard exact lat={28.5} lng={34.51} address="Masbat Road" />

      <Button title={tr('toast.dismiss')} variant="accent" onPress={() => toast.show(tr('check.label'), 'success')} />

      <View style={{ height: 320, borderRadius: 28, overflow: 'hidden' }}>
        <EmptyState message={tr('calendar.empty')} art="catMango" actionLabel={tr('empty.findHost')} onAction={() => {}} />
      </View>

      <View style={{ height: 300, borderRadius: 28, overflow: 'hidden' }}>
        <TrustScreen>
          <StepHeader step={2} total={6} onBack={() => {}} />
          <View style={{ padding: 24 }}>
            <CheckRow title={tr('logo.label')} description={tr('welcome.tagline')} />
            <CheckRow title={tr('map.exact')} description={tr('chat.maskedHint')} done={false} />
          </View>
        </TrustScreen>
      </View>
    </ScrollView>
  );
}
