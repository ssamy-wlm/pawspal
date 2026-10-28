// Minimal i18n. Arabic copy is a DRAFT: have a native speaker review every string before launch.
import { I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';
import en from './en.json';
import ar from './ar.json';

const dict = { en, ar } as const;
export type Locale = keyof typeof dict;
export type Key = keyof typeof en;

let current: Locale = getLocales()[0]?.languageCode === 'ar' ? 'ar' : 'en';

export const isRTL = () => current === 'ar';
export const locale = () => current;
export function t(key: Key): string {
  return (dict[current] as Record<string, string>)[key] ?? en[key] ?? key;
}

/** Switch language. Changing direction (LTR <-> RTL) needs an app reload: call Updates.reloadAsync() afterwards. */
export function setLocale(next: Locale) {
  current = next;
  const rtl = next === 'ar';
  if (I18nManager.isRTL !== rtl) {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
  }
}
