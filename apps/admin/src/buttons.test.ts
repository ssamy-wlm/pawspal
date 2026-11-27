import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import tokens from './tokens.json' with { type: 'json' };

// Reads the button table out of ui.tsx (it is TSX, so it is not imported): every pair is written with theme tokens as C.x.
const ui = readFileSync(new URL('./ui.tsx', import.meta.url), 'utf8');
const C: Record<string, unknown> = { ...tokens.color.light, navy: tokens.color.brand.navy, dark: tokens.color.dark, tint: tokens.color.tint };
const resolve = (path: string): string => {
  let v: unknown = C;
  for (const part of path.split('.').slice(1)) v = (v as Record<string, unknown>)[part];
  assert.equal(typeof v, 'string', `unknown token ${path}`);
  return v as string;
};
const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const table = ui.slice(ui.indexOf('export const BUTTON_PAIRS'), ui.indexOf('/** A toggle'));
const rows = [...table.matchAll(/^\s{2}(\w+): \{ fg: ([\w.]+), bg: ([\w.']+), border: ([\w.]+), .*?on: \[([^\]]+)\] \},?$/gm)];

test('the button table is found and covers every kind', () => {
  assert.deepEqual(rows.map((r) => r[1]), ['primary', 'accent', 'secondary', 'danger', 'onDark']);
});

test('every button look uses a token pair that passes AA (4.5:1) on the surface it sits on', () => {
  for (const [, kind, fg, bg, border, on] of rows) {
    const text = resolve(fg);
    const surfaces = on.split(',').map((s) => resolve(s.trim()));
    const fill = bg === "'transparent'" ? null : resolve(bg);
    for (const surface of surfaces) {
      const behind = fill ?? surface;
      assert.ok(ratio(text, behind) >= 4.5, `${kind}: ${text} on ${behind} is ${ratio(text, behind).toFixed(2)}`);
      if (!fill) assert.ok(ratio(resolve(border), surface) >= 3, `${kind}: the outline of an outlined button is hard to see`);
    }
  }
});

test('primary and neutral buttons are brand orange with navy text, only the danger button is red', () => {
  const by = Object.fromEntries(rows.map((r) => [r[1], r]));
  for (const kind of ['primary', 'accent']) { assert.equal(by[kind][2], 'C.onAccent'); assert.equal(by[kind][3], 'C.accent'); }
  assert.equal(tokens.color.light.accent.toLowerCase(), '#ff9f43');
  assert.equal(tokens.color.light.onAccent.toLowerCase(), '#1f2d3d');
  assert.equal(by.secondary[2], 'C.text');
  assert.equal(by.danger[3], 'C.danger');
});

test('buttons are drawn only in ui.tsx, so no screen can skip the checked pairs', () => {
  const root = new URL('..', import.meta.url).pathname;
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(name) && name !== 'ui.tsx' && /<button[\s>]/.test(readFileSync(path, 'utf8'))) hits.push(path);
    }
  };
  walk(join(root, 'src')); walk(join(root, 'app'));
  assert.deepEqual(hits, [], 'use <Btn> or <Toggle> from ui.tsx');
  assert.equal((ui.match(/<button[\s>]/g) ?? []).length, 2);               // Btn and Toggle
  assert.ok(ui.includes('TOGGLE_PAIRS'));
});
