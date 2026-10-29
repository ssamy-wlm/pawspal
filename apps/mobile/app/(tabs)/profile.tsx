import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { Icon } from '../../src/components/Icon';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, Key, t as tr } from '../../src/i18n';

const LEGAL: { slug: string; label: Key }[] = [
  { slug: 'termsOfService', label: 'legal.terms' },
  { slug: 'privacyPolicy', label: 'legal.privacy' },
  { slug: 'communityGuidelines', label: 'legal.guidelines' },
];

/** Profile tab. The real profile arrives in phase 3; for now it holds Settings and the legal documents. */
export default function ProfileTab() {
  const c = useTheme().color;
  const rtl = isRTL();
  const row = (label: string, href: string, icon?: boolean) => (
    <Link key={href} href={href as never} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label}
        style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
        {icon ? <Icon name="settings" color={c.primary} /> : null}
        <Text style={{ flex: 1, color: c.text, fontSize: 16, fontFamily: fontFamily('medium', rtl) }}>{label}</Text>
      </Pressable>
    </Link>
  );
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 12 }}>
      <Text style={{ color: c.textMuted, fontSize: 16, marginBottom: 8, fontFamily: fontFamily('regular', rtl) }}>{tr('profile.soon')}</Text>
      {row(tr('profile.settings'), '/settings', true)}
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 17, marginTop: 16, fontFamily: fontFamily('bold', rtl) }}>{tr('profile.legal')}</Text>
      {LEGAL.map((d) => row(tr(d.label), `/legal/${d.slug}`))}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
