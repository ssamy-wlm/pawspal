import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesToBase64, hmacSha256, sha256Hex } from './crypto.ts';
import { envFrom } from './config.ts';
import type { Rpc } from './http.ts';
import { handleProcessUpload, type StorageOps } from './handlers/process-upload.ts';
import { handleRequestOtp } from './handlers/request-otp.ts';
import { handleSendSms } from './handlers/send-sms.ts';
import { handleVerifyIdentity } from './handlers/verify-identity.ts';
import { handleVerifyOtp } from './handlers/verify-otp.ts';
import { has, enc, photo, png } from './test-images.ts';

// ---------------------------------------------------------------- fakes
const ALLOW = { allowed: true, reason: null, retry_after_seconds: 0, captcha_required: false };
type RpcCall = { name: string; args: Record<string, unknown> };

function fakeRpc(handlers: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const calls: RpcCall[] = [];
  const rpc: Rpc = async (name, args) => {
    calls.push({ name, args });
    const h = handlers[name];
    if (!h) return { data: name === 'is_phone_banned' ? false : ALLOW, error: null };
    const out = h(args);
    return out instanceof Error ? { data: null, error: { message: out.message } } : { data: out, error: null };
  };
  return { rpc, calls };
}

function fakeFetch(routes: Record<string, (init: RequestInit) => Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const hit = Object.keys(routes).find((k) => url.includes(k));
    return hit ? routes[hit](init) : new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://f.test/x', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

// Nothing in any function may print: codes and numbers must never reach the logs.
const logged: string[] = [];
for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  (console as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { logged.push(a.join(' ')); };
}
test.afterEach(() => { assert.deepEqual(logged.splice(0), [], 'a function printed to the log'); });

const CODE = '482913';
const PHONE = '+201012345678';
const DEVICE = 'device-abcdef-123456';

// ---------------------------------------------------------------- send-sms hook
const keyBytes = Uint8Array.from({ length: 24 }, (_, i) => i + 7);
const SECRET = 'v1,whsec_' + bytesToBase64(keyBytes);
const NOW = 1_800_000_000;
async function hookRequest(payload: unknown, opts: { secretKey?: Uint8Array; ts?: number } = {}) {
  const body = JSON.stringify(payload);
  const ts = opts.ts ?? NOW;
  const sig = 'v1,' + bytesToBase64(await hmacSha256(opts.secretKey ?? keyBytes, `msg_1.${ts}.${body}`));
  return new Request('https://f.test/send-sms', { method: 'POST', headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': sig }, body });
}
const hookEnv = (extra: Record<string, string> = {}) => envFrom({ SEND_SMS_HOOK_SECRET: SECRET, SMS_PROVIDERS: 'generic-http', SMS_HTTP_URL: 'https://sms.example.eg/send', ...extra });
const hookPayload = { user: { id: 'u1', phone: '201012345678' }, sms: { otp: CODE } };

test('send-sms: sends the code through the chosen provider and logs the send', async () => {
  const { fetchFn, calls } = fakeFetch({ 'sms.example.eg': () => jsonRes(200, {}) });
  const { rpc, calls: rc } = fakeRpc();
  const res = await handleSendSms(await hookRequest(hookPayload), { env: hookEnv(), fetch: fetchFn, rpc, nowSeconds: () => NOW });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].init.body as string);
  assert.equal(sent.to, PHONE);
  assert.match(sent.message, new RegExp(CODE));
  assert.equal(rc[0].name, 'otp_check_and_log');
  assert.equal(rc[0].args.p_mode, 'send');
  assert.equal(rc[0].args.p_phone_hash, await sha256Hex('201012345678'));
  assert.ok(!JSON.stringify(rc).includes('201012345678'), 'only the hash goes to the database');
});

test('send-sms: refuses calls that are not from Supabase', async () => {
  const deps = () => ({ env: hookEnv(), fetch: fakeFetch({}).fetchFn, rpc: fakeRpc().rpc, nowSeconds: () => NOW });
  assert.equal((await handleSendSms(await hookRequest(hookPayload, { secretKey: Uint8Array.of(1, 2, 3) }), deps())).status, 401);
  assert.equal((await handleSendSms(await hookRequest(hookPayload, { ts: NOW - 1000 }), deps())).status, 401);
  assert.equal((await handleSendSms(post(hookPayload), deps())).status, 401);
  assert.equal((await handleSendSms(await hookRequest(hookPayload), { ...deps(), env: hookEnv({ SEND_SMS_HOOK_SECRET: '' }) })).status, 401);
  assert.equal((await handleSendSms(new Request('https://f.test/', { method: 'GET' }), deps())).status, 405);
  assert.equal((await handleSendSms(post(''), deps())).status, 400);
});

test('send-sms: only Egyptian numbers and well-formed codes', async () => {
  const deps = { env: hookEnv(), fetch: fakeFetch({}).fetchFn, rpc: fakeRpc().rpc, nowSeconds: () => NOW };
  assert.equal((await handleSendSms(await hookRequest({ user: { phone: '14155550123' }, sms: { otp: CODE } }), deps)).status, 400);
  assert.equal((await handleSendSms(await hookRequest({ user: { phone: '201012345678' }, sms: { otp: 'abcdef' } }), deps)).status, 400);
  assert.equal((await handleSendSms(await hookRequest({ user: { phone: '201012345678' } }), deps)).status, 400);
});

test('send-sms: no provider configured means no code is sent (and it says so honestly)', async () => {
  const { fetchFn, calls } = fakeFetch({});
  const res = await handleSendSms(await hookRequest(hookPayload), { env: envFrom({ SEND_SMS_HOOK_SECRET: SECRET }), fetch: fetchFn, rpc: fakeRpc().rpc, nowSeconds: () => NOW });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
  const broken = await handleSendSms(await hookRequest(hookPayload), { env: hookEnv({ SMS_PROVIDERS: 'twilio' }), fetch: fetchFn, rpc: fakeRpc().rpc, nowSeconds: () => NOW });
  assert.equal(broken.status, 503);
});

test('send-sms: the per-number limit stops the send before any provider is called', async () => {
  const { fetchFn, calls } = fakeFetch({});
  const { rpc } = fakeRpc({ otp_check_and_log: () => ({ allowed: false, reason: 'phone_limit', retry_after_seconds: 1800, captcha_required: false }) });
  const res = await handleSendSms(await hookRequest(hookPayload), { env: hookEnv(), fetch: fetchFn, rpc, nowSeconds: () => NOW });
  assert.equal(res.status, 429);
  assert.equal(calls.length, 0);
  const text = await res.text();
  assert.doesNotMatch(text, new RegExp(`${CODE}|201012345678`));
  const { rpc: broken } = fakeRpc({ otp_check_and_log: () => new Error('db down') });
  assert.equal((await handleSendSms(await hookRequest(hookPayload), { env: hookEnv(), fetch: fetchFn, rpc: broken, nowSeconds: () => NOW })).status, 503);
});

test('send-sms: falls back to the second provider, and reports a failure without leaking anything', async () => {
  const both = hookEnv({ SMS_PROVIDERS: 'whatsapp-cloud,generic-http', WHATSAPP_PHONE_NUMBER_ID: '111', WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_TEMPLATE_NAME: 'otp' });
  const { fetchFn, calls } = fakeFetch({ 'graph.facebook.com': () => jsonRes(500, { error: 'boom' }), 'sms.example.eg': () => jsonRes(200, {}) });
  const ok = await handleSendSms(await hookRequest(hookPayload), { env: both, fetch: fetchFn, rpc: fakeRpc().rpc, nowSeconds: () => NOW });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls.map((c) => new URL(c.url).hostname), ['graph.facebook.com', 'sms.example.eg']);
  const down = fakeFetch({ 'sms.example.eg': () => jsonRes(503, {}) });
  const res = await handleSendSms(await hookRequest(hookPayload), { env: hookEnv(), fetch: down.fetchFn, rpc: fakeRpc().rpc, nowSeconds: () => NOW });
  assert.equal(res.status, 502);
  assert.doesNotMatch(await res.text(), new RegExp(`${CODE}|201012345678`));
});

