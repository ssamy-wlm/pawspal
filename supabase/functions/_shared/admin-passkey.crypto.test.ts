// A real cryptographic round trip: the REAL @simplewebauthn/server library against a software authenticator written here with
// node:crypto (P-256 key, "none" attestation, authenticator data with the UP and UV flags, ECDSA assertions). The database is the
// in-memory stand-in (test-passkey-db.ts), the handler is the real one. Needs `npm ci` in supabase/functions (CI does it).
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import * as webauthn from '@simplewebauthn/server';
import { envFrom } from './config.ts';
import { b64urlDecode, b64urlEncode, handleAdminPasskey, type AdminPasskeyDeps } from './handlers/admin-passkey.ts';
import { FakePasskeyDb } from './test-passkey-db.ts';

const logged: string[] = [];
for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  (console as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { logged.push(a.join(' ')); };
}
test.afterEach(() => { assert.deepEqual(logged.splice(0), [], 'the function printed to the log'); });

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RP_ID = 'pawspal.test';
const ORIGIN = 'https://admin.pawspal.test';
const CODE = 'ABCDEFGHJKLM';

// ---------------------------------------------------------------- a tiny CBOR writer (just what the attestation needs)
type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor>;
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b;
}
function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();
const UP = 0x01, UV = 0x04, BE = 0x08, BS = 0x10, AT = 0x40;

interface Flags { uv?: boolean; up?: boolean; synced?: boolean }
const flagByte = (f: Flags, extra = 0) => (f.up === false ? 0 : UP) | (f.uv === false ? 0 : UV) | (f.synced ? BE | BS : 0) | extra;

/** A software passkey. */
class SoftAuthenticator {
  privateKey: KeyObject;
  x: Buffer; y: Buffer;
  credId = randomBytes(32);
  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.x = Buffer.from(jwk.x!, 'base64url'); this.y = Buffer.from(jwk.y!, 'base64url');
  }
  get id() { return b64urlEncode(this.credId); }
  get coseKey() {
    return cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, this.x], [-3, this.y]]));
  }
  /** navigator.credentials.create(): a "none" attestation. */
  create(challenge: string, o: { origin?: string; rpId?: string; counter?: number } & Flags = {}) {
    const rpIdHash = sha256(o.rpId ?? RP_ID);
    const counter = Buffer.alloc(4); counter.writeUInt32BE(o.counter ?? 0);
    const credLen = Buffer.alloc(2); credLen.writeUInt16BE(this.credId.length);
    const authData = Buffer.concat([rpIdHash, Buffer.from([flagByte(o, AT)]), counter, Buffer.alloc(16), credLen, this.credId, this.coseKey]);
    const clientData = JSON.stringify({ type: 'webauthn.create', challenge, origin: o.origin ?? ORIGIN, crossOrigin: false });
    const attestationObject = cbor(new Map<Cbor, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return {
      id: this.id, rawId: this.id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
      response: { clientDataJSON: b64urlEncode(Buffer.from(clientData)), attestationObject: b64urlEncode(attestationObject), transports: ['internal'] },
    };
  }
  /** navigator.credentials.get(): an assertion signed over authData || sha256(clientDataJSON). */
  get(challenge: string, o: { origin?: string; rpId?: string; counter: number; type?: string; key?: KeyObject } & Flags) {
    const counter = Buffer.alloc(4); counter.writeUInt32BE(o.counter);
    const authData = Buffer.concat([sha256(o.rpId ?? RP_ID), Buffer.from([flagByte(o)]), counter]);
    const clientData = Buffer.from(JSON.stringify({ type: o.type ?? 'webauthn.get', challenge, origin: o.origin ?? ORIGIN, crossOrigin: false }));
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), o.key ?? this.privateKey);
    return {
      id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64urlEncode(clientData), authenticatorData: b64urlEncode(authData), signature: b64urlEncode(signature), userHandle: b64urlEncode(randomBytes(32)) },
    };
  }
}

