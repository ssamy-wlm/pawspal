import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import tokens from './tokens.json';

export type ThemeMode = 'system' | 'light' | 'navy';
export type Palette = typeof tokens.color.light & Partial<typeof tokens.color.dark>;

export interface Theme {
  name: 'light' | 'navy';
  color: Palette;
  brand: typeof tokens.color.brand;
  tint: typeof tokens.color.tint;
  font: typeof tokens.font;
  radius: typeof tokens.radius;
  space: typeof tokens.space;
  motion: typeof tokens.motion;
}

const build = (name: 'light' | 'navy'): Theme => ({
  name,
  color: (name === 'navy' ? tokens.color.dark : tokens.color.light) as unknown as Palette,
  brand: tokens.color.brand,
  tint: tokens.color.tint,
  font: tokens.font,
  radius: tokens.radius,
  space: tokens.space,
  motion: tokens.motion,
});

export const lightTheme = build('light');
export const navyTheme = build('navy');

interface Ctx { theme: Theme; mode: ThemeMode; setMode: (m: ThemeMode) => void }
const ThemeContext = createContext<Ctx>({ theme: lightTheme, mode: 'system', setMode: () => {} });

export function ThemeProvider({ children, initialMode = 'system' }: { children: React.ReactNode; initialMode?: ThemeMode }) {
  const system = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const theme = useMemo(() => {
    if (mode === 'navy') return navyTheme;
    if (mode === 'light') return lightTheme;
    return system === 'dark' ? navyTheme : lightTheme;
  }, [mode, system]);
  return <ThemeContext.Provider value={{ theme, mode, setMode }}>{children}</ThemeContext.Provider>;
}

/** Current theme. Pass `forceNavy` on trust screens (verification, safety, rules, suspension). */
export function useTheme(forceNavy = false): Theme {
  const { theme } = useContext(ThemeContext);
  return forceNavy ? navyTheme : theme;
}
export const useThemeMode = () => useContext(ThemeContext);

/** Font family for the current language: Poppins for Latin, Cairo for Arabic. */
export function fontFamily(weight: 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold', rtl: boolean) {
  if (rtl) return { regular: 'Cairo_400', medium: 'Cairo_600', semibold: 'Cairo_600', bold: 'Cairo_700', extrabold: 'Cairo_700' }[weight];
  return { regular: 'Poppins_400', medium: 'Poppins_500', semibold: 'Poppins_600', bold: 'Poppins_700', extrabold: 'Poppins_800' }[weight];
}
