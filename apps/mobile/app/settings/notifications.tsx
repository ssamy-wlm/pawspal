import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { Button } from '../../src/components/Button';
import { ToggleRow } from '../../src/components/ToggleRow';
import { ErrorText } from '../../src/components/StepScreen';
import { useToast } from '../../src/components/Toast';
import { useAuth } from '../../src/lib/auth';
import {
  DEFAULT_PREFS, disableNotifications, enableNotifications, KINDS, loadPrefs, NotificationKind, NotificationPrefs,
  notificationsAvailable, notificationsOn, savePrefs,
} from '../../src/lib/notifications';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, Key, t as tr } from '../../src/i18n';

const LABEL: Record<NotificationKind, Key> = {
  messages: 'notif.messages', bookings: 'notif.bookings', membership: 'notif.membership', verification: 'notif.verification',
};

/**
 * Settings > Notifications. The master switch is the only thing that asks the phone for permission (never at first launch);
 * the four switches are what the server may send, and are saved on the server as they change.
 */
export default function NotificationSettings() {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const toast = useToast();
  const signedIn = !!useAuth().session;
  const available = notificationsAvailable();
  const [on, setOn] = React.useState(false);
  const [prefs, setPrefs] = React.useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    notificationsOn().then(setOn).catch(() => {});
    loadPrefs().then((p) => { setLoadFailed(false); setPrefs(p); }, () => setLoadFailed(true));
  }, []);
  React.useEffect(() => { if (available && signedIn) load(); }, [available, signedIn, load]);

  const flipMaster = async (next: boolean) => {
    setError(null);
    setBusy(true);
    try {
      if (next) {
        const r = await enableNotifications();
        if (r === 'on') setOn(true);
        else setError(tr(r === 'denied' ? 'notif.denied' : 'err.generic'));
      } else {
        await disableNotifications();
        setOn(false);
      }
    } finally { setBusy(false); }
  };

  const flip = async (kind: NotificationKind, next: boolean) => {
    const before = prefs;
    const updated = { ...prefs, [kind]: next };
    setPrefs(updated);
    setError(null);
    try { await savePrefs(updated); } catch { setPrefs(before); setError(tr('notif.saveFailed')); toast.show(tr('notif.saveFailed'), 'error'); }
  };

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 20 }}>
      <Stack.Screen options={{ title: tr('notif.title') }} />
      {!available ? (
        <Text style={{ color: c.textMuted, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('regular', rtl) }}>{tr('notif.web')}</Text>
      ) : (
        <>
          <ToggleRow label={tr('notif.master')} note={tr('notif.masterNote')} value={on} disabled={busy || !signedIn} onValueChange={(v) => { flipMaster(v).catch(() => {}); }} />
          <View style={{ gap: 4 }}>
            <Text accessibilityRole="header" style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{tr('notif.which')}</Text>
            {KINDS.map((k) => (
              <ToggleRow key={k} label={tr(LABEL[k])} value={prefs[k]} disabled={!on || loadFailed} onValueChange={(v) => { flip(k, v).catch(() => {}); }} />
            ))}
          </View>
          {loadFailed ? <ErrorText>{tr('notif.loadFailed')}</ErrorText> : null}
          <ErrorText>{error}</ErrorText>
          {loadFailed ? <Button variant="secondary" title={tr('notif.retry')} onPress={load} /> : null}
        </>
      )}
    </ScrollView>
  );
}