// ---------------------------------------------------------------- request-otp
const otpEnv = (extra: Record<string, string> = {}) => envFrom({ SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon-key', ...extra });

test('request-otp: asks Supabase Auth to send a code and tells the app when it can ask again', async () => {
  const { fetchFn, calls } = fakeFetch({ '/auth/v1/otp': () => jsonRes(200, {}) });
  const { rpc, calls: rc } = fakeRpc();
  const res = await handleRequestOtp(post({ phone: '010 1234 5678', device_id: DEVICE }), { env: otpEnv(), fetch: fetchFn, rpc });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, resend_after_seconds: 60 });
  assert.equal(calls[0].url, 'https://proj.supabase.co/auth/v1/otp');
  assert.equal((calls[0].init.headers as Record<string, string>).apikey, 'anon-key');
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { phone: PHONE, create_user: true, channel: 'sms' });
  const check = rc.find((c) => c.name === 'otp_check_and_log')!;
  assert.equal(check.args.p_mode, 'request');
  assert.equal(check.args.p_device_hash, await sha256Hex('device:' + DEVICE));
  // The rate-limit log keeps hashes only; the ban check is the one call that gets the number (the database hashes it).
  const logged = JSON.stringify(rc.filter((c) => c.name !== 'is_phone_banned'));
  assert.ok(!logged.includes(DEVICE) && !logged.includes('201012345678'), 'only hashes go to the rate-limit log');
  assert.ok(!JSON.stringify(rc).includes(DEVICE), 'the raw device id never goes to the database');
});

