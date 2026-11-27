import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { envFrom } from './config.ts';
import { adminConfig, normaliseCode, sessionIdFromJwt, handleAdminPasskey, type AdminPasskeyDeps, type WebAuthnApi } from './handlers/admin-passkey.ts';
import { FakePasskeyDb } from './test-passkey-db.ts';

// Nothing in this function may print: tokens, codes, challenges and credentials must never reach the logs.
const logged: string[] = [];
for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  (console as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { logged.push(a.join(' ')); };
}
test.afterEach(() => { assert.deepEqual(logged.splice(0), [], 'the function printed to the log'); });

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORIGIN = 'https://admin.pawspal.test';
const ENV = { ADMIN_RP_ID: 'pawspal.test', ADMIN_ORIGIN: ORIGIN, ADMIN_RP_NAME: 'PawsPal admin' };

// ---------------------------------------------------------------- fakes
function fakeWebauthn(over: Partial<WebAuthnApi> = {}) {
  const calls: { name: string; opts: any }[] = [];
  const api: WebAuthnApi = {
    async generateRegistrationOptions(opts) { calls.push({ name: 'genReg', opts }); return { ...opts, challenge: 'reg-challenge-0123456789' } as any; },
    async verifyRegistrationResponse(opts) {
      calls.push({ name: 'verReg', opts });
      return { verified: true, registrationInfo: { credential: { id: 'cred-new', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'multiDevice', credentialBackedUp: true, userVerified: true } };
    },
    async generateAuthenticationOptions(opts) { calls.push({ name: 'genAuth', opts }); return { ...opts, challenge: 'auth-challenge-012345678' } as any; },
    async verifyAuthenticationResponse(opts) { calls.push({ name: 'verAuth', opts }); return { verified: true, authenticationInfo: { newCounter: 1 } }; },
    ...over,
  };
  return { api, calls };
}

function setup(opts: { admins?: string[]; env?: Record<string, string | undefined>; user?: { id: string; sessionId: string } | null; wa?: Partial<WebAuthnApi> } = {}) {
  const db = new FakePasskeyDb(opts.admins ?? [ADMIN]);
  const wa = fakeWebauthn(opts.wa);
  const user = opts.user === undefined ? { id: ADMIN, sessionId: SID } : opts.user;
  const deps: AdminPasskeyDeps = {
    authUser: async (t) => (t === 'good-token' ? user : null),
    rpc: db.rpc, webauthn: wa.api, env: envFrom(opts.env ?? ENV),
    random: (n) => new Uint8Array(randomBytes(n)),
    now: () => Date.UTC(2026, 10, 27),
  };
  return { db, wa, deps };
}
const req = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer good-token', Origin: ORIGIN }, method = 'POST') =>
  new Request('https://f.test/admin-passkey', { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
async function call(deps: AdminPasskeyDeps, body: unknown, headers?: Record<string, string>) {
  const res = await handleAdminPasskey(req(body, headers), deps);
  return { res, status: res.status, body: res.status === 204 ? null : await res.json() as any };
}
const REFUSED = { error: 'not_allowed' };
/** Makes the fake session verified, as if a passkey (or recovery code) had just answered. */
const verify = (db: FakePasskeyDb, via: 'passkey' | 'recovery' = 'passkey', user = ADMIN, session = SID, stepUp = via === 'passkey') => { db.sessions.set(session, { user, via, minutes: 480, stepUp }); };
const addCred = (db: FakePasskeyDb, id = 'c1', user = ADMIN) => (db.rpc('pk_add_credential', { p_user: user, p_credential_id: id, p_public_key: 'AQID', p_counter: 0, p_transports: [], p_device_type: 'multiDevice', p_backed_up: true, p_name: 'Phone', p_setup_code: null }));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------- configuration, CORS, tokens
test('adminConfig: needs all three settings and they must fit together', () => {
  assert.ok(adminConfig(envFrom(ENV)));
  for (const k of Object.keys(ENV)) assert.equal(adminConfig(envFrom({ ...ENV, [k]: undefined })), null, k + ' missing');
  for (const k of Object.keys(ENV)) assert.equal(adminConfig(envFrom({ ...ENV, [k]: '  ' })), null, k + ' blank');
  assert.equal(adminConfig(envFrom({ ...ENV, ADMIN_ORIGIN: 'https://admin.pawspal.test/' })), null, 'a path or trailing slash');
  assert.equal(adminConfig(envFrom({ ...ENV, ADMIN_ORIGIN: 'https://a.pawspal.test,https://b.pawspal.test' })), null, 'two origins');
  assert.equal(adminConfig(envFrom({ ...ENV, ADMIN_ORIGIN: 'http://admin.pawspal.test' })), null, 'plain http');
  assert.ok(adminConfig(envFrom({ ADMIN_RP_ID: 'localhost', ADMIN_ORIGIN: 'http://localhost', ADMIN_RP_NAME: 'x' })), 'http is fine for localhost');
  assert.equal(adminConfig(envFrom({ ...ENV, ADMIN_ORIGIN: 'https://evil.example' })), null, 'an origin outside the RP ID');
  assert.equal(adminConfig(envFrom({ ...ENV, ADMIN_ORIGIN: 'https://notpawspal.test' })), null, 'a look-alike suffix');
  assert.equal(adminConfig(envFrom({ ...ENV, ADMIN_RP_ID: 'https://pawspal.test' })), null, 'an RP ID with a scheme');
  assert.ok(adminConfig(envFrom({ ...ENV, ADMIN_ORIGIN: 'https://pawspal.test' })), 'the RP ID itself is an allowed origin');
});

test('not configured: 503 and nothing else happens', async () => {
  const { deps, db } = setup({ env: { ...ENV, ADMIN_RP_ID: undefined } });
  const r = await call(deps, { action: 'status' });
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { error: 'not_configured' });
  assert.equal(db.calls.length, 0);
  assert.equal(r.res.headers.get('access-control-allow-origin'), null);
});

test('CORS: only the admin origin gets headers; preflight is answered', async () => {
  const { deps } = setup();
  const pre = await handleAdminPasskey(req(null, { Origin: ORIGIN }, 'OPTIONS'), deps);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(pre.headers.get('access-control-allow-headers'), 'authorization, content-type, apikey, x-client-info');
  assert.equal(pre.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.match(pre.headers.get('vary') ?? '', /Origin/);
  const bad = await handleAdminPasskey(req(null, { Origin: 'https://evil.example' }, 'OPTIONS'), deps);
  assert.equal(bad.status, 204);
  assert.equal([...bad.headers.keys()].filter((k) => k.startsWith('access-control')).length, 0, 'no CORS headers for another origin');
  assert.match(bad.headers.get('vary') ?? '', /Origin/);
  // a real request from the right origin carries the header; from another origin it is refused and carries none
  const ok = await call(deps, { action: 'status' });
  assert.equal(ok.status, 200);
  assert.equal(ok.res.headers.get('access-control-allow-origin'), ORIGIN);
  const other = await call(deps, { action: 'status' }, { Authorization: 'Bearer good-token', Origin: 'https://evil.example' });
  assert.equal(other.status, 403);
  assert.deepEqual(other.body, REFUSED);
  assert.equal([...other.res.headers.keys()].filter((k) => k.startsWith('access-control')).length, 0);
  // not configured: not even the right origin gets headers
  const nc = setup({ env: {} });
  const pre2 = await handleAdminPasskey(req(null, { Origin: ORIGIN }, 'OPTIONS'), nc.deps);
  assert.equal(pre2.headers.get('access-control-allow-origin'), null);
});

test('no token, a bad token, or a token without a session id: 401 and no database call', async () => {
  const { deps, db } = setup();
  assert.equal((await call(deps, { action: 'status' }, { Origin: ORIGIN })).status, 401);
  assert.equal((await call(deps, { action: 'status' }, { Authorization: 'Bearer nope', Origin: ORIGIN })).status, 401);
  assert.equal((await call(deps, { action: 'status' }, { Authorization: 'Basic abc', Origin: ORIGIN })).status, 401);
  const noSession = setup({ user: null });
  assert.equal((await call(noSession.deps, { action: 'status' })).status, 401);
  const garbage = setup({ user: { id: ADMIN, sessionId: 'not-a-uuid' } });
  assert.equal((await call(garbage.deps, { action: 'status' })).status, 401);
  assert.equal(db.calls.length + noSession.db.calls.length + garbage.db.calls.length, 0);
});

test('only POST; the body must be small JSON with an action', async () => {
  const { deps } = setup();
  assert.equal((await handleAdminPasskey(req(null, undefined, 'GET'), deps)).status, 405);
  assert.equal((await call(deps, 'not json')).status, 400);
  assert.equal((await call(deps, [])).status, 400);
  assert.equal((await call(deps, { action: 5 })).status, 400);
  assert.equal((await call(deps, { action: 'status', pad: 'x'.repeat(17 * 1024) })).status, 400);
});

test('sessionIdFromJwt reads only a uuid session_id', () => {
  const tok = (c: unknown) => `h.${Buffer.from(JSON.stringify(c)).toString('base64url')}.s`;
  assert.equal(sessionIdFromJwt(tok({ session_id: SID.toUpperCase() })), SID);
  assert.equal(sessionIdFromJwt(tok({ session_id: 'x' })), null);
  assert.equal(sessionIdFromJwt(tok({ session_id: 5 })), null);
  assert.equal(sessionIdFromJwt(tok({})), null);
  assert.equal(sessionIdFromJwt('garbage'), null);
  assert.equal(sessionIdFromJwt('a.%%%.c'), null);
});

// ---------------------------------------------------------------- who may call
test('a non-admin is refused everywhere with the same body, and nothing is written', async () => {
  const { deps, db } = setup({ admins: [] });
  for (const body of [{ action: 'status' }, { action: 'register_options', setup_code: 'ABCDEFGHJKLM' }, { action: 'login_options' }, { action: 'recovery_login', code: 'ABCD-EFGH-JKLM-NPQR' },
    { action: 'recovery_generate' }, { action: 'sign_out' }, { action: 'made_up' }]) {
    const r = await call(deps, body);
    assert.equal(r.status, 403, JSON.stringify(body));
    assert.deepEqual(r.body, REFUSED);
  }
  assert.deepEqual([...new Set(db.calls.map((c) => c.name))], ['pk_state'], 'only the state was read');
});

test('unknown action: 400 for an admin', async () => {
  const { deps } = setup();
  const r = await call(deps, { action: 'delete_everything' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'invalid_request' });
});

test('a database error is a generic 502', async () => {
  const { deps, db } = setup();
  db.failNext = 'pk_state';
  const r = await call(deps, { action: 'status' });
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: 'try_again_later' });
});

// ---------------------------------------------------------------- status
test('status: needs_setup, needs_passkey, admin; no credential data in the answer', async () => {
  const { deps, db } = setup();
  assert.equal((await call(deps, { action: 'status' })).body.status, 'needs_setup');
  await addCred(db);
  const s2 = await call(deps, { action: 'status' });
  assert.equal(s2.body.status, 'needs_passkey');
  assert.equal(s2.body.verified, false);
  assert.equal(s2.body.passkeys.length, 1);
  verify(db);
  const s3 = await call(deps, { action: 'status' });
  assert.equal(s3.body.status, 'admin');
  assert.equal(s3.body.via, 'passkey');
  assert.ok(!JSON.stringify(s3.body).includes('public_key') && !JSON.stringify(s3.body).includes('credential_id'));
});

// ---------------------------------------------------------------- registration
test('register_options: a password alone is not enough; a setup code or a verified session is', async () => {
  const { deps, db, wa } = setup();
  db.setupCodes.set(ADMIN, { code: 'ABCDEFGHJKLM', used: false });
  assert.deepEqual((await call(deps, { action: 'register_options' })).body, REFUSED);
  assert.deepEqual((await call(deps, { action: 'register_options', setup_code: 'WRONGWRONG22' })).body, REFUSED);
  assert.equal(wa.calls.length, 0, 'no options were made for a refused call');
  const ok = await call(deps, { action: 'register_options', name: ' My phone ', setup_code: 'abcd-efgh-jklm' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.options.challenge, 'reg-challenge-0123456789');
  const o = wa.calls[0].opts;
  assert.equal(o.rpID, 'pawspal.test');
  assert.equal(o.rpName, 'PawsPal admin');
  assert.equal(o.attestationType, 'none');
  assert.deepEqual(o.authenticatorSelection, { residentKey: 'preferred', userVerification: 'required' });
  assert.equal(o.userID.length, 32);
  assert.ok(!Buffer.from(o.userID).toString('utf8').includes('@') && !Buffer.from(o.userID).includes(Buffer.from(ADMIN)), 'the user handle is not the id or an email');
  assert.equal(o.timeout, 300000);
  assert.equal(o.userName, 'My phone');
  assert.equal(db.challenges.get(`${ADMIN}|${SID}|register`), 'reg-challenge-0123456789', 'the challenge is stored for this user, session and purpose');
  assert.equal(db.setupCodes.get(ADMIN)!.used, false, 'asking for options does not use the setup code up');
  // already verified: no code needed
  const v = setup(); verify(v.db);
  assert.equal((await call(v.deps, { action: 'register_options' })).status, 200);
});

test('register_options: the same user handle every time, different for another admin; excludes existing passkeys', async () => {
  const { deps, db, wa } = setup({ admins: [ADMIN, OTHER] }); verify(db); await addCred(db, 'have-1');
  await call(deps, { action: 'register_options' });
  await call(deps, { action: 'register_options' });
  assert.deepEqual(wa.calls[0].opts.userID, wa.calls[1].opts.userID);
  assert.deepEqual(wa.calls[0].opts.excludeCredentials, [{ id: 'have-1', transports: [] }]);
  const o2 = setup({ admins: [ADMIN, OTHER], user: { id: OTHER, sessionId: SID } }); verify(o2.db, 'passkey', OTHER);
  await call(o2.deps, { action: 'register_options' });
  assert.notDeepEqual(o2.wa.calls[0].opts.userID, wa.calls[0].opts.userID);
});

test('register_options: the setup code is locked after too many wrong tries; a bad name is refused; ten passkeys is the limit', async () => {
  const { deps, db } = setup();
  db.setupCodes.set(ADMIN, { code: 'ABCDEFGHJKLM', used: false });
  for (let i = 0; i < 5; i++) assert.equal((await call(deps, { action: 'register_options', setup_code: 'NOPENOPENOPE' })).status, 403);
  const locked = await call(deps, { action: 'register_options', setup_code: 'ABCDEFGHJKLM' });
  assert.equal(locked.status, 429);
  assert.deepEqual(locked.body, { error: 'too_many_attempts' });
  const v = setup(); verify(v.db);
  assert.equal((await call(v.deps, { action: 'register_options', name: 'x'.repeat(41) })).status, 400);
  assert.equal((await call(v.deps, { action: 'register_options', name: 7 })).status, 400);
  for (let i = 0; i < 10; i++) await addCred(v.db, 'k' + i);
  const full = await call(v.deps, { action: 'register_options' });
  assert.equal(full.status, 400);
  assert.deepEqual(full.body, { error: 'passkey_limit' });
});

test('register_verify with a setup code: stores the passkey, uses the code up, starts the passkey session', async () => {
  const { deps, db, wa } = setup();
  db.setupCodes.set(ADMIN, { code: 'ABCDEFGHJKLM', used: false });
  await call(deps, { action: 'register_options', setup_code: 'ABCDEFGHJKLM' });
  const r = await call(deps, { action: 'register_verify', response: { id: 'cred-new' }, setup_code: 'ABCDEFGHJKLM', name: 'Laptop' });
  assert.equal(r.status, 200);
  assert.equal(r.body.passkey.name, 'Laptop');
  assert.equal(r.body.session.via, 'passkey');
  assert.ok(r.body.session.expires_at);
  const v = wa.calls.find((c) => c.name === 'verReg')!.opts;
  assert.equal(v.expectedChallenge, 'reg-challenge-0123456789');
  assert.equal(v.expectedOrigin, ORIGIN);
  assert.equal(v.expectedRPID, 'pawspal.test');
  assert.equal(v.requireUserVerification, true);
  assert.equal(v.requireUserPresence, true);
  assert.equal(db.creds.length, 1);
  assert.equal(db.creds[0].credential_id, 'cred-new');
  assert.equal(db.creds[0].public_key, 'AQID', 'the public key is stored as base64url');
  assert.equal(db.setupCodes.get(ADMIN)!.used, true);
  assert.equal(db.sessions.get(SID)?.via, 'passkey');
  assert.deepEqual(db.notes.map((n) => n.kind), ['passkey_added', 'setup', 'passkey_login']);
  assert.ok(!JSON.stringify(db.notes).includes('ABCDEFGHJKLM') && !JSON.stringify(db.notes).includes('AQID'), 'no code or key in the audit notes');
  // the challenge is single use: a second verify with the same challenge is refused
  const again = await call(deps, { action: 'register_verify', response: { id: 'cred-new' }, setup_code: 'ABCDEFGHJKLM' });
  assert.equal(again.status, 403);
});

test('register_verify: refused without a gate, with no challenge, with a wrong proof, with UV missing; a used setup code does not save a passkey', async () => {
  // no setup code and not verified
  let t = setup();
  assert.deepEqual((await call(t.deps, { action: 'register_verify', response: { id: 'x' } })).body, REFUSED);
  assert.equal(t.db.creds.length, 0);
  // setup code but no challenge was ever asked for
  t = setup(); t.db.setupCodes.set(ADMIN, { code: 'ABCDEFGHJKLM', used: false });
  assert.equal((await call(t.deps, { action: 'register_verify', response: { id: 'x' }, setup_code: 'ABCDEFGHJKLM' })).status, 403);
  assert.equal(t.db.setupCodes.get(ADMIN)!.used, false);
  // the library says no
  t = setup({ wa: { verifyRegistrationResponse: async () => ({ verified: false }) } }); t.db.setupCodes.set(ADMIN, { code: 'ABCDEFGHJKLM', used: false });
  await call(t.deps, { action: 'register_options', setup_code: 'ABCDEFGHJKLM' });
  assert.equal((await call(t.deps, { action: 'register_verify', response: { id: 'x' }, setup_code: 'ABCDEFGHJKLM' })).status, 403);
  assert.equal(t.db.creds.length, 0);
  assert.equal(t.db.setupCodes.get(ADMIN)!.used, false, 'a failed proof does not burn the setup code');
  assert.equal(t.db.notes.at(-1)?.kind, 'login_failed');
  // the library throws
  t = setup({ wa: { verifyRegistrationResponse: async () => { throw new Error('bad origin'); } } }); t.db.setupCodes.set(ADMIN, { code: 'ABCDEFGHJKLM', used: false });
  await call(t.deps, { action: 'register_options', setup_code: 'ABCDEFGHJKLM' });
  assert.equal((await call(t.deps, { action: 'register_verify', response: { id: 'x' }, setup_code: 'ABCDEFGHJKLM' })).status, 403);
  // verified says yes but the user was not verified on the device
  t = setup({ wa: { verifyRegistrationResponse: async () => ({ verified: true, registrationInfo: { credential: { id: 'c', publicKey: new Uint8Array(1), counter: 0 }, credentialDeviceType: 'singleDevice', credentialBackedUp: false, userVerified: false } }) } });
  verify(t.db); await call(t.deps, { action: 'register_options' });
  assert.equal((await call(t.deps, { action: 'register_verify', response: { id: 'x' } })).status, 403);
  assert.equal(t.db.creds.length, 0);
  // a wrong setup code at verify time (changed after the options) saves nothing
  t = setup(); t.db.setupCodes.set(ADMIN, { code: 'ABCDEFGHJKLM', used: false });
  await call(t.deps, { action: 'register_options', setup_code: 'ABCDEFGHJKLM' });
  assert.equal((await call(t.deps, { action: 'register_verify', response: { id: 'x' }, setup_code: 'ZZZZZZZZZZZZ' })).status, 403);
  assert.equal(t.db.creds.length, 0);
  // a bad response shape is a 400
  t = setup(); verify(t.db);
  assert.equal((await call(t.deps, { action: 'register_verify', response: 'x' })).status, 400);
  assert.equal((await call(t.deps, { action: 'register_verify' })).status, 400);
});

test('register_verify: the same credential twice is refused; ten is the limit; a recovery session may register and becomes a passkey session', async () => {
  const t = setup(); verify(t.db, 'recovery'); await addCred(t.db, 'cred-new');
  await call(t.deps, { action: 'register_options' });
  const dup = await call(t.deps, { action: 'register_verify', response: { id: 'cred-new' } });
  assert.equal(dup.status, 409);
  const t2 = setup(); verify(t2.db, 'recovery');
  await call(t2.deps, { action: 'register_options' });
  const ok = await call(t2.deps, { action: 'register_verify', response: { id: 'cred-new' } });
  assert.equal(ok.status, 200);
  assert.equal(t2.db.sessions.get(SID)?.via, 'passkey', 'registering from a recovery session ends in a passkey session');
  // the limit is checked again when the passkey is saved (another tab may have added one meanwhile)
  const t3 = setup(); verify(t3.db);
  for (let i = 0; i < 9; i++) await addCred(t3.db, 'k' + i);
  await call(t3.deps, { action: 'register_options' });
  await addCred(t3.db, 'k9');
  const full = await call(t3.deps, { action: 'register_verify', response: { id: 'x' } });
  assert.equal(full.status, 400);
  assert.deepEqual(full.body, { error: 'passkey_limit' });
  assert.equal(t3.db.creds.length, 10);
});

// ---------------------------------------------------------------- login
test('login_options needs a passkey; asks the database for the allowed ones; stores the challenge', async () => {
  const t = setup();
  assert.deepEqual((await call(t.deps, { action: 'login_options' })).body, REFUSED);
  await addCred(t.db, 'c1'); await addCred(t.db, 'c2');
  const r = await call(t.deps, { action: 'login_options' });
  assert.equal(r.status, 200);
  const o = t.wa.calls[0].opts;
  assert.deepEqual(o.allowCredentials.map((c: any) => c.id), ['c1', 'c2']);
  assert.equal(o.userVerification, 'required');
  assert.equal(o.rpID, 'pawspal.test');
  assert.equal(t.db.challenges.get(`${ADMIN}|${SID}|login`), 'auth-challenge-012345678');
});

test('login_verify: the happy path starts the session and bumps the counter', async () => {
  const t = setup(); await addCred(t.db, 'c1');
  await call(t.deps, { action: 'login_options' });
  const r = await call(t.deps, { action: 'login_verify', response: { id: 'c1' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.session.via, 'passkey');
  assert.equal(t.db.creds[0].counter, 1);
  assert.equal(t.db.sessions.get(SID)?.via, 'passkey');
  const v = t.wa.calls.find((c) => c.name === 'verAuth')!.opts;
  assert.equal(v.expectedChallenge, 'auth-challenge-012345678');
  assert.equal(v.requireUserVerification, true);
  assert.equal(v.expectedOrigin, ORIGIN);
  assert.equal(v.credential.counter, 0);
  assert.deepEqual([...v.credential.publicKey], [1, 2, 3]);
  assert.equal(t.db.notes.at(-1)?.kind, 'passkey_login');
});

test('login_verify: every refusal path says the same thing and is counted', async () => {
  // no challenge
  let t = setup(); await addCred(t.db, 'c1');
  let r = await call(t.deps, { action: 'login_verify', response: { id: 'c1' } });
  assert.equal(r.status, 403); assert.deepEqual(r.body, REFUSED);
  // a credential that is not this user's (Bob's id)
  t = setup({ admins: [ADMIN, OTHER] }); await addCred(t.db, 'c1'); await addCred(t.db, 'theirs', OTHER);
  await call(t.deps, { action: 'login_options' });
  r = await call(t.deps, { action: 'login_verify', response: { id: 'theirs' } });
  assert.deepEqual(r.body, REFUSED);
  assert.equal(t.wa.calls.filter((c) => c.name === 'verAuth').length, 0, 'the library never saw the other admin\'s credential');
  // the library refuses
  t = setup({ wa: { verifyAuthenticationResponse: async () => ({ verified: false, authenticationInfo: { newCounter: 1 } }) } }); await addCred(t.db, 'c1');
  await call(t.deps, { action: 'login_options' });
  r = await call(t.deps, { action: 'login_verify', response: { id: 'c1' } });
  assert.deepEqual(r.body, REFUSED);
  assert.equal(t.db.sessions.size, 0);
  // the library throws (wrong origin, wrong RP ID, UV missing ...)
  t = setup({ wa: { verifyAuthenticationResponse: async () => { throw new Error('Unexpected authentication response origin'); } } }); await addCred(t.db, 'c1');
  await call(t.deps, { action: 'login_options' });
  r = await call(t.deps, { action: 'login_verify', response: { id: 'c1' } });
  assert.deepEqual(r.body, REFUSED);
  assert.equal(t.db.sessions.size, 0);
  assert.deepEqual(t.db.notes.map((n) => n.kind), ['login_failed']);
  assert.ok(!JSON.stringify(t.db.notes).includes('origin'), 'the library message is not stored');
  // bad input shapes
  t = setup(); await addCred(t.db, 'c1');
  assert.equal((await call(t.deps, { action: 'login_verify' })).status, 400);
  assert.equal((await call(t.deps, { action: 'login_verify', response: { id: 5 } })).status, 400);
  assert.equal((await call(t.deps, { action: 'login_verify', response: 'x' })).status, 400);
});

test('login_verify: a counter that does not grow (a cloned passkey) is refused and no session starts', async () => {
  const t = setup({ wa: { verifyAuthenticationResponse: async () => ({ verified: true, authenticationInfo: { newCounter: 5 } }) } }); await addCred(t.db, 'c1');
  await call(t.deps, { action: 'login_options' });
  assert.equal((await call(t.deps, { action: 'login_verify', response: { id: 'c1' } })).status, 200);
  assert.equal(t.db.creds[0].counter, 5);
  t.db.sessions.clear();
  await call(t.deps, { action: 'login_options' });
  const replay = await call(t.deps, { action: 'login_verify', response: { id: 'c1' } });   // the library would also object; the database rule is the second lock
  assert.equal(replay.status, 403);
  assert.equal(t.db.sessions.size, 0);
  assert.equal(t.db.notes.at(-1)?.kind, 'login_failed');
  assert.deepEqual(t.db.notes.at(-1)?.details, { reason: 'counter' });
  // synced passkeys that always report 0 are fine
  const z = setup({ wa: { verifyAuthenticationResponse: async () => ({ verified: true, authenticationInfo: { newCounter: 0 } }) } }); await addCred(z.db, 'c1');
  await call(z.deps, { action: 'login_options' });
  assert.equal((await call(z.deps, { action: 'login_verify', response: { id: 'c1' } })).status, 200);
  await call(z.deps, { action: 'login_options' });
  assert.equal((await call(z.deps, { action: 'login_verify', response: { id: 'c1' } })).status, 200);
});

test('rate limit: five failures from one session lock it (options and verify); another session is free; status still works', async () => {
  const t = setup({ wa: { verifyAuthenticationResponse: async () => ({ verified: false, authenticationInfo: { newCounter: 1 } }) } }); await addCred(t.db, 'c1');
  for (let i = 0; i < 5; i++) {
    await call(t.deps, { action: 'login_options' });
    assert.equal((await call(t.deps, { action: 'login_verify', response: { id: 'c1' } })).status, 403);
  }
  const o = await call(t.deps, { action: 'login_options' });
  assert.equal(o.status, 429); assert.deepEqual(o.body, { error: 'too_many_attempts' });
  assert.equal((await call(t.deps, { action: 'login_verify', response: { id: 'c1' } })).status, 429);
  assert.equal((await call(t.deps, { action: 'recovery_login', code: 'ABCD-EFGH-JKLM-NPQR' })).status, 429);
  assert.equal((await call(t.deps, { action: 'register_options', setup_code: 'ABCDEFGHJKLM' })).status, 429);
  assert.equal((await call(t.deps, { action: 'status' })).status, 200);
  // a second session of the same user (the attacker's budget is spent, the owner's is not)
  const other = { ...t.deps, authUser: async () => ({ id: ADMIN, sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) };
  assert.equal((await call(other, { action: 'login_options' })).status, 200);
  // an attacker with four more sessions spamming passkey logins does not block anybody else
  for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) t.db.failures.set(ADMIN, [...(t.db.failures.get(ADMIN) ?? []), { kind: 'login_failed', session: 'dddddddd-0000-4000-8000-00000000000' + i }]);
  assert.equal((await call(other, { action: 'login_options' })).status, 200, 'passkey failures of other sessions do not lock a fresh session');
  // wrong recovery and setup codes are capped per user at 100 an hour
  t.db.failures.set(ADMIN, Array.from({ length: 100 }, (_, i) => ({ kind: i % 2 ? 'recovery_failed' : 'setup_code_failed', session: 'eeeeeeee-0000-4000-8000-' + String(i).padStart(12, '0') })));
  assert.equal((await call(other, { action: 'login_options' })).status, 429, 'the user budget for code guessing is spent');
  verify(t.db, 'passkey', ADMIN, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal((await call(other, { action: 'step_up_options' })).status, 200, "strangers' failures do not block a verified session");
});

// ---------------------------------------------------------------- recovery
test('recovery_generate: only from a passkey session; ten new codes shown once; stored only as hashes', async () => {
  const t = setup(); await addCred(t.db);
  assert.deepEqual((await call(t.deps, { action: 'recovery_generate' })).body, REFUSED);       // password only
  verify(t.db, 'recovery');
  assert.deepEqual((await call(t.deps, { action: 'recovery_generate' })).body, REFUSED);       // a recovery session cannot make more
  assert.equal(t.db.recovery.size, 0);
  verify(t.db, 'passkey');
  const r = await call(t.deps, { action: 'recovery_generate' });
  assert.equal(r.status, 200);
  assert.equal(r.body.codes.length, 10);
  assert.equal(new Set(r.body.codes).size, 10);
  for (const c of r.body.codes) assert.match(c, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  const stored = t.db.recovery.get(ADMIN)!.map((x) => x.hash);
  assert.deepEqual(stored, r.body.codes.map((c: string) => sha(c.replace(/-/g, ''))));
  assert.ok(!JSON.stringify(t.db.calls.map((c) => c.args)).includes(r.body.codes[0]), 'a plain code was sent to the database');
  assert.equal(t.db.notes.at(-1)?.kind, 'recovery_generated');
  assert.ok(!JSON.stringify(t.db.notes).includes(r.body.codes[0]));
  // new codes replace the old ones
  const r2 = await call(t.deps, { action: 'recovery_generate' });
  assert.notDeepEqual(r2.body.codes, r.body.codes);
  assert.equal(t.db.recovery.get(ADMIN)!.length, 10);
});

test('recovery_login: ok starts a 30 minute recovery session; bad is refused; five wrong lock it; a malformed code is not counted', async () => {
  const t = setup(); await addCred(t.db); verify(t.db);
  const codes = (await call(t.deps, { action: 'recovery_generate' })).body.codes as string[];
  t.db.sessions.clear();
  assert.equal(normaliseCode(' abcd-efgh jklm-npqr '), 'ABCDEFGHJKLMNPQR');
  const ok = await call(t.deps, { action: 'recovery_login', code: codes[0].toLowerCase().replace(/-/g, ' ') });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.session.via, 'recovery');
  assert.equal(t.db.sessions.get(SID)?.via, 'recovery');
  assert.ok(t.db.sessions.get(SID)!.minutes <= 30);
  assert.equal(t.db.notes.at(-1)?.kind, 'recovery_used');
  // single use
  t.db.sessions.clear();
  assert.equal((await call(t.deps, { action: 'recovery_login', code: codes[0] })).status, 403);
  assert.equal(t.db.sessions.size, 0);
  // a code of the wrong length is refused without counting
  const before = t.db.failures.get(ADMIN)?.length ?? 0;
  assert.equal((await call(t.deps, { action: 'recovery_login', code: 'ABC' })).status, 403);
  assert.equal(t.db.failures.get(ADMIN)?.length ?? 0, before);
  assert.equal((await call(t.deps, { action: 'recovery_login' })).status, 400);
  assert.equal((await call(t.deps, { action: 'recovery_login', code: 5 })).status, 400);
  for (let i = 0; i < 4; i++) assert.equal((await call(t.deps, { action: 'recovery_login', code: 'ZZZZ-ZZZZ-ZZZZ-ZZZ' + (i + 2) })).status, 403);
  // the reused code above was the first wrong try, these four make five: locked, even for a right code
  const locked = await call(t.deps, { action: 'recovery_login', code: codes[1] });
  assert.equal(locked.status, 429);
  assert.equal(t.db.sessions.size, 0);
});

test('recovery_login: a locked user is 429 even with a right code', async () => {
  const t = setup(); await addCred(t.db); verify(t.db);
  const codes = (await call(t.deps, { action: 'recovery_generate' })).body.codes as string[];
  t.db.sessions.clear();
  t.db.failures.set(ADMIN, Array.from({ length: 5 }, () => ({ kind: 'recovery_failed', session: SID })));
  const r = await call(t.deps, { action: 'recovery_login', code: codes[2] });
  assert.equal(r.status, 429);
  assert.deepEqual(r.body, { error: 'too_many_attempts' });
  assert.equal(t.db.sessions.size, 0);
  assert.equal(t.db.recovery.get(ADMIN)!.filter((x) => x.used).length, 0);
});

test('a recovery session cannot rename, remove or make codes; it can read the status and register a new passkey', async () => {
  const t = setup(); await addCred(t.db, 'c1'); await addCred(t.db, 'c2'); verify(t.db, 'recovery');
  const id = t.db.creds[0].id;
  assert.deepEqual((await call(t.deps, { action: 'rename', id, name: 'x' })).body, REFUSED);
  assert.deepEqual((await call(t.deps, { action: 'remove', id })).body, REFUSED);
  assert.deepEqual((await call(t.deps, { action: 'recovery_generate' })).body, REFUSED);
  assert.equal(t.db.creds.length, 2);
  assert.equal(t.db.creds[0].name, 'Phone');
  assert.equal((await call(t.deps, { action: 'status' })).body.via, 'recovery');
  assert.equal((await call(t.deps, { action: 'register_options' })).status, 200);
  // and a password-only session cannot either
  const p = setup(); await addCred(p.db, 'c1'); await addCred(p.db, 'c2');
  assert.deepEqual((await call(p.deps, { action: 'remove', id: p.db.creds[0].id })).body, REFUSED);
  assert.deepEqual((await call(p.deps, { action: 'rename', id: p.db.creds[0].id, name: 'x' })).body, REFUSED);
});

// ---------------------------------------------------------------- rename, remove, sign out
test('rename and remove: from a passkey session; the last passkey stays; other ids are not found', async () => {
  const t = setup(); await addCred(t.db, 'c1'); await addCred(t.db, 'c2'); verify(t.db);
  const [a, b] = t.db.creds.map((c) => c.id);
  const ren = await call(t.deps, { action: 'rename', id: a, name: '  Office laptop ' });
  assert.equal(ren.status, 200);
  assert.equal(t.db.creds[0].name, 'Office laptop');
  assert.equal((await call(t.deps, { action: 'rename', id: a, name: '' })).status, 400);
  assert.equal((await call(t.deps, { action: 'rename', id: a, name: 'x'.repeat(41) })).status, 400);
  assert.equal((await call(t.deps, { action: 'rename', id: 'not-a-uuid', name: 'x' })).status, 400);
  assert.equal((await call(t.deps, { action: 'rename', id: '33333333-3333-4333-8333-333333333333', name: 'x' })).status, 404);
  assert.equal((await call(t.deps, { action: 'remove', id: '33333333-3333-4333-8333-333333333333' })).status, 404);
  assert.equal((await call(t.deps, { action: 'remove', id: 5 })).status, 400);
  assert.equal((await call(t.deps, { action: 'remove', id: a })).status, 200);
  const last = await call(t.deps, { action: 'remove', id: b });
  assert.equal(last.status, 409);
  assert.deepEqual(last.body, { error: 'last_passkey' });
  assert.equal(t.db.creds.length, 1);
  assert.deepEqual(t.db.notes.map((n) => n.kind), ['passkey_renamed', 'passkey_removed']);
});

test('sign_out ends the passkey session', async () => {
  const t = setup(); await addCred(t.db); verify(t.db);
  assert.equal((await call(t.deps, { action: 'sign_out' })).status, 200);
  assert.equal(t.db.sessions.size, 0);
  assert.equal((await call(t.deps, { action: 'status' })).body.status, 'needs_passkey');
});

test('the user and the session always come from the token, never from the body', async () => {
  const t = setup({ admins: [ADMIN, OTHER] }); await addCred(t.db, 'c1', OTHER);
  t.db.calls.length = 0;
  const r = await call(t.deps, { action: 'status', user_id: OTHER, p_user: OTHER, session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
  assert.equal(r.body.passkeys.length, 0, "the other admin's passkeys are not shown");
  for (const c of t.db.calls) { assert.equal(c.args.p_user, ADMIN); if ('p_session' in c.args) assert.equal(c.args.p_session, SID); }
});

// ---------------------------------------------------------------- step-up (a stolen access token is not enough)
const STEP_UP_REQUIRED = { error: 'step_up_required' };

test('step-up: a passkey session without a fresh proof cannot enrol, rename, remove or make recovery codes (distinct body)', async () => {
  const t = setup(); await addCred(t.db, 'c1'); await addCred(t.db, 'c2'); verify(t.db, 'passkey', ADMIN, SID, false);
  const id = t.db.creds[0].id;
  for (const body of [{ action: 'register_options' }, { action: 'register_verify', response: { id: 'x' } }, { action: 'rename', id, name: 'x' }, { action: 'remove', id }, { action: 'recovery_generate' }]) {
    const r = await call(t.deps, body);
    assert.equal(r.status, 403, JSON.stringify(body));
    assert.deepEqual(r.body, STEP_UP_REQUIRED, JSON.stringify(body));
  }
  assert.equal(t.db.creds.length, 2);
  assert.equal(t.db.recovery.size, 0);
  assert.equal(t.wa.calls.length, 0, 'no registration options were made');
  assert.equal((await call(t.deps, { action: 'status' })).body.step_up, false);
  // a fresh proof opens them for this session
  t.db.sessions.get(SID)!.stepUp = true;
  assert.equal((await call(t.deps, { action: 'register_options' })).status, 200);
  assert.equal((await call(t.deps, { action: 'rename', id, name: 'x' })).status, 200);
  assert.equal((await call(t.deps, { action: 'recovery_generate' })).status, 200);
  assert.equal((await call(t.deps, { action: 'remove', id })).status, 200);
});

test('step-up: every other refusal keeps the generic body; a setup code and a recovery session are exempt', async () => {
  // not verified at all: generic refusal, not the step-up hint (nothing is revealed)
  const n = setup(); await addCred(n.db, 'c1');
  for (const body of [{ action: 'register_options' }, { action: 'rename', id: n.db.creds[0].id, name: 'x' }, { action: 'recovery_generate' }]) {
    assert.deepEqual((await call(n.deps, body)).body, REFUSED);
  }
  // a recovery session: no step-up for registering, but still no rename/remove/codes (generic refusal)
  const r = setup(); await addCred(r.db, 'c1'); verify(r.db, 'recovery');
  assert.equal((await call(r.deps, { action: 'register_options' })).status, 200);
  assert.deepEqual((await call(r.deps, { action: 'rename', id: r.db.creds[0].id, name: 'x' })).body, REFUSED);
  assert.deepEqual((await call(r.deps, { action: 'recovery_generate' })).body, REFUSED);
  assert.deepEqual((await call(r.deps, { action: 'step_up_options' })).body, REFUSED, 'a recovery session has no passkey proof to give');
  // a founder setup code needs no step-up, even from a passkey session without a fresh proof
  const s = setup(); await addCred(s.db, 'c1'); verify(s.db, 'passkey', ADMIN, SID, false);
  s.db.setupCodes.set(ADMIN, { code: 'ABCDEFGHJKLM', used: false });
  assert.equal((await call(s.deps, { action: 'register_options', setup_code: 'ABCDEFGHJKLM' })).status, 200);
  assert.equal((await call(s.deps, { action: 'register_verify', setup_code: 'ABCDEFGHJKLM', response: { id: 'x' } })).status, 200);
  assert.equal(s.db.setupCodes.get(ADMIN)!.used, true);
});

test('step_up_options / step_up_verify: a fresh assertion with a real passkey sets the 5 minute window', async () => {
  const t = setup(); await addCred(t.db, 'c1'); verify(t.db, 'passkey', ADMIN, SID, false);
  const o = await call(t.deps, { action: 'step_up_options' });
  assert.equal(o.status, 200);
  assert.equal(t.wa.calls[0].opts.userVerification, 'required');
  assert.equal(t.db.challenges.get(`${ADMIN}|${SID}|stepup`), 'auth-challenge-012345678', 'a step-up challenge of its own purpose');
  assert.equal(t.db.challenges.has(`${ADMIN}|${SID}|login`), false);
  const v = await call(t.deps, { action: 'step_up_verify', response: { id: 'c1' } });
  assert.equal(v.status, 200);
  assert.ok(v.body.until);
  assert.equal(t.db.sessions.get(SID)!.stepUp, true);
  assert.equal(t.db.creds[0].counter, 1);
  // single use: the same challenge cannot be used again
  t.db.sessions.get(SID)!.stepUp = false;
  assert.equal((await call(t.deps, { action: 'step_up_verify', response: { id: 'c1' } })).status, 403);
  assert.equal(t.db.sessions.get(SID)!.stepUp, false);
  // a login challenge is not a step-up challenge
  await call(t.deps, { action: 'login_options' });
  assert.equal((await call(t.deps, { action: 'step_up_verify', response: { id: 'c1' } })).status, 403);
});

test('step_up_verify refusals: not verified, bad proof, cloned counter; each is counted', async () => {
  const n = setup(); await addCred(n.db, 'c1');
  assert.deepEqual((await call(n.deps, { action: 'step_up_options' })).body, REFUSED);
  assert.deepEqual((await call(n.deps, { action: 'step_up_verify', response: { id: 'c1' } })).body, REFUSED);
  const bad = setup({ wa: { verifyAuthenticationResponse: async () => ({ verified: false, authenticationInfo: { newCounter: 1 } }) } });
  await addCred(bad.db, 'c1'); verify(bad.db, 'passkey', ADMIN, SID, false);
  await call(bad.deps, { action: 'step_up_options' });
  assert.equal((await call(bad.deps, { action: 'step_up_verify', response: { id: 'c1' } })).status, 403);
  assert.equal(bad.db.sessions.get(SID)!.stepUp, false);
  assert.equal(bad.db.failures.get(ADMIN)?.length, 1);
  const clone = setup({ wa: { verifyAuthenticationResponse: async () => ({ verified: true, authenticationInfo: { newCounter: 0 } }) } });
  await addCred(clone.db, 'c1'); clone.db.creds[0].counter = 4; verify(clone.db, 'passkey', ADMIN, SID, false);
  await call(clone.deps, { action: 'step_up_options' });
  assert.equal((await call(clone.deps, { action: 'step_up_verify', response: { id: 'c1' } })).status, 403);
  assert.equal(clone.db.sessions.get(SID)!.stepUp, false);
  assert.deepEqual(clone.db.notes.at(-1)?.details, { reason: 'counter' });
  // failures carry the session id (per-session lock-out)
  assert.equal(clone.db.calls.filter((c) => c.name === 'pk_note' && c.args.p_kind === 'login_failed').every((c) => c.args.p_session === SID), true);
});

test('recovery_login on a session already verified by a passkey uses no code', async () => {
  const t = setup(); await addCred(t.db); verify(t.db);
  t.db.recovery.set(ADMIN, [{ hash: sha('ABCDEFGHJKLMNPQR'), used: false }]);
  const r = await call(t.deps, { action: 'recovery_login', code: 'ABCD-EFGH-JKLM-NPQR' });
  assert.equal(r.status, 200);
  assert.equal(r.body.session.via, 'passkey');
  assert.equal(t.db.recovery.get(ADMIN)![0].used, false);
  assert.equal(t.db.calls.filter((c) => c.name === 'pk_use_recovery_code').length, 0);
});

test('recovery_login: the database starts the session with the code (one call), the handler adds no second step', async () => {
  const t = setup(); await addCred(t.db);
  t.db.recovery.set(ADMIN, [{ hash: sha('ABCDEFGHJKLMNPQR'), used: false }]);
  const r = await call(t.deps, { action: 'recovery_login', code: 'abcd efgh jklm npqr' });
  assert.equal(r.status, 200);
  assert.equal(r.body.session.via, 'recovery');
  assert.equal(t.db.calls.filter((c) => c.name === 'pk_start_session').length, 0, 'no separate session call that could fail after the code was used');
  assert.equal(t.db.calls.find((c) => c.name === 'pk_use_recovery_code')!.args.p_session, SID);
});

test('register_verify never sends an empty setup code to the database', async () => {
  const t = setup(); verify(t.db);
  await call(t.deps, { action: 'register_options' });
  const r = await call(t.deps, { action: 'register_verify', response: { id: 'x' }, setup_code: '' });
  assert.equal(r.status, 200);
  assert.equal(t.db.calls.find((c) => c.name === 'pk_add_credential')!.args.p_setup_code, null);
});
