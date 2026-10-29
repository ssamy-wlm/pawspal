import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import tokens from '../src/theme/tokens.json';
import { ForceNavy, lightTheme, navyTheme, ThemeProvider, useTheme, useThemeMode } from '../src/theme';
import { TrustScreen } from '../src/components/TrustScreen';

// WCAG contrast ratio between two #RRGGBB colours.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('colour contrast (WCAG AA, 4.5:1 for text)', () => {
  const pairs: [string, string][] = [
    ['text', 'background'], ['text', 'surface'], ['textMuted', 'background'], ['textMuted', 'surface'],
    ['onPrimary', 'primary'], ['onAccent', 'accent'], ['onDanger', 'danger'], ['link', 'background'],
    ['danger', 'background'], ['primary', 'background'],
  ];
  for (const [name, palette] of [['light', tokens.color.light], ['navy', tokens.color.dark]] as const) {
    it.each(pairs)(`${name}: %s on %s`, (fg, bg) => {
      const p = palette as Record<string, string>;
      expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
    });
  }
});

function Probe() {
  const t = useTheme();
  const { mode, setMode } = useThemeMode();
  return <Text testID="probe" onPress={() => setMode('navy')}>{`${t.name}|${mode}|${t.color.background}`}</Text>;
}

describe('themes', () => {
  beforeEach(async () => { await SecureStore.deleteItemAsync('pawspal.theme'); });

  it('Light and Navy differ in background and text', () => {
    expect(lightTheme.color.background).not.toBe(navyTheme.color.background);
    expect(navyTheme.color.background).toBe(tokens.color.brand.navy);
  });

  it('follows the Settings choice and remembers it', async () => {
    await render(<ThemeProvider initialMode="light"><Probe /></ThemeProvider>);
    expect(screen.getByTestId('probe').props.children).toBe(`light|light|${lightTheme.color.background}`);
    await act(async () => { screen.getByTestId('probe').props.onPress(); });
    expect(screen.getByTestId('probe').props.children).toBe(`navy|navy|${navyTheme.color.background}`);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('pawspal.theme', 'navy');
  });

  it('keeps trust screens navy even when the app is Light', async () => {
    await render(<ThemeProvider initialMode="light"><ForceNavy><Probe /></ForceNavy></ThemeProvider>);
    expect(screen.getByTestId('probe').props.children).toContain('navy|');
    expect(await themeNameWith(true)).toBe('navy');
    expect(await themeNameWith(false)).toBe('light');
  });

  it('TrustScreen paints a navy background', async () => {
    const { toJSON } = await render(<ThemeProvider initialMode="light"><TrustScreen><Probe /></TrustScreen></ThemeProvider>);
    expect(JSON.stringify(toJSON())).toContain(navyTheme.color.background);
    expect(screen.getByTestId('probe').props.children).toContain('navy|');
  });
});

// useTheme(true) is the shortcut for a single component
async function themeNameWith(force: boolean) {
  let name = '';
  function P() { name = useTheme(force).name; return null; }
  await render(<ThemeProvider initialMode="light"><P /></ThemeProvider>);
  return name;
}
