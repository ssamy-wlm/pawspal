import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Chip } from '../src/components/Chip';
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

/** Appearance (System, Light, Navy) and language (English, Arabic). Changing language restarts the app. */
export default function Settings() {
  const c = useTheme().color;
  const { mode, setMode } = useThemeMode();
  const rtl = isRTL();
  const [haptics, setHaptics] = React.useState(hapticsEnabled());
  React.useEffect(() => onHapticsChange(() => setHaptics(hapticsEnabled())), []);
  const title = (key: Key) => (
    <Text accessibilityRole="header" style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{tr(key)}</Text>
  );
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
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label={tr('settings.hapticsOn')} selected={haptics} onPress={() => { setHapticsEnabled(true).catch(() => {}); }} />
          <Chip label={tr('settings.hapticsOff')} selected={!haptics} onPress={() => { setHapticsEnabled(false).catch(() => {}); }} />
        </View>
        <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>{tr('settings.hapticsNote')}</Text>
      </View>
    </ScrollView>
  );
}
