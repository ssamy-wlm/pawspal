// Generic accessibility checks that can run without a device: every pressable, image and field in the source has a role/label,
// and the main screens, drawn in both languages and both themes, have named controls, headings, and targets of at least 44.
import React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { COMBOS, renderIn } from '../test-utils/render';
import { setLocaleForTests } from '../src/i18n';
import { ToastProvider } from '../src/components/Toast';
import Welcome from '../app/index';
import Explore from '../app/(tabs)/explore';
import ProfileTab from '../app/(tabs)/profile';
import Settings from '../app/settings';
import DeleteAccount from '../app/settings/delete-account';
import NotificationSettings from '../app/settings/notifications';
import Goodbye from '../app/goodbye';

jest.mock('../src/lib/auth', () => ({ useAuth: () => ({ ready: true, session: { user: { id: 'me' } }, state: { status: 'active' }, refresh: jest.fn(), signOut: jest.fn(async () => {}) }) }));

const appDir = join(__dirname, '..', 'app');
const compDir = join(__dirname, '..', 'src', 'components');
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const sources = [...walk(appDir), ...walk(compDir)].filter((f) => f.endsWith('.tsx'));

/** The attribute text of every `<Tag ...>` opening tag in a file (braces are balanced, so `=>` and `{{ }}` are safe). */
function tags(code: string, name: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  for (const m of code.matchAll(new RegExp(`<${name}\\b`, 'g'))) {
    let i = (m.index ?? 0) + m[0].length;
    let depth = 0;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (ch === '{') depth++; else if (ch === '}') depth--; else if (ch === '>' && depth === 0 && code[i - 1] !== '=') break;
    }
    out.push({ text: code.slice(m.index, i + 1), line: code.slice(0, m.index).split('\n').length });
  }
  return out;
}

describe('every source file', () => {
  it('checks the files it should', () => { expect(sources.length).toBeGreaterThan(40); });

  it.each(sources.map((f) => [f.slice(join(__dirname, '..').length + 1), f]))('%s: pressables have a role and a label, images have alt text, fields have labels', (_name, file) => {
    const code = readFileSync(file, 'utf8');
    const problems: string[] = [];
    for (const t of tags(code, 'Pressable')) {
      if (!/accessibilityRole=/.test(t.text)) problems.push(`line ${t.line}: Pressable without accessibilityRole`);
      // Chip takes its name from its visible text (a second label would double up in lists that also label the same thing).
      if (!/accessibilityLabel=/.test(t.text) && !/\.\.\.(props|rest)/.test(t.text) && !file.endsWith('Chip.tsx')) problems.push(`line ${t.line}: Pressable without accessibilityLabel`);
    }
    for (const t of [...tags(code, 'Image'), ...tags(code, 'Animated.Image')]) {
      if (!/\balt=|accessibilityLabel=|accessible=\{false\}/.test(t.text)) problems.push(`line ${t.line}: Image without alt text`);
    }
    for (const t of tags(code, 'TextInput')) {
      if (!/accessibilityLabel=/.test(t.text)) problems.push(`line ${t.line}: TextInput without accessibilityLabel`);
    }
    for (const t of file.endsWith('ToggleRow.tsx') ? [] : tags(code, 'Switch')) {
      problems.push(`line ${t.line}: a bare Switch (use ToggleRow, which is one labelled 56 pt target)`);
    }
    expect(problems).toEqual([]);
  });

  it('never uses left/right for layout that must mirror (use start/end)', () => {
    const bad: string[] = [];
    for (const f of sources) {
      const code = readFileSync(f, 'utf8');
      for (const m of code.matchAll(/\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeftWidth|borderRightWidth|textAlign:\s*'(?:left|right)')/g)) bad.push(`${f}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it('only turns off text scaling for the two big symbols on the swipe buttons', () => {
    const users = sources.filter((f) => /allowFontScaling=\{false\}/.test(readFileSync(f, 'utf8'))).map((f) => f.split('/').pop());
    expect(users).toEqual(['SwipeButtons.tsx']);
  });
});

const CONTROL_ROLES = ['button', 'link', 'switch', 'checkbox', 'radio', 'tab'] as const;
const sizeOf = (el: { props: { style?: unknown }; children?: unknown[] }): { w?: number; h?: number } => {
  const s = StyleSheet.flatten(el.props.style as never) as Record<string, unknown> | undefined;
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  return { w: num(s?.minWidth) ?? num(s?.width), h: num(s?.minHeight) ?? num(s?.height) };
};
/** The smallest height the control is known to have: its own style, or the first styled thing inside it. */
function knownHeight(el: { props: { style?: unknown }; children?: unknown[] }): number | undefined {
  const own = sizeOf(el).h;
  if (own !== undefined) return own;
  for (const child of el.children ?? []) {
    if (child && typeof child === 'object' && 'props' in (child as object)) {
      const h = knownHeight(child as never);
      if (h !== undefined) return h;
    }
  }
  return undefined;
}

describe.each(COMBOS)('main screens in $mode / $locale', ({ mode, locale }) => {
  afterEach(() => setLocaleForTests('en'));
  const r = (ui: React.ReactElement) => renderIn(<GestureHandlerRootView style={{ flex: 1 }}><ToastProvider>{ui}</ToastProvider></GestureHandlerRootView>, { mode, locale });
  const screens: [string, React.ReactElement][] = [
    ['Welcome', <Welcome key="w" />], ['Explore', <Explore key="e" />], ['Profile', <ProfileTab key="p" />], ['Settings', <Settings key="s" />],
    ['Delete account', <DeleteAccount key="d" />], ['Notifications', <NotificationSettings key="n" />], ['Goodbye', <Goodbye key="g" />],
  ];

  it.each(screens)('%s: every control has a name and a 44 pt target, and there is a heading', async (_name, ui) => {
    await r(ui);
    const problems: string[] = [];
    for (const role of CONTROL_ROLES) {
      for (const el of screen.queryAllByRole(role)) {
        const label = el.props.accessibilityLabel ?? within(el).queryAllByText(/\S/).map((t) => String(t.props.children)).join(' ');
        if (!String(label).trim()) problems.push(`${role} without a name`);
        const h = knownHeight(el as never);
        if (h !== undefined && h < 44) problems.push(`${role} "${String(label).slice(0, 30)}" is ${h} high`);
      }
    }
    expect(problems).toEqual([]);
    expect(screen.queryAllByRole('header').length).toBeGreaterThan(0);
  });
});