test('request-otp: bad input never reaches the database or Supabase Auth', async () => {
  const { fetchFn, calls } = fakeFetch({});
  const { rpc, calls: rc } = fakeRpc();
  const deps = { env: otpEnv(), fetch: fetchFn, rpc };
  assert.equal((await handleRequestOtp(post({ phone: '+14155550123', device_id: DEVICE }), deps)).status, 400);
  assert.equal((await handleRequestOtp(post({ phone: PHONE }), deps)).status, 400);
  assert.equal((await handleRequestOtp(post({ phone: PHONE, device_id: 'short' }), deps)).status, 400);
  assert.equal((await handleRequestOtp(post('not json'), deps)).status, 400);
  assert.equal((await handleRequestOtp(post('x'.repeat(5000)), deps)).status, 400);
  assert.equal((await handleRequestOtp(new Request('https://f.test/', { method: 'GET' }), deps)).status, 405);
  assert.equal(calls.length + rc.length, 0);
});

test('request-otp: a banned number gets the normal answer and no code', async () => {
  const { fetchFn, calls } = fakeFetch({});
  const { rpc, calls: rc } = fakeRpc({ is_phone_banned: () => true });
  const res = await handleRequestOtp(post({ phone: PHONE, device_id: DEVICE }), { env: otpEnv(), fetch: fetchFn, rpc });
  assert.deepEqual(await res.json(), { ok: true, resend_after_seconds: 60 });
  assert.equal(calls.length, 0, 'Supabase Auth is never asked');
  assert.ok(!rc.some((c) => c.name === 'otp_check_and_log'));
});

test('request-otp: limits come back as 429 with the wait time', async () => {
  const { fetchFn, calls } = fakeFetch({});
  for (const reason of ['phone_limit', 'device_limit']) {
    const { rpc } = fakeRpc({ otp_check_and_log: () => ({ allowed: false, reason, retry_after_seconds: 900, captcha_required: false }) });
    const res = await handleRequestOtp(post({ phone: PHONE, device_id: DEVICE }), { env: otpEnv(), fetch: fetchFn, rpc });
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { error: reason, retry_after_seconds: 900, captcha_required: false });
  }
  assert.equal(calls.length, 0);
});

test('request-otp: after two wrong codes it asks for a CAPTCHA, or makes the person wait when none is set up', async () => {
  const lock = { otp_check_and_log: () => ({ allowed: false, reason: 'captcha_required', retry_after_seconds: 600, captcha_required: true }) };
  const a = await handleRequestOtp(post({ phone: PHONE, device_id: DEVICE }), { env: otpEnv(), fetch: fakeFetch({}).fetchFn, rpc: fakeRpc(lock).rpc });
  assert.deepEqual(await a.json(), { error: 'too_many_attempts', retry_after_seconds: 600, captcha_required: false });
  const b = await handleRequestOtp(post({ phone: PHONE, device_id: DEVICE }), { env: otpEnv({ CAPTCHA_PROVIDER: 'turnstile', CAPTCHA_SECRET: 's' }), fetch: fakeFetch({}).fetchFn, rpc: fakeRpc(lock).rpc });
  assert.deepEqual(await b.json(), { error: 'captcha_required', retry_after_seconds: 600, captcha_required: true });
});

