import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesToBase64, hmacSha256 } from './crypto.ts';
import { verifyStandardWebhook } from './webhook.ts';

const keyBytes = Uint8Array.from({ length: 24 }, (_, i) => i + 1);
const secret = 'v1,whsec_' + bytesToBase64(keyBytes);
const now = 1_800_000_000;

async function signed(id: string, ts: number, body: string) {
  return 'v1,' + bytesToBase64(await hmacSha256(keyBytes, `${id}.${ts}.${body}`));
}

test('accepts a correctly signed request', async () => {
  const body = '{"user":{"phone":"201012345678"},"sms":{"otp":"123456"}}';
  assert.equal(await verifyStandardWebhook({ secret, id: 'msg_1', timestamp: String(now), signature: await signed('msg_1', now, body), body, nowSeconds: now }), true);
});

test('accepts when one of several listed signatures matches', async () => {
  const body = '{}';
  const sig = `v1,AAAA ${await signed('m', now, body)}`;
  assert.equal(await verifyStandardWebhook({ secret, id: 'm', timestamp: String(now), signature: sig, body, nowSeconds: now }), true);
});

test('refuses a changed body, a wrong secret, a missing header, and a stale or future timestamp', async () => {
  const body = '{"a":1}';
  const sig = await signed('m', now, body);
  const base = { secret, id: 'm', timestamp: String(now), signature: sig, body, nowSeconds: now };
  assert.equal(await verifyStandardWebhook({ ...base, body: '{"a":2}' }), false);
  assert.equal(await verifyStandardWebhook({ ...base, secret: 'v1,whsec_' + bytesToBase64(Uint8Array.from([9, 9, 9])) }), false);
  assert.equal(await verifyStandardWebhook({ ...base, signature: null }), false);
  assert.equal(await verifyStandardWebhook({ ...base, id: null }), false);
  assert.equal(await verifyStandardWebhook({ ...base, secret: '' }), false);
  assert.equal(await verifyStandardWebhook({ ...base, nowSeconds: now + 301 }), false);
  assert.equal(await verifyStandardWebhook({ ...base, nowSeconds: now - 301 }), false);
  assert.equal(await verifyStandardWebhook({ ...base, signature: 'v2,' + sig.slice(3) }), false);
  assert.equal(await verifyStandardWebhook({ ...base, secret: 'v1,whsec_!!!notbase64' }), false);
});
