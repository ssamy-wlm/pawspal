import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeMode, ThemeProvider } from '../src/theme';
import { Locale, setLocaleForTests } from '../src/i18n';

/** Render something in a given app theme and language, the way a phone would. */
export async function renderIn(ui: React.ReactElement, opts: { mode?: ThemeMode; locale?: Locale } = {}) {
  setLocaleForTests(opts.locale ?? 'en');
  return render(<ThemeProvider initialMode={opts.mode ?? 'light'}>{ui}</ThemeProvider>);
}

export const THEMES: ThemeMode[] = ['light', 'navy'];
export const LOCALES: Locale[] = ['en', 'ar'];
export const COMBOS = THEMES.flatMap((mode) => LOCALES.map((locale) => ({ mode, locale })));
