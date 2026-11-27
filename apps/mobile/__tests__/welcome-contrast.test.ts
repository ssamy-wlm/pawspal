import tokens from '../src/theme/tokens.json';

// The welcome screen's two buttons, in both themes. "Create account" is the light theme's deep teal with white text in
// both; "Sign in" is the theme's own card with its own text colours.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const light = tokens.color.light;
const dark = tokens.color.dark;

describe('welcome screen colours pass AA', () => {
  test('Create account: white on the deep teal, both themes (title 18 px bold, subtitle 14 px)', () => {
    expect(light.primary).toBe('#167E7E');
    expect(light.onPrimary).toBe('#FFFFFF');
    expect(contrast(light.onPrimary, light.primary)).toBeGreaterThanOrEqual(4.5);
  });
  test.each([['light', light], ['dark', dark]] as const)('Sign in card text and arrow in %s', (_n, p) => {
    expect(contrast(p.text, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.textMuted, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.link, p.surface)).toBeGreaterThanOrEqual(4.5);
  });
  test('tagline and legal links on the page background, both themes', () => {
    for (const p of [light, dark]) {
      expect(contrast(p.textMuted, p.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.link, p.background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
