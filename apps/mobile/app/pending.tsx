import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrustScreen } from '../src/components/TrustScreen';
import { Illustration } from '../src/components/Illustration';
import { Button } from '../src/components/Button';
import { useAuth } from '../src/lib/auth';
import { fontFamily, useTheme } from '../src/theme';
import { isRTL, t as tr } from '../src/i18n';

/** Shown to everyone who is not active yet: waiting for review, or an account that has been suspended or removed. */
export default function Pending() {
  const { state, signOut, refresh } = useAuth();
  const c = useTheme(true).color;
  const rtl = isRTL();
  const insets = useSafeAreaInsets();
  const stopped = state?.status === 'suspended' || state?.status === 'removed';
  React.useEffect(() => {
    if (stopped) return;
    const id = setInterval(() => { refresh().catch(() => {}); }, 30000);   // lets the person in soon after approval
    return () => clearInterval(id);
  }, [stopped, refresh]);
  return (
    <TrustScreen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 24 + insets.top, justifyContent: 'center', alignItems: 'center', gap: 16 }}>
        <Illustration name="pawspalIcon" width={96} />
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 28, textAlign: 'center', fontFamily: fontFamily('extrabold', rtl) }}>
          {stopped ? tr('pending.stoppedTitle') : tr('pending.title')}
        </Text>
        <Text style={{ color: c.textMuted, fontSize: 16, lineHeight: 23, textAlign: 'center', fontFamily: fontFamily('regular', rtl) }}>
          {stopped ? tr('pending.suspended') : tr('pending.body')}
        </Text>
      </ScrollView>
      <View style={{ padding: 24, paddingBottom: 24 + insets.bottom }}>
        <Button navy variant="secondary" title={tr('pending.signout')} onPress={() => { signOut().catch(() => {}); }} />
      </View>
    </TrustScreen>
  );
}
