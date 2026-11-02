import React from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Link, router } from 'expo-router';
import Animated from 'react-native-reanimated';
import { useEntrance } from '../src/motion';
import { AnimatedLogo } from '../src/components/AnimatedLogo';
import { Blob } from '../src/components/Blob';
import { Illustration } from '../src/components/Illustration';
import { fontFamily, useTheme } from '../src/theme';
import { isRTL, Key, t as tr } from '../src/i18n';

const LEGAL: { slug: string; label: Key }[] = [
  { slug: 'termsOfService', label: 'legal.terms' },
  { slug: 'privacyPolicy', label: 'legal.privacy' },
  { slug: 'communityGuidelines', label: 'legal.guidelines' },
];

/** Plain rise and fade; with Reduce Motion it is only a 200 ms fade, no travel (docs/motion.md section 8). */
function Enter({ delay, rise = 30, children }: { delay: number; rise?: number; children: React.ReactNode }) {
  const style = useEntrance({ delay, rise, duration: 500, scale: false });
  return <Animated.View style={style}>{children}</Animated.View>;
}

function Option({ title, sub, primary, onPress, delay }: { title: string; sub: string; primary?: boolean; onPress: () => void; delay: number }) {
  const t = useTheme();
  const rtl = isRTL();
  const c = t.color;
  return (
    <Enter delay={delay}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${sub}`}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 24,
          backgroundColor: primary ? c.primary : c.surface,
          borderWidth: primary ? 0 : 3, borderColor: c.primary,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        })}>
        <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
          backgroundColor: primary ? t.brand.teal : t.tint.orange }}>
          <Illustration name={primary ? 'pawspalIcon' : 'heart'} width={30} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fontFamily('bold', rtl), fontSize: 18, color: primary ? c.onPrimary : c.text }}>{title}</Text>
          <Text style={{ fontFamily: fontFamily('regular', rtl), fontSize: 14, color: primary ? c.onPrimary : c.textMuted }}>{sub}</Text>
        </View>
        <Text style={{ fontSize: 28, color: primary ? c.onPrimary : c.primary }}>{rtl ? '‹' : '›'}</Text>
      </Pressable>
    </Enter>
  );
}

/** Welcome screen (mockup 01-welcome), with the logo entrance from the intro video. */
export default function Welcome() {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const rtl = isRTL();
  const c = t.color;

  return (
    <View style={{ flex: 1, backgroundColor: c.background, overflow: 'hidden' }}>
      <Blob x={width - 200} y={-120} size={360} color={t.name === 'navy' ? c.surface! : t.tint.teal} />
      <Blob x={-110} y={height * 0.3} size={220} color={t.name === 'navy' ? c.surface! : t.tint.orange} delay={150} />
      <Blob x={width * 0.62} y={height * 0.42} size={110} color={t.name === 'navy' ? c.surface! : t.tint.sand} delay={300} />

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 6 }}>
        <AnimatedLogo size={170} />
        <Enter delay={500} rise={0}>
          <Text style={{ fontFamily: fontFamily('extrabold', false), fontSize: 36, color: c.text, marginTop: 12 }}>PawsPal</Text>
        </Enter>
        <Enter delay={800}>
          <Text style={{ fontFamily: fontFamily('semibold', false), fontSize: 18, color: c.primary }}>Dahab</Text>
        </Enter>
        <Enter delay={1100}>
          <Text style={{ fontFamily: fontFamily('regular', rtl), fontSize: 16, color: c.textMuted, textAlign: 'center', marginTop: 8, maxWidth: 280 }}>
            {tr('welcome.tagline')}
          </Text>
        </Enter>
      </View>

      <View style={{ paddingHorizontal: 24, paddingBottom: 32, gap: 14 }}>
        <Option primary title={tr('welcome.create')} sub={tr('welcome.createSub')} delay={1300} onPress={() => router.push('/signup/account')} />
        <Option title={tr('welcome.signin')} sub={tr('welcome.signinSub')} delay={1450} onPress={() => router.push('/signin')} />
        <Text style={{ textAlign: 'center', color: c.textMuted, fontSize: 12, fontFamily: fontFamily('regular', rtl) }}>{tr('welcome.legal')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 4 }}>
          {LEGAL.map(({ slug, label }) => (
            <Link key={slug} href={`/legal/${slug}` as never} asChild>
              <Pressable accessibilityRole="link" style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
                <Text style={{ color: c.link, fontSize: 14, fontFamily: fontFamily('medium', rtl) }}>{tr(label)}</Text>
              </Pressable>
            </Link>
          ))}
        </View>
      </View>
    </View>
  );
}
