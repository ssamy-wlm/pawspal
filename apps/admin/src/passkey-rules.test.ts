import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  browserErrorKind, canRemovePasskey, cleanCode, cleanName, codesLeftText, describeError, ERROR_TEXT, functionErrorKind, gateFor, needsNewPasskey,
  passkeyHint, PASSKEY_NAME_MAX, recoveryCodesText, signOutEverywhere, validateCode, validatePasskeyName, withStepUp,
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

test('the passkey screen offers the recovery code and the setup code ways in', () => {
  const ui = readFileSync(new URL('./passkey-ui.tsx', import.meta.url), 'utf8');
  assert.match(ui, /Use a recovery code/);
  assert.match(ui, /I have a setup code/);
  assert.match(ui, /if \(setup\) return <SetupScreen onBack=/);
});

const stepUpError = () => Object.assign(new Error('step_up_required'), { kind: 'step_up_required' });

test('step-up: a call that needs a fresh touch asks once and is retried once', async () => {
  let calls = 0; let touches = 0;
  const out = await withStepUp(async () => { calls += 1; if (calls === 1) throw stepUpError(); return 'done'; }, async () => { touches += 1; });
  assert.equal(out, 'done'); assert.equal(calls, 2); assert.equal(touches, 1);
  // a call that works the first time never asks
  let t2 = 0;
  assert.equal(await withStepUp(async () => 'fine', async () => { t2 += 1; }), 'fine');
  assert.equal(t2, 0);
});

test('step-up: cancelling stops the call, and a second refusal is never retried (no loop)', async () => {
  let calls = 0;
  await assert.rejects(withStepUp(async () => { calls += 1; throw stepUpError(); }, async () => { throw { kind: 'cancelled' }; }), (e: { kind?: string }) => e.kind === 'cancelled');
  assert.equal(calls, 1, 'the call is not retried after a cancel');
  let calls2 = 0; let touches = 0;
  await assert.rejects(withStepUp(async () => { calls2 += 1; throw stepUpError(); }, async () => { touches += 1; }), (e: { kind?: string }) => e.kind === 'step_up_required');
  assert.equal(calls2, 2); assert.equal(touches, 1);
  // other errors pass straight through without a prompt
  let touched = false;
  await assert.rejects(withStepUp(async () => { throw { kind: 'not_allowed' }; }, async () => { touched = true; }), (e: { kind?: string }) => e.kind === 'not_allowed');
  assert.equal(touched, false);
  assert.equal(functionErrorKind({ error: 'step_up_required' }), 'step_up_required');
});

test('the sensitive actions all go through the step-up wrapper, and setup-code registration does not', () => {
  const api = readFileSync(new URL('./passkey-api.ts', import.meta.url), 'utf8');
  assert.match(api, /renamePasskey = .*guarded\(/);
  assert.match(api, /removePasskey = .*guarded\(/);
  assert.match(api, /recovery_generate'\)\)\)\.codes|guarded\(\(\) => callFn<\{ codes: string\[\] \}>\('recovery_generate'\)\)/);
  assert.match(api, /setupCode \? call\(\) : guarded\(call\)/);
  const ui = readFileSync(new URL('./passkey-ui.tsx', import.meta.url), 'utf8');
  assert.match(ui, /Touch your passkey to continue/);
});