test('request-otp: a solved CAPTCHA clears the lock before the check', async () => {
  const { fetchFn, calls } = fakeFetch({ 'challenges.cloudflare.com': () => jsonRes(200, { success: true }), '/auth/v1/otp': () => jsonRes(200, {}) });
  const { rpc, calls: rc } = fakeRpc();
  const res = await handleRequestOtp(post({ phone: PHONE, device_id: DEVICE, captcha_token: 'solved' }), { env: otpEnv({ CAPTCHA_PROVIDER: 'turnstile', CAPTCHA_SECRET: 's' }), fetch: fetchFn, rpc });
  assert.equal(res.status, 200);
  assert.deepEqual(rc.map((c) => c.name), ['is_phone_banned', 'otp_record_result', 'otp_check_and_log']);
  assert.equal(new URLSearchParams(calls[0].init.body as string).get('response'), 'solved');
  const bad = fakeFetch({ 'challenges.cloudflare.com': () => jsonRes(200, { success: false }), '/auth/v1/otp': () => jsonRes(200, {}) });
  const rc2 = fakeRpc();
  await handleRequestOtp(post({ phone: PHONE, device_id: DEVICE, captcha_token: 'wrong' }), { env: otpEnv({ CAPTCHA_PROVIDER: 'turnstile', CAPTCHA_SECRET: 's' }), fetch: bad.fetchFn, rpc: rc2.rpc });
  assert.ok(!rc2.calls.some((c) => c.name === 'otp_record_result'), 'a wrong CAPTCHA clears nothing');
});

test('request-otp: Supabase Auth answers are passed on honestly', async () => {
  const cases: [number, string, unknown][] = [
    [429, 'too_soon', 'For security purposes, you can only request this after 42 seconds.'],
    [500, 'send_failed', 'Error running hook URL'],
    [400, 'send_failed', 'bad'],
  ];
  for (const [status, error, text] of cases) {
    const { fetchFn } = fakeFetch({ '/auth/v1/otp': () => new Response(String(text), { status }) });
    const res = await handleRequestOtp(post({ phone: PHONE, device_id: DEVICE }), { env: otpEnv(), fetch: fetchFn, rpc: fakeRpc().rpc });
    assert.equal((await res.json()).error, error);
    assert.equal(res.status, status === 429 ? 429 : 502);
  }
  const wait = await handleRequestOtp(post({ phone: PHONE, device_id: DEVICE }), { env: otpEnv(), fetch: fakeFetch({ '/auth/v1/otp': () => new Response('only request this after 42 seconds', { status: 429 }) }).fetchFn, rpc: fakeRpc().rpc });
  assert.equal((await wait.json()).retry_after_seconds, 42);
  const down = await handleRequestOtp(post({ phone: PHONE, device_id: DEVICE }), { env: otpEnv(), fetch: fakeFetch({}).fetchFn, rpc: fakeRpc({ is_phone_banned: () => new Error('db') }).rpc });
  assert.equal(down.status, 503);
  const noSettings = await handleRequestOtp(post({ phone: PHONE, device_id: DEVICE }), { env: envFrom({}), fetch: fakeFetch({}).fetchFn, rpc: fakeRpc().rpc });
  assert.equal(noSettings.status, 503);
});

// ---------------------------------------------------------------- verify-otp
const session = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer', user: { id: 'u1', phone: '201012345678', email: 'x', app_metadata: { secret: 1 } } };

test('verify-otp: a right code returns only the session, and the success is recorded', async () => {
  const { fetchFn, calls } = fakeFetch({ '/auth/v1/verify': () => jsonRes(200, session) });
  const { rpc, calls: rc } = fakeRpc();
  const res = await handleVerifyOtp(post({ phone: PHONE, token: CODE, device_id: DEVICE }), { env: otpEnv(), fetch: fetchFn, rpc });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer', user: { id: 'u1' } });
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { type: 'sms', phone: PHONE, token: CODE });
  assert.equal(rc.at(-1)!.name, 'otp_record_result');
  assert.equal(rc.at(-1)!.args.p_ok, true);
  assert.ok(!JSON.stringify(rc).includes(CODE), 'the code is never sent to the database');
});

