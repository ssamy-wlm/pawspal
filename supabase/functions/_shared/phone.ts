// Egyptian mobile numbers only (+20 then 10, 11, 12 or 15, then 8 digits). Same rule as the database
// (private.is_egypt_mobile), so a number the app accepts is a number the database accepts.

export type PhoneResult = { ok: true; e164: string; digits: string } | { ok: false };

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EGYPT_MOBILE = /^20(10|11|12|15)[0-9]{8}$/;

export function normalizeEgyptPhone(input: unknown): PhoneResult {
  if (typeof input !== 'string' || input.length > 40) return { ok: false };
  let s = input.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d))).replace(/[\s().-]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  if (!/^[0-9]+$/.test(s)) return { ok: false };
  if (s.startsWith('0') && s.length === 11) s = '20' + s.slice(1);   // local form: 010 1234 5678
  if (!EGYPT_MOBILE.test(s)) return { ok: false };
  return { ok: true, e164: '+' + s, digits: s };
}
