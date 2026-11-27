import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { afterRecheck, createGate, looksNotAllowed, onNotAllowed, RECHECK_MS, reportNotAllowed, SESSION_RAN_OUT } from './session-watch.ts';
import { IDLE_LIMIT_MS } from './rules.ts';

test('the timings: re-check every 5 minutes, idle sign-out after 6 hours (shorter than nothing else changed)', () => {
  assert.equal(RECHECK_MS, 5 * 60 * 1000);
  assert.equal(IDLE_LIMIT_MS, 6 * 60 * 60 * 1000);
});

test('the answer of a re-check: needs_passkey shows the passkey screen, a failure or an odd answer changes nothing', () => {
  assert.equal(afterRecheck('admin'), 'stay');
  assert.equal(afterRecheck('needs_passkey'), 'passkey');
  assert.equal(afterRecheck('needs_setup'), 'setup');
  assert.equal(afterRecheck('not_admin'), 'sign_out');
  for (const odd of [null, undefined, '', 'Admin', 'needs_mfa', 42, {}]) assert.equal(afterRecheck(odd), 'stay', String(odd));
});

test('only a refusal for lack of rights starts a re-check', () => {
  assert.equal(looksNotAllowed(401), true);
  assert.equal(looksNotAllowed(403), true);
  assert.equal(looksNotAllowed(null, 'admins only'), true);
  assert.equal(looksNotAllowed(null, 'permission denied for table profiles'), true);
  for (const s of [200, 400, 404, 500, null, undefined]) assert.equal(looksNotAllowed(s as number), false, String(s));
  assert.equal(looksNotAllowed(null, 'not allowed for this status'), false);
  assert.equal(looksNotAllowed(400, 'rule and a message are required'), false);
});

test('a burst of refused requests re-checks once, and a slow check is not started twice', async () => {
  let t = 1000; let ran = 0;
  const gate = createGate(5000, () => t);
  let release!: () => void;
  const first = gate(async () => { ran += 1; await new Promise<void>((r) => { release = r; }); });
  assert.equal(await gate(async () => { ran += 1; }), false, 'still running');
  release(); assert.equal(await first, true);
  assert.equal(await gate(async () => { ran += 1; }), false, 'too soon after the last one');
  t += 5000;
  assert.equal(await gate(async () => { ran += 1; }), true);
  assert.equal(ran, 2);
  // a failing check does not block the next one
  t += 5000;
  await assert.rejects(gate(async () => { throw new Error('x'); }));
  t += 5000;
  assert.equal(await gate(async () => { ran += 1; }), true);
});

test('a listener that throws never breaks the refused request, and no listener is fine', () => {
  onNotAllowed(null); assert.doesNotThrow(reportNotAllowed);
  let calls = 0; onNotAllowed(() => { calls += 1; throw new Error('boom'); });
  assert.doesNotThrow(reportNotAllowed); assert.equal(calls, 1);
  onNotAllowed(null);
});

test('the page re-checks while signed in, keeps the person signed in on the same page, and shows no raw error', () => {
  const auth = readFileSync(new URL('./auth.tsx', import.meta.url), 'utf8');
  assert.match(auth, /window\.setInterval\(\(\) => \{ recheck\(\); \}, RECHECK_MS\)/);
  assert.match(auth, /onNotAllowed\(\(\) => \{ recheck\(\); \}\)/);
  assert.match(auth, /if \(next === 'passkey'\) \{ auto\.current\.claim\(\); setState\(\{ kind: 'passkey', ranOut: true \}\); \}/);
  assert.match(auth, /if \(!r \|\| r\.error\) return;/, 'a failed check changes nothing');
  assert.match(auth, /sign_out'\) await endSession/);
  assert.doesNotMatch(auth.slice(auth.indexOf("next === 'passkey'"), auth.indexOf("next === 'passkey'") + 120), /signOut|endSession/, 'the passkey case does not sign out');
  const data = readFileSync(new URL('./data.ts', import.meta.url), 'utf8');
  assert.match(data, /\? SESSION_RAN_OUT/);
  assert.match(SESSION_RAN_OUT, /passkey/); assert.ok(!SESSION_RAN_OUT.includes('!'));
  const sb = readFileSync(new URL('./supabase.ts', import.meta.url), 'utf8');
  assert.match(sb, /\/rest\/v1\/.*reportNotAllowed/s);
});