test('verify-otp: a wrong code is counted and answered the same way every time', async () => {
  const { fetchFn } = fakeFetch({ '/auth/v1/verify': () => jsonRes(403, { msg: 'Token has expired or is invalid' }) });
  const { rpc, calls: rc } = fakeRpc();
  const res = await handleVerifyOtp(post({ phone: PHONE, token: CODE, device_id: DEVICE }), { env: otpEnv(), fetch: fetchFn, rpc });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'invalid_code' });
  assert.equal(rc.at(-1)!.args.p_ok, false);
  const down = fakeFetch({ '/auth/v1/verify': () => jsonRes(500, {}) });
  const rc2 = fakeRpc();
  const r2 = await handleVerifyOtp(post({ phone: PHONE, token: CODE, device_id: DEVICE }), { env: otpEnv(), fetch: down.fetchFn, rpc: rc2.rpc });
  assert.equal(r2.status, 502);
  assert.ok(!rc2.calls.some((c) => c.name === 'otp_record_result'), 'a server error is not counted as a wrong code');
});

test('verify-otp: after two wrong codes Supabase Auth is not even asked', async () => {
  const { fetchFn, calls } = fakeFetch({});
  const { rpc } = fakeRpc({ otp_check_and_log: () => ({ allowed: false, reason: 'captcha_required', retry_after_seconds: 540, captcha_required: true }) });
  const res = await handleVerifyOtp(post({ phone: PHONE, token: CODE, device_id: DEVICE }), { env: otpEnv(), fetch: fetchFn, rpc });
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'too_many_attempts', retry_after_seconds: 540, captcha_required: false });
  assert.equal(calls.length, 0);
});

test('verify-otp: bad input is refused before anything else happens', async () => {
  const deps = { env: otpEnv(), fetch: fakeFetch({}).fetchFn, rpc: fakeRpc().rpc };
  assert.equal((await handleVerifyOtp(post({ phone: PHONE, token: 'abc', device_id: DEVICE }), deps)).status, 400);
  assert.equal((await handleVerifyOtp(post({ phone: PHONE, token: '1234567890', device_id: DEVICE }), deps)).status, 400);
  assert.equal((await handleVerifyOtp(post({ phone: '+14155550123', token: CODE, device_id: DEVICE }), deps)).status, 400);
  assert.equal((await handleVerifyOtp(post({ phone: PHONE, token: CODE }), deps)).status, 400);
  const incomplete = fakeFetch({ '/auth/v1/verify': () => jsonRes(200, { access_token: 'a' }) });
  assert.equal((await handleVerifyOtp(post({ phone: PHONE, token: CODE, device_id: DEVICE }), { ...deps, fetch: incomplete.fetchFn })).status, 502);
});

// ---------------------------------------------------------------- process-upload
const UID = '11111111-2222-3333-4444-555555555555';
function fakeStorage(files: Record<string, Uint8Array> = {}) {
  const store = new Map(Object.entries(files));
  const ops: string[] = [];
  const storage: StorageOps = {
    async download(bucket, path) { ops.push(`download ${bucket}/${path}`); return store.get(`${bucket}/${path}`) ?? null; },
    async upload(bucket, path, bytes, contentType) { ops.push(`upload ${bucket}/${path} ${contentType}`); store.set(`${bucket}/${path}`, bytes); return true; },
    async remove(bucket, path) { ops.push(`remove ${bucket}/${path}`); store.delete(`${bucket}/${path}`); },
  };
  return { storage, store, ops };
}
const uploadDeps = (storage: StorageOps, rpc: Rpc = fakeRpc().rpc, user: { id: string } | null = { id: UID }) =>
  ({ authUser: async () => user, storage, rpc, randomId: () => 'rand-1' });
const withAuth = (body: unknown) => post(body, { Authorization: 'Bearer token' });

test('process-upload: saves a clean copy under a random name and deletes the raw file', async () => {
  const raw = photo();
  const fs = fakeStorage({ [`incoming/${UID}/camera.jpg`]: raw });
  const res = await handleProcessUpload(withAuth({ kind: 'pet', path: `${UID}/camera.jpg` }), uploadDeps(fs.storage));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { path: `${UID}/rand-1.jpg` });
  const saved = fs.store.get(`pets/${UID}/rand-1.jpg`)!;
  assert.ok(saved, 'the clean copy is in the pets bucket');
  assert.ok(has(raw, enc('GPS-LAT')) && !has(saved, enc('GPS')) && !has(saved, enc('TRAILER')), 'the saved copy has no GPS');
  assert.ok(!fs.store.has(`incoming/${UID}/camera.jpg`), 'the raw file is deleted');
  assert.deepEqual(fs.ops.filter((o) => o.startsWith('upload')), [`upload pets/${UID}/rand-1.jpg image/jpeg`]);
});

