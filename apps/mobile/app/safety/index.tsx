import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { TrustHeader, TrustScreen } from '../../src/components/TrustScreen';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, Key, t as tr } from '../../src/i18n';

function Row({ title, body, href, danger }: { title: string; body: string; href: string; danger?: boolean }) {
  const c = useTheme().color;
  const rtl = isRTL();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${body}`} onPress={() => router.push(href as never)}
      style={{ minHeight: 64, padding: 18, borderRadius: 24, backgroundColor: danger ? c.danger : c.surface, gap: 4 }}>
      <Text style={{ color: danger ? c.onDanger : c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{title}</Text>
      <Text style={{ color: danger ? c.onDanger : c.textMuted, fontSize: 15, lineHeight: 22, fontFamily: fontFamily('regular', rtl) }}>{body}</Text>
    </Pressable>
  );
}

/** The Safety Center (navy): emergency, report, block, the rules and appeals. */
function SafetyCenter() {
  const c = useTheme().color;
  const rtl = isRTL();
  const rows: { title: Key; body: Key; href: string; danger?: boolean }[] = [
    { title: 'safety.emergencyTitle', body: 'safety.emergencyBody', href: '/safety/emergency', danger: true },
    { title: 'safety.reportTitle', body: 'safety.reportBody', href: '/safety/report' },
    { title: 'safety.blockedTitle', body: 'safety.blockedBody', href: '/safety/blocked' },
    { title: 'safety.rulesTitle', body: 'safety.rulesBody', href: '/legal/communityGuidelines' },
  ];
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 14 }}>
      <TrustHeader title={tr('safety.title')} />
      <Text style={{ color: c.textMuted, fontSize: 16, lineHeight: 24, fontFamily: fontFamily('regular', rtl) }}>{tr('safety.intro')}</Text>
      {rows.map((r) => <Row key={r.href} title={tr(r.title)} body={tr(r.body)} href={r.href} danger={r.danger} />)}
      <View accessible style={{ padding: 18, borderRadius: 24, borderWidth: 2, borderColor: c.border, gap: 4 }}>
        <Text style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{tr('safety.appealsTitle')}</Text>
        <Text style={{ color: c.textMuted, fontSize: 15, lineHeight: 22, fontFamily: fontFamily('regular', rtl) }}>{tr('safety.appealsBody')}</Text>
      </View>
    </ScrollView>
  );
}

export default function SafetyCenterScreen() {
  return <TrustScreen><SafetyCenter /></TrustScreen>;
}
