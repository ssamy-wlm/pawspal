import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { ErrorText } from '../../src/components/StepScreen';
import { TrustHeader, TrustScreen } from '../../src/components/TrustScreen';
import { BlockedPerson, fetchBlocks, unblockUser } from '../../src/lib/safety';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr } from '../../src/i18n';

function Blocked() {
  const c = useTheme().color;
  const rtl = isRTL();
  const [people, setPeople] = React.useState<BlockedPerson[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { fetchBlocks().then(setPeople, () => setError(tr('safety.loadFailed'))); }, []);
  const unblock = async (id: string) => {
    setError(null);
    try { await unblockUser(id); setPeople((cur) => (cur ?? []).filter((p) => p.user_id !== id)); } catch { setError(tr('safety.failed')); }
  };
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 14 }}>
      <TrustHeader title={tr('safety.blockedTitle')} />
      <Text style={{ color: c.textMuted, fontSize: 16, lineHeight: 24, fontFamily: fontFamily('regular', rtl) }}>{tr('safety.blockedIntro')}</Text>
      <ErrorText>{error}</ErrorText>
      {people && people.length === 0 ? <Text style={{ color: c.text, fontSize: 17, fontFamily: fontFamily('medium', rtl) }}>{tr('safety.blockedNone')}</Text> : null}
      {(people ?? []).map((p) => (
        <View key={p.user_id} style={{ gap: 10, padding: 16, borderRadius: 24, backgroundColor: c.surface }}>
          <Text style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{p.first_name ?? tr('safety.someone')}</Text>
          <Button navy variant="secondary" title={tr('safety.unblock')} onPress={() => { unblock(p.user_id).catch(() => {}); }} />
        </View>
      ))}
    </ScrollView>
  );
}

export default function BlockedScreen() {
  return <TrustScreen><Blocked /></TrustScreen>;
}
