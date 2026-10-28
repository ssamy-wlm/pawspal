import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';

describe('translations', () => {
  const enKeys = Object.keys(en).sort();
  const arKeys = Object.keys(ar).sort();

  it('has the same keys in English and Arabic', () => {
    expect(arKeys).toEqual(enKeys);
  });

  it('has no empty strings', () => {
    for (const [k, v] of [...Object.entries(en), ...Object.entries(ar)]) {
      expect(`${k}: ${String(v).trim().length > 0}`).toBe(`${k}: true`);
    }
  });

  it('uses no exclamation marks except for "Booking confirmed"', () => {
    for (const [k, v] of Object.entries(en)) {
      if (String(v).includes('!')) expect(String(v)).toMatch(/^Booking confirmed/);
      else expect(k).toBeTruthy();
    }
  });
});
