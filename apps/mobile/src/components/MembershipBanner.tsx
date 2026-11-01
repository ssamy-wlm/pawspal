import React from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/membership';
import { fontFamily, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';

/** True when the banner should show: a renewal is due within a week, or the membership is paused. */
export const bannerText = (m: { state: string; paid_until: string | null } | undefined | null): string | null =>
  m?.state === 'due_soon' ? tr('membership.banner.dueSoon', { date: formatDate(m.paid_until) })
    : m?.state === 'paused' ? tr('membership.banner.paused') : null;

/** The strip at the top of the tabs that sends people to renew. */
export function MembershipBanner() {
  const { state } = useAuth();
  const t = useTheme();
  const text = bannerText(state?.membership);
  if (!text) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={text} onPress={() => router.push('/membership')}
      style={{ minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center', backgroundColor: t.tint.orange }}>
      <Text style={{ color: t.brand.navy, fontSize: 14, lineHeight: 20, fontFamily: fontFamily('semibold', isRTL()) }}>{text}</Text>
    </Pressable>
  );
}