// ---------------------------------------------------------------- harness
function harness() {
  const db = new FakePasskeyDb([ADMIN, OTHER]);
  db.setupCodes.set(ADMIN, { code: CODE, used: false });
  const deps = (session: string, user = ADMIN): AdminPasskeyDeps => ({
    authUser: async () => ({ id: user, sessionId: session }),
    rpc: db.rpc, webauthn,
    env: envFrom({ ADMIN_RP_ID: RP_ID, ADMIN_ORIGIN: ORIGIN, ADMIN_RP_NAME: 'PawsPal admin' }),
    random: (n) => new Uint8Array(randomBytes(n)), now: () => Date.now(),
  });
  const call = async (session: string, body: unknown, user = ADMIN) => {
    const res = await handleAdminPasskey(new Request('https://f.test/admin-passkey', {
      method: 'POST', headers: { Authorization: 'Bearer t', Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), deps(session, user));
    return { status: res.status, body: (await res.json()) as any };
  };
  /** register_options + register_verify with the software authenticator. */
  const enrol = async (auth: SoftAuthenticator, session = SESSION_A, flags: Parameters<SoftAuthenticator['create']>[1] = {}) => {
    const opts = await call(session, { action: 'register_options', setup_code: CODE });
    assert.equal(opts.status, 200, 'register_options');
    return call(session, { action: 'register_verify', setup_code: CODE, name: 'Test key', response: auth.create(opts.body.options.challenge, flags) });
  };
  /** login_options and the assertion for it. */
  const challengeFor = async (session: string, user = ADMIN) => {
    const o = await call(session, { action: 'login_options' }, user);
    assert.equal(o.status, 200, 'login_options');
    return o.body.options as { challenge: string; rpId: string; allowCredentials: { id: string }[]; userVerification: string };
  };
  return { db, call, enrol, challengeFor };
}

// ---------------------------------------------------------------- the round trip
test('register -> login -> counter bump with a real passkey (real library)', async () => {
  const { db, call, enrol, challengeFor } = harness();
  const auth = new SoftAuthenticator();

  // the options ask for what we require
  const opts = await call(SESSION_A, { action: 'register_options', setup_code: CODE });
  assert.equal(opts.body.options.rp.id, RP_ID);
  assert.equal(opts.body.options.attestation, 'none');
  assert.equal(opts.body.options.authenticatorSelection.userVerification, 'required');
  assert.equal(opts.body.options.authenticatorSelection.residentKey, 'preferred');
  assert.ok(opts.body.options.challenge.length >= 43, '32 random bytes');

  // register
  const reg = await call(SESSION_A, { action: 'register_verify', setup_code: CODE, name: 'Test key', response: auth.create(opts.body.options.challenge, { synced: true }) });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  assert.equal(reg.body.passkey.name, 'Test key');
  assert.equal(db.creds.length, 1);
  assert.equal(db.creds[0].credential_id, auth.id);
  assert.equal(db.creds[0].device_type, 'multiDevice');
  assert.equal(db.creds[0].backed_up, true);
  assert.deepEqual(b64urlDecode(db.creds[0].public_key), new Uint8Array(auth.coseKey), 'the COSE public key was stored');
  assert.equal(db.setupCodes.get(ADMIN)!.used, true);
  assert.equal(db.sessions.get(SESSION_A)?.via, 'passkey', 'registering opens the session');

  // a second browser session logs in with the passkey
  assert.equal((await call(SESSION_B, { action: 'status' })).body.status, 'needs_passkey');
  const c1 = await challengeFor(SESSION_B);
  assert.equal(c1.rpId, RP_ID);
  assert.equal(c1.userVerification, 'required');
  assert.deepEqual(c1.allowCredentials.map((c) => c.id), [auth.id]);
  const a1 = auth.get(c1.challenge, { counter: 1, synced: true });
  const l1 = await call(SESSION_B, { action: 'login_verify', response: a1 });
  assert.equal(l1.status, 200, JSON.stringify(l1.body));
  assert.equal(db.creds[0].counter, 1);
  assert.equal(db.sessions.get(SESSION_B)?.via, 'passkey');
  assert.equal((await call(SESSION_B, { action: 'status' })).body.status, 'admin');

  // again: the counter moves on
  const c2 = await challengeFor(SESSION_B);
  assert.equal((await call(SESSION_B, { action: 'login_verify', response: auth.get(c2.challenge, { counter: 2 }) })).status, 200);
  assert.equal(db.creds[0].counter, 2);

  // replay of the very same assertion: its challenge is used up
  const replay = await call(SESSION_B, { action: 'login_verify', response: auth.get(c2.challenge, { counter: 3 }) });
  assert.equal(replay.status, 403);
  assert.deepEqual(replay.body, { error: 'not_allowed' });
  // an old challenge replayed after a new one was asked for
  const c3 = await challengeFor(SESSION_B);
  const c4 = await challengeFor(SESSION_B);
  assert.notEqual(c3.challenge, c4.challenge);
  assert.equal((await call(SESSION_B, { action: 'login_verify', response: auth.get(c3.challenge, { counter: 3 }) })).status, 403);
  assert.equal(db.creds[0].counter, 2, 'a refused login does not move the counter');

  // clone detection: the counter does not grow
  db.failures.clear();
  const c5 = await challengeFor(SESSION_B);
  assert.equal((await call(SESSION_B, { action: 'login_verify', response: auth.get(c5.challenge, { counter: 2 }) })).status, 403, 'same counter');
  const c6 = await challengeFor(SESSION_B);
  assert.equal((await call(SESSION_B, { action: 'login_verify', response: auth.get(c6.challenge, { counter: 1 }) })).status, 403, 'lower counter');
  const c7 = await challengeFor(SESSION_B);
  assert.equal((await call(SESSION_B, { action: 'login_verify', response: auth.get(c7.challenge, { counter: 9 }) })).status, 200, 'a jump forward is fine');
  assert.equal(db.creds[0].counter, 9);
});

test('a passkey that always reports counter 0 (synced) keeps working', async () => {
  const { db, call, enrol, challengeFor } = harness();
  const auth = new SoftAuthenticator();
  assert.equal((await enrol(auth, SESSION_A, { synced: true })).status, 200);
  for (const s of [SESSION_B, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']) {
    const c = await challengeFor(s);
    assert.equal((await call(s, { action: 'login_verify', response: auth.get(c.challenge, { counter: 0, synced: true }) })).status, 200);
  }
  assert.equal(db.creds[0].counter, 0);
});

test('user verification missing: refused at login and at registration', async () => {
  const { db, call, enrol, challengeFor } = harness();
  const auth = new SoftAuthenticator();
  // registration without UV
  const noUv = await enrol(auth, SESSION_A, { uv: false });
  assert.equal(noUv.status, 403);
  assert.equal(db.creds.length, 0, 'nothing was saved');
  assert.equal(db.setupCodes.get(ADMIN)!.used, false, 'a refused registration does not burn the setup code');
  // a good registration, then an assertion without UV
  assert.equal((await enrol(auth, SESSION_A)).status, 200);
  const c = await challengeFor(SESSION_B);
  const r = await call(SESSION_B, { action: 'login_verify', response: auth.get(c.challenge, { counter: 1, uv: false }) });
  assert.equal(r.status, 403);
  assert.equal(db.sessions.has(SESSION_B), false);
  // and presence missing
  const c2 = await challengeFor(SESSION_B);
  assert.equal((await call(SESSION_B, { action: 'login_verify', response: auth.get(c2.challenge, { counter: 1, up: false, uv: false }) })).status, 403);
  // the same assertion with UV is fine
  const c3 = await challengeFor(SESSION_B);
  assert.equal((await call(SESSION_B, { action: 'login_verify', response: auth.get(c3.challenge, { counter: 1 }) })).status, 200);
});

test('wrong origin, wrong RP ID, wrong key, wrong type and wrong challenge are all refused', async () => {
  const { db, call, enrol, challengeFor } = harness();
  const auth = new SoftAuthenticator();
  // registration at a wrong origin / for a wrong RP
  assert.equal((await enrol(auth, SESSION_A, { origin: 'https://evil.pawspal.test' })).status, 403);
  assert.equal((await enrol(auth, SESSION_A, { origin: 'https://admin.pawspal.test:8443' })).status, 403);
  assert.equal((await enrol(auth, SESSION_A, { rpId: 'evil.test' })).status, 403);
  assert.equal(db.creds.length, 0);
  db.failures.clear();
  assert.equal((await enrol(auth, SESSION_A)).status, 200);

  const tries: [string, Parameters<SoftAuthenticator['get']>[1]][] = [
    ['wrong origin', { counter: 1, origin: 'https://evil.pawspal.test' }],
    ['phishing origin', { counter: 1, origin: 'https://admin.pawspal.test.evil.example' }],
    ['wrong rp id', { counter: 1, rpId: 'evil.test' }],
    ['wrong key', { counter: 1, key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey }],
    ['wrong type', { counter: 1, type: 'webauthn.create' }],
  ];
  db.failures.clear();
  for (const [why, o] of tries) {
    const c = await challengeFor(SESSION_B);
    const r = await call(SESSION_B, { action: 'login_verify', response: auth.get(c.challenge, o) });
    assert.equal(r.status, 403, why);
    assert.deepEqual(r.body, { error: 'not_allowed' }, why);
    assert.equal(db.sessions.has(SESSION_B), false, why);
  }
  db.failures.clear();
  // an answer to a challenge the server never issued
  await challengeFor(SESSION_B);
  assert.equal((await call(SESSION_B, { action: 'login_verify', response: auth.get(b64urlEncode(randomBytes(32)), { counter: 1 }) })).status, 403, 'another challenge');
  // the right answer, finally (after the lock-out window of this session is cleared)
  db.failures.clear();
  const ok = await challengeFor(SESSION_B);
  assert.equal((await call(SESSION_B, { action: 'login_verify', response: auth.get(ok.challenge, { counter: 1 }) })).status, 200);
  assert.ok(db.notes.filter((n) => n.kind === 'login_failed').length >= tries.length, 'each refusal was written to the audit trail');
});

test("one admin's passkey cannot log in another admin, and a registration cannot be replayed", async () => {
  const { db, call, enrol, challengeFor } = harness();
  const mine = new SoftAuthenticator();
  assert.equal((await enrol(mine, SESSION_A)).status, 200);
  // the other admin has a passkey of their own; Ada's credential id is not found for them
  db.setupCodes.set(OTHER, { code: 'MNPQRSTUVWXY', used: false });
  const theirs = new SoftAuthenticator();
  const o = await call(SESSION_B, { action: 'register_options', setup_code: 'MNPQRSTUVWXY' }, OTHER);
  assert.equal((await call(SESSION_B, { action: 'register_verify', setup_code: 'MNPQRSTUVWXY', response: theirs.create(o.body.options.challenge) }, OTHER)).status, 200);
  const c = await challengeFor('dddddddd-dddd-4ddd-8ddd-dddddddddddd', OTHER);
  const r = await call('dddddddd-dddd-4ddd-8ddd-dddddddddddd', { action: 'login_verify', response: mine.get(c.challenge, { counter: 1 }) }, OTHER);
  assert.equal(r.status, 403);
  // replaying a finished registration (same response, same code) is refused: the challenge is single use
  const opts = await call('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', { action: 'register_options', setup_code: CODE }, ADMIN);
  assert.equal(opts.status, 403, 'the setup code is used up, so no new registration is offered');
  void db;
});

test('registering twice with the same authenticator is refused (excluded and unique)', async () => {
  const { db, call } = harness();
  const auth = new SoftAuthenticator();
  const verified = async (session: string) => { db.sessions.set(session, { user: ADMIN, via: 'passkey', minutes: 480, stepUp: true }); };
  await verified(SESSION_A);
  const o1 = await call(SESSION_A, { action: 'register_options' });
  assert.equal((await call(SESSION_A, { action: 'register_verify', response: auth.create(o1.body.options.challenge) })).status, 200);
  const o2 = await call(SESSION_A, { action: 'register_options' });
  assert.deepEqual(o2.body.options.excludeCredentials.map((c: { id: string }) => c.id), [auth.id], 'the browser is told not to offer the same device again');
  const dup = await call(SESSION_A, { action: 'register_verify', response: auth.create(o2.body.options.challenge) });
  assert.equal(dup.status, 409);
  assert.equal(db.creds.length, 1);
});

test('recovery code round trip: generate, use once, lock after five wrong', async () => {
  const { db, call, enrol } = harness();
  const auth = new SoftAuthenticator();
  assert.equal((await enrol(auth, SESSION_A)).status, 200);
  const codes = (await call(SESSION_A, { action: 'recovery_generate' })).body.codes as string[];
  assert.equal(codes.length, 10);
  const r = await call(SESSION_B, { action: 'recovery_login', code: codes[4].replace(/-/g, '').toLowerCase() });
  assert.equal(r.status, 200);
  assert.equal(r.body.session.via, 'recovery');
  assert.equal((await call(SESSION_B, { action: 'recovery_generate' })).status, 403, 'a recovery session cannot make codes');
  assert.equal((await call(SESSION_B, { action: 'recovery_login', code: codes[4] })).status, 403, 'single use');
  for (let i = 0; i < 4; i++) await call(SESSION_B, { action: 'recovery_login', code: 'ZZZZ-ZZZZ-ZZZZ-ZZZ' + i });
  assert.equal((await call(SESSION_B, { action: 'recovery_login', code: codes[5] })).status, 429);
  assert.equal(db.recovery.get(ADMIN)!.filter((x) => x.used).length, 1);
});

test('the library version the function runs (Deno import) is the one these tests run against (package.json)', () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const entry = readFileSync(new URL('admin-passkey/index.ts', root), 'utf8');
  const m = /npm:@simplewebauthn\/server@(\d+\.\d+\.\d+)'/.exec(entry);
  assert.ok(m, 'the entry point imports an exact version');
  assert.equal(pkg.devDependencies['@simplewebauthn/server'], m[1], 'package.json and the Deno import must name the same exact version');
  assert.equal(JSON.parse(readFileSync(new URL('node_modules/@simplewebauthn/server/package.json', root), 'utf8')).version, m[1], 'the installed copy matches');
});

test('step-up with a real passkey: sensitive actions need a fresh assertion (real library)', async () => {
  const { db, call, enrol, challengeFor } = harness();
  const auth = new SoftAuthenticator();
  assert.equal((await enrol(auth, SESSION_A)).status, 200);
  const extra = new SoftAuthenticator();
  // a second session logs in: that proof is fresh, so a device can be added right away
  const c = await challengeFor(SESSION_B);
  assert.equal((await call(SESSION_B, { action: 'login_verify', response: auth.get(c.challenge, { counter: 1 }) })).status, 200);
  assert.equal((await call(SESSION_B, { action: 'status' })).body.step_up, true);
  // five minutes later (a stolen token): nothing sensitive works
  db.sessions.get(SESSION_B)!.stepUp = false;
  const id = db.creds[0].id;
  for (const body of [{ action: 'register_options' }, { action: 'rename', id, name: 'x' }, { action: 'remove', id }, { action: 'recovery_generate' }]) {
    const r = await call(SESSION_B, body);
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'step_up_required' });
  }
  // the login challenge is not a step-up challenge; UV missing is refused; a wrong key is refused
  const login = await challengeFor(SESSION_B);
  assert.equal((await call(SESSION_B, { action: 'step_up_verify', response: auth.get(login.challenge, { counter: 2 }) })).status, 403, 'wrong purpose');
  const s1 = await call(SESSION_B, { action: 'step_up_options' });
  assert.equal(s1.status, 200);
  assert.equal((await call(SESSION_B, { action: 'step_up_verify', response: auth.get(s1.body.options.challenge, { counter: 2, uv: false }) })).status, 403, 'no user verification');
  const s2 = await call(SESSION_B, { action: 'step_up_options' });
  assert.equal((await call(SESSION_B, { action: 'step_up_verify', response: auth.get(s2.body.options.challenge, { counter: 2, key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey }) })).status, 403, 'wrong key');
  assert.equal(db.sessions.get(SESSION_B)!.stepUp, false);
  // a real fresh assertion works once and unlocks the actions
  const s3 = await call(SESSION_B, { action: 'step_up_options' });
  const proof = auth.get(s3.body.options.challenge, { counter: 2 });
  const ok = await call(SESSION_B, { action: 'step_up_verify', response: proof });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await call(SESSION_B, { action: 'step_up_verify', response: proof })).status, 403, 'the same proof cannot be replayed');
  db.failures.clear();
  // now a new device can be added with the fresh proof
  const reg = await call(SESSION_B, { action: 'register_options', name: 'Second' });
  assert.equal(reg.status, 200);
  assert.equal((await call(SESSION_B, { action: 'register_verify', name: 'Second', response: extra.create(reg.body.options.challenge) })).status, 200);
  assert.equal(db.creds.length, 2);
  assert.equal((await call(SESSION_B, { action: 'rename', id, name: 'Renamed' })).status, 200);
  assert.equal((await call(SESSION_B, { action: 'recovery_generate' })).status, 200);
  // a step-up proof in one session does not unlock another session
  assert.equal((await call(SESSION_A, { action: 'status' })).body.step_up, true, 'session A kept its own fresh registration proof');
  db.sessions.get(SESSION_A)!.stepUp = false;
  assert.equal((await call(SESSION_A, { action: 'rename', id, name: 'x' })).body.error, 'step_up_required');
});
