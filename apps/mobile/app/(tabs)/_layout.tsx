import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MembershipBanner, bannerText } from '../../src/components/MembershipBanner';
import { useAuth } from '../../src/lib/auth';
import { Icon, IconName } from '../../src/components/Icon';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, Key, t as tr } from '../../src/i18n';

const TABS: { name: string; title: Key; icon: IconName }[] = [
  { name: 'explore', title: 'tab.explore', icon: 'explore' },
  { name: 'calendar', title: 'tab.calendar', icon: 'calendar' },
  { name: 'chat', title: 'tab.chat', icon: 'chat' },
  { name: 'profile', title: 'tab.profile', icon: 'profile' },
];

/** The four main tabs, with a renewal banner on top when the membership is due soon or paused. Order follows the layout direction, so Arabic reads right to left. */
export default function TabsLayout() {
  const t = useTheme();
  const c = t.color;
  const { state } = useAuth();
  const insets = useSafeAreaInsets();
  const banner = bannerText(state?.membership) !== null;
  const tabs = (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: c.background },
      headerTintColor: c.text,
      headerTitleStyle: { fontFamily: fontFamily('semibold', isRTL()) },
      headerShadowVisible: false,
      tabBarActiveTintColor: c.primary,
      tabBarInactiveTintColor: c.textMuted,
      tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, minHeight: 64 },
      tabBarLabelStyle: { fontFamily: fontFamily('medium', isRTL()), fontSize: 12 },
      tabBarItemStyle: { minHeight: 48 },
    }}>
      {TABS.map(({ name, title, icon }) => (
        <Tabs.Screen key={name} name={name} options={{
          title: tr(title),
          tabBarAccessibilityLabel: tr(title),
          tabBarIcon: ({ color }) => <Icon name={icon} color={String(color)} />,
        }} />
      ))}
    </Tabs>
  );
  // With the banner showing, it takes the top safe area and the tab headers below it do not add it again.
  return (
    <View style={{ flex: 1, paddingTop: banner ? insets.top : 0, backgroundColor: c.background }}>
      <MembershipBanner />
      <SafeAreaInsetsContext.Provider value={banner ? { ...insets, top: 0 } : insets}>{tabs}</SafeAreaInsetsContext.Provider>
    </View>
  );
}
