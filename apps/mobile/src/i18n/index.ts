// Minimal i18n. Arabic copy is a DRAFT: have a native speaker review every string before launch.
import { DevSettings, I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import en from './en.json';
import ar from './ar.json';

const dict = { en, ar } as const;
export type Locale = keyof typeof dict;
export type Key = keyof typeof en;
export type Params = Record<string, string | number>;

const STORE_KEY = 'pawspal.locale';
const deviceLocale = (): Locale => (getLocales()[0]?.languageCode === 'ar' ? 'ar' : 'en');

let current: Locale = deviceLocale();

export const isRTL = () => current === 'ar';
export const locale = () => current;

/** Look up a string and fill in {placeholders}. Falls back to English, then to the key itself. */
export function t(key: Key, params?: Params): string {
  const raw = (dict[current] as Record<string, string>)[key] ?? en[key] ?? key;
  return params ? raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : raw;
}

type PluralBase = Extract<Key, `${string}_other`> extends `${infer B}_other` ? B : never;

/**
 * Plural-aware lookup. Each plural string is stored as base_zero / _one / _two / _few / _many / _other and the
 * language's own rules pick one (English has two forms, Arabic has six). {n} is filled in with the number.
 */
export function tn(base: PluralBase, n: number, params?: Params): string {
  const category = new Intl.PluralRules(current === 'ar' ? 'ar' : 'en').select(n);
  const d = dict[current] as Record<string, string>;
  const raw = d[`${base}_${category}`] ?? d[`${base}_other`] ?? (en as Record<string, string>)[`${base}_other`] ?? base;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name === 'n' ? String(n) : params && name in params ? String(params[name]) : m));
}

/** Call once at start-up, before the first screen. Loads the saved language and makes the layout direction match. */
export async function initI18n(): Promise<void> {
  try {
    const saved = await SecureStore.getItemAsync(STORE_KEY);
    current = saved === 'ar' || saved === 'en' ? saved : deviceLocale();
  } catch {
    current = deviceLocale();
  }
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== isRTL()) {
    I18nManager.forceRTL(isRTL());
    await reloadApp(); // direction only changes after a restart
  }
}

/** Switch language. English and Arabic differ in direction, so the app restarts. */
export async function switchLanguage(next: Locale): Promise<void> {
  if (next === current) return;
  current = next;
  try { await SecureStore.setItemAsync(STORE_KEY, next); } catch { /* the choice still applies until the app closes */ }
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(isRTL());
  await reloadApp();
}

async function reloadApp() {
  try {
    if (__DEV__) DevSettings.reload();
    else await Updates.reloadAsync();
  } catch { /* nothing to reload in tests */ }
}

/** Test helper: set the language without touching storage or restarting. */
export function setLocaleForTests(next: Locale) { current = next; }

// ---------------------------------------------------------------- dates and numbers
// Western digits in both languages (docs/design-system.md), but month and day names follow the language.
const tag = () => (current === 'ar' ? 'ar-u-nu-latn' : 'en');

export function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(tag(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
}

export function formatMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat(tag(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1)));
}

/** Seven short weekday names, Sunday first. */
export function weekdayNames(): string[] {
  const f = new Intl.DateTimeFormat(tag(), { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2023, 0, 1 + i)))); // 2023-01-01 is a Sunday
}
