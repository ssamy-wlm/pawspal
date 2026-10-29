import React from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Link, router } from 'expo-router';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';
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

function Option({ title, sub, primary, onPress, delay }: { title: string; sub: string; primary?: boolean; onPress: () => void; delay: number }) {
  const t = useTheme();
  const rtl = isRTL();
  const c = t.color;
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(500)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${sub}`}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 24,
          backgroundColor: primary ? c.primary : c.surface,
          borderWidth: primary ? 0 : 3, borderColor: c.primary,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}>
        <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
          backgroundColor: primary ? t.brand.teal : t.tint.orange }}>
          <Illustration name={primary ? 'pawspalIcon' : 'heart'} width={30} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fontFamily('bold', rtl), fontSize: 19, color: primary ? c.onPrimary : c.text }}>{title}</Text>
          <Text style={{ fontFamily: fontFamily('regular', rtl), fontSize: 14, color: primary ? c.onPrimary : c.textMuted }}>{sub}</Text>
        </View>
        <Text style={{ fontSize: 28, color: primary ? c.onPrimary : c.primary }}>{rtl ? '‹' : '›'}</Text>
      </Pressable>
    </Animated.View>
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
        <Animated.Text entering={FadeInRight.delay(500).duration(500)}
          style={{ fontFamily: fontFamily('extrabold', false), fontSize: 40, color: c.text, marginTop: 12 }}>PawsPal</Animated.Text>
        <Animated.Text entering={FadeInDown.delay(800).duration(500)}
          style={{ fontFamily: fontFamily('semibold', false), fontSize: 18, color: c.primary }}>Dahab</Animated.Text>
        <Animated.Text entering={FadeInDown.delay(1100).duration(500)}
          style={{ fontFamily: fontFamily('regular', rtl), fontSize: 16, color: c.textMuted, textAlign: 'center', marginTop: 8, maxWidth: 280 }}>
          {tr('welcome.tagline')}
        </Animated.Text>
      </View>

      <View style={{ paddingHorizontal: 24, paddingBottom: 32, gap: 14 }}>
        <Option primary title={tr('welcome.needSitter')} sub={tr('welcome.needSitterSub')} delay={1300} onPress={() => router.push('/signup/phone?role=owner')} />
        <Option title={tr('welcome.wantSit')} sub={tr('welcome.wantSitSub')} delay={1450} onPress={() => router.push('/signup/phone?role=sitter')} />
        <Pressable accessibilityRole="button" onPress={() => router.push('/signup/phone')} style={{ minHeight: 44, justifyContent: 'center', marginTop: 6 }}>
          <Text style={{ textAlign: 'center', color: c.textMuted, fontFamily: fontFamily('regular', rtl) }}>{tr('welcome.login')}</Text>
        </Pressable>
        <Text style={{ textAlign: 'center', color: c.textMuted, fontSize: 12, fontFamily: fontFamily('regular', rtl) }}>{tr('welcome.legal')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 4 }}>
          {LEGAL.map(({ slug, label }) => (
            <Link key={slug} href={`/legal/${slug}` as never} asChild>
              <Pressable accessibilityRole="link" style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
                <Text style={{ color: c.link, fontSize: 13, fontFamily: fontFamily('medium', rtl) }}>{tr(label)}</Text>
              </Pressable>
            </Link>
          ))}
        </View>
      </View>
    </View>
  );
}
