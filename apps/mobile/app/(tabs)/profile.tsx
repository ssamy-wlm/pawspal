import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { CardArt } from '../../src/components/CardArt';
import { Icon } from '../../src/components/Icon';
import { Button } from '../../src/components/Button';
import { useAuth } from '../../src/lib/auth';
import { fetchMyProfile, PublicProfile } from '../../src/lib/profile';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, Key, t as tr } from '../../src/i18n';

const LEGAL: { slug: string; label: Key }[] = [
  { slug: 'termsOfService', label: 'legal.terms' },
  { slug: 'privacyPolicy', label: 'legal.privacy' },
  { slug: 'communityGuidelines', label: 'legal.guidelines' },
];
const ROLE_LABEL: Record<PublicProfile['role'], Key> = { owner: 'profile.role.owner', sitter: 'profile.role.sitter', both: 'profile.role.both' };

/** Profile tab: your card, then Edit profile, My pets, Settings and the legal documents. */
export default function ProfileTab() {
  const { session, signOut } = useAuth();
  const userId = session?.user.id;
  const c = useTheme().color;
  const rtl = isRTL();
  const [me, setMe] = React.useState<PublicProfile | null>(null);

  useFocusEffect(React.useCallback(() => {
    if (!userId) return;
    let live = true;
    fetchMyProfile(userId).then((p) => { if (live) setMe(p); }, () => {});
    return () => { live = false; };
  }, [userId]));

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
      {me ? (
        <View accessible accessibilityLabel={[me.first_name, me.area, tr(ROLE_LABEL[me.role])].filter(Boolean).join(', ')} style={{ borderRadius: 28, overflow: 'hidden', backgroundColor: c.surface, marginBottom: 8 }}>
          <CardArt illustration={me.card_illustration} background={me.card_background} height={160} />
          <View style={{ padding: 16, gap: 2 }}>
            <Text style={{ color: c.text, fontSize: 22, fontFamily: fontFamily('extrabold', rtl) }}>{me.first_name}</Text>
            {me.area ? <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>{me.area}</Text> : null}
            <Text style={{ color: c.primary, fontSize: 14, fontFamily: fontFamily('semibold', rtl) }}>{tr(ROLE_LABEL[me.role])}</Text>
          </View>
        </View>
      ) : null}
      {row(tr('profile.edit'), '/profile/edit')}
      {row(tr('profile.pets'), '/pets')}
      {row(tr('profile.settings'), '/settings', true)}
      {row(tr('profile.safety'), '/safety')}
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 17, marginTop: 16, fontFamily: fontFamily('bold', rtl) }}>{tr('profile.legal')}</Text>
      {LEGAL.map((d) => row(tr(d.label), `/legal/${d.slug}`))}
      <View style={{ marginTop: 16 }}><Button variant="secondary" title={tr('pending.signout')} onPress={() => { signOut().catch(() => {}); }} /></View>
    </ScrollView>
  );
}
