import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';
import { formatDay, formatMonth, isRTL, setLocaleForTests, t, tn, weekdayNames } from '../src/i18n';

describe('translations', () => {
  const enKeys = Object.keys(en).sort();
  const arKeys = Object.keys(ar).sort();

  // Plural strings are stored as base_one / base_other (English) and base_zero ... base_other (Arabic).
  const PLURAL = /_(zero|one|two|few|many|other)$/;
  const shape = (keys: string[]) => [...new Set(keys.map((k) => k.replace(PLURAL, '')))].sort();

  it('has the same keys in English and Arabic', () => {
    expect(shape(arKeys)).toEqual(shape(enKeys));
  });

  it('gives every plural string an "other" form in both languages', () => {
    for (const base of shape(enKeys.filter((k) => PLURAL.test(k)))) {
      expect([base, enKeys.includes(`${base}_other`), arKeys.includes(`${base}_other`)]).toEqual([base, true, true]);
    }
  });

  it('has no empty strings', () => {
    for (const [k, v] of [...Object.entries(en), ...Object.entries(ar)]) {
      expect(`${k}: ${String(v).trim().length > 0}`).toBe(`${k}: true`);
    }
  });

  it('uses the same {placeholders} in both languages', () => {
    const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of enKeys.filter((x) => !PLURAL.test(x))) expect([k, names((ar as Record<string, string>)[k])]).toEqual([k, names((en as Record<string, string>)[k])]);
  });

  it('uses no exclamation marks except for "Booking confirmed"', () => {
    for (const v of [...Object.values(en), ...Object.values(ar)]) {
      if (v.includes('!') || v.includes('！')) expect(v).toMatch(/Booking confirmed|تم تأكيد الحجز/);
    }
  });

  it('writes Arabic as Arabic (not copied English), except language names and brand names', () => {
    const same = enKeys.filter((k) => (en as Record<string, string>)[k] === (ar as Record<string, string>)[k]);
    // Allowed to match: each language name is written in its own language; card.rating is only numbers and a separator.
    expect(same.sort()).toEqual(['card.rating', 'lang.ar', 'lang.en']);
  });
});

describe('t()', () => {
  afterEach(() => setLocaleForTests('en'));

  it('fills in placeholders in both languages', () => {
    expect(t('step.of', { n: 2, total: 6 })).toBe('Step 2 of 6');
    setLocaleForTests('ar');
    expect(t('step.of', { n: 2, total: 6 })).toBe('الخطوة 2 من 6');
  });

  it('keeps an unknown placeholder visible instead of crashing', () => {
    expect(t('step.of', { n: 1 })).toBe('Step 1 of {total}');
  });

  it('tells the layout to mirror for Arabic only', () => {
    expect(isRTL()).toBe(false);
    setLocaleForTests('ar');
    expect(isRTL()).toBe(true);
  });
});

describe('plurals', () => {
  afterEach(() => setLocaleForTests('en'));

  it('English: one and many', () => {
    expect(tn('count.night', 1)).toBe('1 night');
    expect(tn('count.night', 5)).toBe('5 nights');
    expect(tn('count.stay', 0)).toBe('0 stays');
    expect(tn('count.exactMatch', 1)).toBe('1 exact match');
    expect(tn('count.closeMatch', 2)).toBe('2 close matches');
  });

  it('Arabic: all six forms', () => {
    setLocaleForTests('ar');
    expect(tn('count.night', 0)).toBe('0 ليلة');
    expect(tn('count.night', 1)).toBe('ليلة واحدة');
    expect(tn('count.night', 2)).toBe('ليلتان');
    expect(tn('count.night', 3)).toBe('3 ليالٍ');
    expect(tn('count.night', 11)).toBe('11 ليلة');
    expect(tn('count.night', 100)).toBe('100 ليلة');
  });
});

describe('dates', () => {
  afterEach(() => setLocaleForTests('en'));

  it('keeps Western digits in Arabic, with Arabic month and day names', () => {
    setLocaleForTests('ar');
    expect(formatDay('2026-11-02')).toMatch(/2/);
    expect(formatDay('2026-11-02')).not.toMatch(/[٠-٩]/);
    expect(formatMonth(2026, 10)).not.toMatch(/[٠-٩]/);
    expect(formatMonth(2026, 10)).toMatch(/[؀-ۿ]/);
    expect(weekdayNames()).toHaveLength(7);
    expect(weekdayNames().every((d) => /[؀-ۿ]/.test(d))).toBe(true);
  });

  it('lists Sunday first', () => {
    expect(weekdayNames()[0]).toMatch(/^Sun/);
  });
});
