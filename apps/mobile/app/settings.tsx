import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../src/components/Button';
import { Chip } from '../src/components/Chip';
import { InstallPrompt } from '../src/components/InstallPrompt';
import { useToast } from '../src/components/Toast';
import { ApiError, errorKey, exportMyData } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { saveExport } from '../src/lib/exportFile';
import { notificationsAvailable } from '../src/lib/notifications';
import { exportFileName, exportJson } from '../src/lib/privacy';
import { hapticsEnabled, onHapticsChange, setHapticsEnabled } from '../src/lib/haptics';
import { fontFamily, ThemeMode, useTheme, useThemeMode } from '../src/theme';
import { isRTL, Key, locale, Locale, switchLanguage, t as tr } from '../src/i18n';

const THEMES: { mode: ThemeMode; label: Key }[] = [
  { mode: 'system', label: 'theme.system' },
  { mode: 'light', label: 'theme.light' },
  { mode: 'navy', label: 'theme.navy' },
];
const LANGS: { code: Locale; label: Key }[] = [
  { code: 'en', label: 'lang.en' },
  { code: 'ar', label: 'lang.ar' },
];

/** Appearance (System, Light, Navy), language (English, Arabic), vibration, and the account: membership and sign out. Changing language restarts the app. */
export default function Settings() {
  const c = useTheme().color;
  const { session, signOut } = useAuth();
  const { mode, setMode } = useThemeMode();
  const rtl = isRTL();
  const toast = useToast();
  const [exporting, setExporting] = React.useState(false);
  const [haptics, setHaptics] = React.useState(hapticsEnabled());
  React.useEffect(() => onHapticsChange(() => setHaptics(hapticsEnabled())), []);
  const title = (key: Key) => (
    <Text accessibilityRole="header" style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{tr(key)}</Text>
  );
  const download = async () => {
    setExporting(true);
    try {
      const r = await exportMyData();
      const shared = await saveExport(exportFileName(r.exported_at), exportJson(r));
      toast.show(tr(shared ? 'privacy.downloaded' : 'privacy.shareUnavailable'), shared ? 'success' : 'error');
    } catch (e) {
      toast.show(tr(e instanceof ApiError && e.code === 'too_many_attempts' ? 'privacy.exportLimit' : errorKey(e)), 'error');
    } finally { setExporting(false); }
  };
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 28 }}>
      <View style={{ gap: 12 }}>
        {title('settings.theme')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {THEMES.map((o) => <Chip key={o.mode} label={tr(o.label)} selected={mode === o.mode} onPress={() => setMode(o.mode)} />)}
        </View>
      </View>
      <View style={{ gap: 12 }}>
        {title('settings.language')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {LANGS.map((o) => <Chip key={o.code} label={tr(o.label)} selected={locale() === o.code} onPress={() => { switchLanguage(o.code); }} />)}
        </View>
        <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>{tr('settings.languageNote')}</Text>
      </View>
      <View style={{ gap: 12 }}>
        {title('settings.haptics')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label={tr('settings.hapticsOn')} selected={haptics} onPress={() => { setHapticsEnabled(true).catch(() => {}); }} />
          <Chip label={tr('settings.hapticsOff')} selected={!haptics} onPress={() => { setHapticsEnabled(false).catch(() => {}); }} />
        </View>
        <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>{tr('settings.hapticsNote')}</Text>
      </View>
      <InstallPrompt variant="settings" />
      {session ? (
        <View style={{ gap: 12 }}>
          {title('settings.account')}
          <Button variant="secondary" title={tr('profile.membership')} onPress={() => router.push('/membership')} />
          {notificationsAvailable() ? <Button variant="secondary" title={tr('settings.notifications')} onPress={() => router.push('/settings/notifications')} /> : null}
          <Button variant="secondary" title={tr('pending.signout')} onPress={() => { signOut().catch(() => {}); }} />
        </View>
      ) : null}
      {session ? (
        <View style={{ gap: 12 }}>
          {title('settings.privacy')}
          <Text style={{ color: c.textMuted, fontSize: 14, lineHeight: 20, fontFamily: fontFamily('regular', rtl) }}>{tr('privacy.downloadNote')}</Text>
          <Button variant="secondary" title={tr(exporting ? 'privacy.downloading' : 'privacy.download')} disabled={exporting} onPress={() => { download().catch(() => {}); }} />
          <Button variant="danger" title={tr('privacy.delete')} onPress={() => router.push('/settings/delete-account')} />
        </View>
      ) : null}
    </ScrollView>
  );
}
