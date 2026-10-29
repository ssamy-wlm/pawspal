import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, envFrom } from './config.ts';
import { identityProviderFromEnv } from './identity/index.ts';

const img = Uint8Array.of(1, 2, 3);

test('not configured: no provider (the function refuses instead of approving)', () => {
  assert.equal(identityProviderFromEnv(envFrom({})), null);
  assert.equal(identityProviderFromEnv(envFrom({ IDENTITY_PROVIDER: '  ' })), null);
});

test('unknown providers are refused with a clear message', () => {
  assert.throws(() => identityProviderFromEnv(envFrom({ IDENTITY_PROVIDER: 'onfido' })), /Unknown identity provider/);
});

test('fake provider: approves by default, with a stable per-user document fingerprint', async () => {
  const p = identityProviderFromEnv(envFrom({ IDENTITY_PROVIDER: 'fake' }))!;
  assert.equal(p.name, 'fake');
  assert.deepEqual(await p.checkFace({ userId: 'u1', image: img }), { ok: true });
  const a = await p.checkId({ userId: 'u1' });
  const b = await p.checkId({ userId: 'u1' });
  const c = await p.checkId({ userId: 'u2' });
  assert.equal(a.ok && a.isAdult, true);
  assert.equal(a.documentHash, b.documentHash);
  assert.notEqual(a.documentHash, c.documentHash);
  assert.match(a.documentHash!, /^[0-9a-f]{64}$/);
});

test('fake provider: test outcomes', async () => {
  const p = identityProviderFromEnv(envFrom({ IDENTITY_PROVIDER: 'fake' }))!;
  assert.equal((await p.checkFace({ userId: 'u', image: img, testOutcome: 'reject_face' })).ok, false);
  assert.equal((await p.checkFace({ userId: 'u', image: new Uint8Array() })).ok, false);
  assert.equal((await p.checkId({ userId: 'u', testOutcome: 'reject_id' })).ok, false);
  assert.equal((await p.checkId({ userId: 'u', testOutcome: 'underage' })).isAdult, false);
  assert.equal((await p.checkId({ userId: 'u1', testOutcome: 'duplicate' })).documentHash, (await p.checkId({ userId: 'u2', testOutcome: 'duplicate' })).documentHash);
});

test('fake provider: cannot be used in production unless a second switch is set', () => {
  assert.throws(() => identityProviderFromEnv(envFrom({ IDENTITY_PROVIDER: 'fake', PAWSPAL_ENV: 'production' })), ConfigError);
  assert.equal(identityProviderFromEnv(envFrom({ IDENTITY_PROVIDER: 'fake', PAWSPAL_ENV: 'production', ALLOW_FAKE_IDENTITY: 'true' }))!.name, 'fake');
});
