import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEgyptPhone } from './phone.ts';

test('accepts Egyptian mobile numbers however they are written', () => {
  for (const input of ['+201012345678', '01012345678', '010 1234 5678', '+20 10 1234 5678', '00201012345678', '201012345678', '(010) 1234-5678', '٠١٠١٢٣٤٥٦٧٨']) {
    assert.deepEqual(normalizeEgyptPhone(input), { ok: true, e164: '+201012345678', digits: '201012345678' }, input);
  }
});

test('accepts the four mobile prefixes: 10, 11, 12, 15', () => {
  for (const p of ['10', '11', '12', '15']) assert.equal(normalizeEgyptPhone(`+20${p}12345678`).ok, true, p);
});

test('refuses everything else', () => {
  for (const input of ['+14155550123', '+201312345678', '+20101234567', '+2010123456789', '0101234567', '', 'abc', '+20 2 3456 7890', '0225750000', null, undefined, 12345, 'x'.repeat(100)]) {
    assert.equal(normalizeEgyptPhone(input).ok, false, String(input));
  }
});
