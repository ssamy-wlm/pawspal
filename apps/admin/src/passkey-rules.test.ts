import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  browserErrorKind, canRemovePasskey, cleanCode, cleanName, codesLeftText, describeError, ERROR_TEXT, functionErrorKind, gateFor, needsNewPasskey,
  passkeyHint, PASSKEY_NAME_MAX, recoveryCodesText, signOutEverywhere, validateCode, validatePasskeyName,
} from './passkey-rules.ts';

test('the database answer decides the screen, and anything unknown never reaches the site', () => {
  assert.equal(gateFor('admin'), 'show');
  assert.equal(gateFor('needs_passkey'), 'passkey');
  assert.equal(gateFor('needs_setup'), 'setup');
  assert.equal(gateFor('not_admin'), 'deny');
  for (const odd of [null, undefined, '', 'Admin', 'needs_mfa', 'needs_code', 42, {}, true]) assert.equal(gateFor(odd), 'error', String(odd));
  assert.notEqual(gateFor(null), 'show');
});

test('recovery and setup codes lose their spaces and nothing else', () => {
  assert.equal(cleanCode(' ab12 cd34\n'), 'ab12cd34');
  assert.equal(cleanCode('AB-12'), 'AB-12');
  assert.match(validateCode('   ', 'recovery')!, /recovery code/);
  assert.match(validateCode('', 'setup')!, /setup code/);
  assert.equal(validateCode('abcd 1234', 'recovery'), null);
  assert.match(validateCode('x'.repeat(65), 'setup')!, /too long/);
});

test('the recovery codes file lists every code once, numbered', () => {
  const codes = Array.from({ length: 10 }, (_, i) => `code-${i}`);
  const text = recoveryCodesText(codes, new Date('2026-11-27T10:00:00Z'));
  assert.match(text, /Made on 2026-11-27/);
  assert.match(text, /Each code works once/);
  codes.forEach((c, i) => assert.ok(text.includes(`${String(i + 1).padStart(2, ' ')}. ${c}`)));
  assert.equal(text.split('code-3').length - 1, 1);
});

test('passkey names are short, plain and not empty', () => {
  assert.equal(validatePasskeyName('My iPhone'), null);
  assert.equal(validatePasskeyName('  This   device '), null);
  assert.equal(cleanName('  This   device '), 'This device');
  assert.match(validatePasskeyName('   ')!, /name/);
  assert.match(validatePasskeyName('x'.repeat(PASSKEY_NAME_MAX + 1))!, /40/);
  assert.equal(validatePasskeyName('x'.repeat(PASSKEY_NAME_MAX)), null);
  assert.match(validatePasskeyName('<script>')!, /simple/);
  assert.match(validatePasskeyName('a\u0007b')!, /simple/);
});

test('every error becomes one calm sentence, with no detail and no exclamation mark', () => {
  assert.equal(functionErrorKind({ error: 'not_allowed' }), 'not_allowed');
  assert.equal(functionErrorKind({ error: 'too_many_attempts' }), 'too_many_attempts');
  assert.equal(functionErrorKind({ error: 'not_configured' }), 'not_configured');
  assert.equal(functionErrorKind({ error: 'invalid_request' }), 'invalid_request');
  assert.equal(functionErrorKind({ error: 'select * from secrets' }), 'try_again_later');
  assert.equal(functionErrorKind(null), 'try_again_later');
  assert.equal(functionErrorKind('boom'), 'try_again_later');
  assert.equal(browserErrorKind({ name: 'NotAllowedError' }), 'cancelled');
  assert.equal(browserErrorKind({ name: 'AbortError' }), 'cancelled');
  assert.equal(browserErrorKind({ name: 'InvalidStateError' }), 'already_registered');
  assert.equal(browserErrorKind({ name: 'WebAuthnError', code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' }), 'already_registered');
  assert.equal(browserErrorKind({ name: 'NotSupportedError' }), 'unsupported');
  assert.equal(browserErrorKind(new Error('secret detail')), 'try_again_later');
  assert.equal(browserErrorKind(null), 'try_again_later');
  assert.equal(describeError({ kind: 'cancelled' }), ERROR_TEXT.cancelled);
  assert.equal(describeError(new Error('secret detail')), ERROR_TEXT.try_again_later);
  for (const text of Object.values(ERROR_TEXT)) { assert.ok(!text.includes('!')); assert.ok(text.length < 140); }
});

test('the passkey list: hints, the last passkey stays, the recovery banner', () => {
  assert.match(passkeyHint({ device_type: 'multiDevice', backed_up: true }), /Synced/);
  assert.match(passkeyHint({ device_type: 'singleDevice', backed_up: false }), /one device/);
  assert.equal(canRemovePasskey(1), false);
  assert.equal(canRemovePasskey(2), true);
  assert.equal(needsNewPasskey('recovery', false), true);
  assert.equal(needsNewPasskey('recovery', true), false);
  assert.equal(needsNewPasskey('passkey', false), false);
  assert.equal(needsNewPasskey(null, false), false);
  assert.equal(codesLeftText(0), 'You have no recovery codes left. Make new ones.');
  assert.equal(codesLeftText(1), 'You have 1 recovery code left.');
  assert.equal(codesLeftText(7), 'You have 7 recovery codes left.');
});

test('signing out (also when idle) calls sign_out first, then Supabase Auth, and always finishes', async () => {
  const calls: string[] = [];
  await signOutEverywhere(async () => { calls.push('sign_out'); }, async () => { calls.push('auth'); });
  assert.deepEqual(calls, ['sign_out', 'auth']);
  const after: string[] = [];
  await signOutEverywhere(async () => { throw new Error('offline'); }, async () => { after.push('auth'); });
  assert.deepEqual(after, ['auth']);
  await signOutEverywhere(async () => { throw new Error('a'); }, async () => { throw new Error('b'); });
});

test('the idle timer and the sign-out button both go through endSession (so the function is called)', () => {
  const auth = readFileSync(new URL('./auth.tsx', import.meta.url), 'utf8');
  assert.match(auth, /endSession = \(\) => signOutEverywhere\(endPasskeySession,/);
  assert.match(auth, /isIdle\(last, Date\.now\(\), IDLE_LIMIT_MS\)\) \{ endSession\(\)/);
  assert.match(auth, /async signOut\(\) \{ await endSession\(\)/);
  const api = readFileSync(new URL('./passkey-api.ts', import.meta.url), 'utf8');
  assert.match(api, /endPasskeySession = \(\) => callFn\('sign_out'\)/);
});

test('no authenticator-app, totp or mfa wording is left in the site code', () => {
  const root = new URL('..', import.meta.url).pathname;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|mjs)$/.test(name) && !name.endsWith('.test.ts') && name !== 'passkey-browser-check.mjs') files.push(path);
    }
  };
  walk(join(root, 'src')); walk(join(root, 'app')); files.push(join(root, 'next.config.mjs'));
  assert.ok(files.length > 10);
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /totp|mfa|authenticator|aal2|aal1/i, f);
});
