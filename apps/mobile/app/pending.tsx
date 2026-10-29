import React from 'react';
import { Text, View } from 'react-native';
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
  const stopped = state?.status === 'suspended' || state?.status === 'removed';
  React.useEffect(() => {
    if (stopped) return;
    const id = setInterval(() => { refresh().catch(() => {}); }, 30000);   // lets the person in soon after approval
    return () => clearInterval(id);
  }, [stopped, refresh]);
  return (
    <TrustScreen>
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center', gap: 16 }}>
        <Illustration name="pawspalIcon" width={96} />
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 28, textAlign: 'center', fontFamily: fontFamily('extrabold', rtl) }}>
          {stopped ? tr('pending.stoppedTitle') : tr('pending.title')}
        </Text>
        <Text style={{ color: c.textMuted, fontSize: 16, lineHeight: 23, textAlign: 'center', fontFamily: fontFamily('regular', rtl) }}>
          {stopped ? tr('pending.suspended') : tr('pending.body')}
        </Text>
      </View>
      <View style={{ padding: 24 }}>
        <Button navy variant="secondary" title={tr('pending.signout')} onPress={() => { signOut().catch(() => {}); }} />
      </View>
    </TrustScreen>
  );
}