test('process-upload: PNG stays PNG, face goes to faces, home is attached to the profile', async () => {
  const fs = fakeStorage({ [`incoming/${UID}/a.png`]: png(), [`incoming/${UID}/h.jpg`]: photo() });
  const res = await handleProcessUpload(withAuth({ kind: 'face', path: `${UID}/a.png` }), uploadDeps(fs.storage));
  assert.deepEqual(await res.json(), { path: `${UID}/rand-1.png` });
  assert.ok(fs.store.has(`faces/${UID}/rand-1.png`));
  const { rpc, calls } = fakeRpc({ attach_home_photo: () => null });
  const home = await handleProcessUpload(withAuth({ kind: 'home', path: `${UID}/h.jpg` }), uploadDeps(fs.storage, rpc));
  assert.equal(home.status, 200);
  assert.deepEqual(calls, [{ name: 'attach_home_photo', args: { p_user: UID, p_path: `${UID}/rand-1.jpg` } }]);
  assert.ok(fs.store.has(`homes/${UID}/rand-1.jpg`));
  const { rpc: failing } = fakeRpc({ attach_home_photo: () => new Error('x') });
  const fs2 = fakeStorage({ [`incoming/${UID}/h.jpg`]: photo() });
  assert.equal((await handleProcessUpload(withAuth({ kind: 'home', path: `${UID}/h.jpg` }), uploadDeps(fs2.storage, failing))).status, 502);
});

test('process-upload: only your own raw files, only known kinds, only signed-in people', async () => {
  const fs = fakeStorage({ [`incoming/other/x.jpg`]: photo() });
  const deps = uploadDeps(fs.storage);
  assert.equal((await handleProcessUpload(post({ kind: 'pet', path: `${UID}/x.jpg` }), deps)).status, 401);
  assert.equal((await handleProcessUpload(withAuth({ kind: 'pet', path: `${UID}/x.jpg` }), uploadDeps(fs.storage, fakeRpc().rpc, null))).status, 401);
  for (const bad of [
    { kind: 'handover', path: `${UID}/x.jpg` }, { kind: 'pet', path: 'other/x.jpg' }, { kind: 'pet', path: `${UID}/../other/x.jpg` },
    { kind: 'pet', path: `${UID}/sub/x.jpg` }, { kind: 'pet', path: `${UID}/x y.jpg` }, { kind: 'pet', path: '' }, { kind: 'pet' }, {},
  ]) assert.equal((await handleProcessUpload(withAuth(bad), deps)).status, 400, JSON.stringify(bad));
  assert.equal((await handleProcessUpload(withAuth({ kind: 'pet', path: `${UID}/missing.jpg` }), deps)).status, 404);
  assert.equal((await handleProcessUpload(new Request('https://f.test/', { method: 'GET' }), deps)).status, 405);
  assert.equal(fs.ops.filter((o) => o.startsWith('upload')).length, 0);
});

test('process-upload: a file that is not a real photo is refused and deleted', async () => {
  for (const [name, bytes, reason] of [['a.jpg', enc('GIF89a-not-a-jpeg'), 'unsupported'], ['b.jpg', photo({ width: 50, height: 50 }), 'too_small'], ['c.jpg', photo().subarray(0, 60), 'corrupt']] as const) {
    const fs = fakeStorage({ [`incoming/${UID}/${name}`]: bytes });
    const res = await handleProcessUpload(withAuth({ kind: 'pet', path: `${UID}/${name}` }), uploadDeps(fs.storage));
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'invalid_image', reason });
    assert.ok(!fs.store.has(`incoming/${UID}/${name}`), 'the refused file is deleted');
    assert.equal(fs.ops.filter((o) => o.startsWith('upload')).length, 0);
  }
});

// ---------------------------------------------------------------- verify-identity
const idEnv = (extra: Record<string, string> = {}) => envFrom({ IDENTITY_PROVIDER: 'fake', ...extra });
const idDeps = (rpc: Rpc, env = idEnv(), files: Record<string, Uint8Array> = { [`faces/${UID}/f.jpg`]: Uint8Array.of(1, 2, 3) }, user: { id: string } | null = { id: UID }) => ({
  env, authUser: async () => user, download: async (b: string, p: string) => files[`${b}/${p}`] ?? null, rpc });

test('verify-identity: nothing is approved until a provider is configured', async () => {
  const { rpc, calls } = fakeRpc();
  const res = await handleVerifyIdentity(withAuth({ step: 'id' }), idDeps(rpc, envFrom({})));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'not_configured' });
  const prod = await handleVerifyIdentity(withAuth({ step: 'id' }), idDeps(rpc, idEnv({ PAWSPAL_ENV: 'production' })));
  assert.equal(prod.status, 503, 'the fake provider is refused in production');
  assert.equal(calls.length, 0);
});

test('verify-identity: face step records the result with the face photo and a device hash', async () => {
  const { rpc, calls } = fakeRpc({ record_verification: () => 'ok' });
  const res = await handleVerifyIdentity(withAuth({ step: 'face', face_path: `${UID}/f.jpg`, device_id: DEVICE }), idDeps(rpc));
  assert.deepEqual(await res.json(), { ok: true, face: true });
  assert.deepEqual(calls[0], { name: 'record_verification', args: { p_user: UID, p_face: true, p_id: null, p_adult: null, p_face_path: `${UID}/f.jpg`, p_id_hash: null, p_device_hash: await sha256Hex('device:' + DEVICE) } });
});

test('verify-identity: id step records adulthood and the document hash only', async () => {
  const { rpc, calls } = fakeRpc({ record_verification: () => 'ok' });
  const res = await handleVerifyIdentity(withAuth({ step: 'id' }), idDeps(rpc));
  assert.deepEqual(await res.json(), { ok: true, id: true, adult: true });
  assert.equal(calls[0].args.p_id, true);
  assert.equal(calls[0].args.p_adult, true);
  assert.equal(calls[0].args.p_id_hash, await sha256Hex(`fake-document:${UID}`));
  assert.equal(calls[0].args.p_device_hash, null);
  const under = await handleVerifyIdentity(withAuth({ step: 'id', test_outcome: 'underage' }), idDeps(rpc));
  assert.deepEqual(await under.json(), { ok: true, id: true, adult: false });
});

test('verify-identity: a failed check records nothing; a refusal never says why', async () => {
  const { rpc, calls } = fakeRpc({ record_verification: () => 'ok' });
  const f = await handleVerifyIdentity(withAuth({ step: 'face', face_path: `${UID}/f.jpg`, test_outcome: 'reject_face' }), idDeps(rpc));
  assert.deepEqual(await f.json(), { ok: false, face: false });
  const i = await handleVerifyIdentity(withAuth({ step: 'id', test_outcome: 'reject_id' }), idDeps(rpc));
  assert.deepEqual(await i.json(), { ok: false, id: false });
  assert.equal(calls.length, 0);
  for (const why of ['banned_id', 'duplicate_id', 'banned_device']) {
    const refuse = fakeRpc({ record_verification: () => why });
    const res = await handleVerifyIdentity(withAuth({ step: 'id' }), idDeps(refuse.rpc));
    assert.equal(res.status, 403);
    const text = await res.text();
    assert.equal(text, JSON.stringify({ error: 'identity_refused' }));
  }
  const broken = fakeRpc({ record_verification: () => new Error('db') });
  assert.equal((await handleVerifyIdentity(withAuth({ step: 'id' }), idDeps(broken.rpc))).status, 502);
});

test('verify-identity: signed-in only, valid steps only, and only your own selfie', async () => {
  const { rpc } = fakeRpc({ record_verification: () => 'ok' });
  assert.equal((await handleVerifyIdentity(post({ step: 'id' }), idDeps(rpc))).status, 401);
  assert.equal((await handleVerifyIdentity(withAuth({ step: 'id' }), idDeps(rpc, idEnv(), {}, null))).status, 401);
  assert.equal((await handleVerifyIdentity(withAuth({ step: 'passport' }), idDeps(rpc))).status, 400);
  assert.equal((await handleVerifyIdentity(withAuth({}), idDeps(rpc))).status, 400);
  assert.equal((await handleVerifyIdentity(withAuth({ step: 'face', face_path: 'other/f.jpg' }), idDeps(rpc))).status, 400);
  assert.equal((await handleVerifyIdentity(withAuth({ step: 'face', face_path: `${UID}/../f.jpg` }), idDeps(rpc))).status, 400);
  assert.equal((await handleVerifyIdentity(withAuth({ step: 'face', face_path: `${UID}/gone.jpg` }), idDeps(rpc))).status, 404);
  assert.equal((await handleVerifyIdentity(new Request('https://f.test/', { method: 'GET' }), idDeps(rpc))).status, 405);
});
