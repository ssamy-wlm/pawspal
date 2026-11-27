import test from 'node:test';
import assert from 'node:assert/strict';
import { envFrom } from './config.ts';
import type { Rpc } from './http.ts';
import { handleDeleteAccount, type DeleteAccountDeps } from './handlers/delete-account.ts';
import { handleExportMyData } from './handlers/export-my-data.ts';
import { handlePurgeAccounts } from './handlers/purge-accounts.ts';
import { handleSendNotifications, MAX_PER_REQUEST, MAX_ROWS } from './handlers/send-notifications.ts';
import { expoSender, EXPO_PUSH_URL, type PushMessage, type PushResult, type PushSender } from './push/expo.ts';

const UID = '11111111-2222-3333-4444-555555555555';
type Call = { name: string; args: Record<string, unknown> };
function fakeRpc(handlers: Record<string, (a: Record<string, unknown>) => unknown> = {}, log: string[] = []) {
  const calls: Call[] = [];
  const rpc: Rpc = async (name, args) => {
    calls.push({ name, args }); log.push(`rpc:${name}`);
    const h = handlers[name];
    if (!h) return { data: null, error: null };
    const out = h(args);
    return out instanceof Error ? { data: null, error: { message: out.message } } : { data: out, error: null };
  };
  return { rpc, calls };
}
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://f.test/x', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const bearer = { Authorization: 'Bearer tok' };

// Nothing may print: passwords, tokens and text must never reach a log.
const logged: string[] = [];
for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) (console as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { logged.push(a.join(' ')); };
test.afterEach(() => { assert.deepEqual(logged.splice(0), [], 'a function printed to the log'); });

// ---------------------------------------------------------------- delete-account
function delDeps(over: Partial<DeleteAccountDeps> = {}, handlers: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  const log: string[] = [];
  const { rpc, calls } = fakeRpc({
    deletion_attempts_blocked: () => false,
    close_account: () => ({ status: 'closed', purge_after: '2026-12-27T00:00:00Z' }),
    list_user_files: () => [{ bucket_id: 'pets', name: `${UID}/a.jpg` }, { bucket_id: 'faces', name: `${UID}/f.jpg` }, { bucket_id: 'pets', name: 'someone-else/x.jpg' }],
    ...handlers,
  }, log);
  const removed: string[] = [];
  const deps: DeleteAccountDeps = {
    authUser: async () => ({ id: UID, email: 'a@example.com' }),
    rpc,
    verifyPassword: async (e, p) => { log.push('password'); return p === 'right-password'; },
    signOutEverywhere: async () => { log.push('signout'); },
    banUser: async () => { log.push('ban'); return true; },
    removeFiles: async (b, n) => { log.push('files'); removed.push(...n.map((x) => `${b}/${x}`)); return true; },
    ...over,
  };
  return { deps, log, calls, removed };
}

test('delete-account: signed-in people only, POST only, a password is required', async () => {
  const { deps } = delDeps();
  assert.equal((await handleDeleteAccount(new Request('https://f.test/x'), deps)).status, 405);
  assert.equal((await handleDeleteAccount(post({ password: 'x' }), deps)).status, 401);
  assert.equal((await handleDeleteAccount(post({ password: 'x' }, bearer), { ...deps, authUser: async () => null })).status, 401);
  for (const b of [{}, { password: '' }, { password: 5 }, { password: 'x'.repeat(201) }, 'nope']) assert.equal((await handleDeleteAccount(post(b, bearer), deps)).status, 400);
});

test('delete-account: a wrong password is refused, counted, and nothing is closed', async () => {
  const { deps, log, calls } = delDeps();
  const res = await handleDeleteAccount(post({ password: 'wrong' }, bearer), deps);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'wrong_password' });
  assert.ok(calls.some((c) => c.name === 'note_deletion_failure' && c.args.p_user === UID));
  assert.ok(!calls.some((c) => c.name === 'close_account'));
  assert.ok(!log.includes('ban'));
  assert.ok(!JSON.stringify(calls).includes('wrong'), 'the password reached the database');
});

test('delete-account: five wrong tries an hour block, before the password is looked at', async () => {
  const { deps, log } = delDeps({}, { deletion_attempts_blocked: () => true });
  const res = await handleDeleteAccount(post({ password: 'right-password' }, bearer), deps);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'too_many_attempts' });
  assert.ok(!log.includes('password'));
});

test('delete-account: a password check that cannot run is a 502, not a refusal', async () => {
  const { deps, calls } = delDeps({ verifyPassword: async () => { throw new Error('down'); } });
  assert.equal((await handleDeleteAccount(post({ password: 'x' }, bearer), deps)).status, 502);
  assert.ok(!calls.some((c) => c.name === 'note_deletion_failure' || c.name === 'close_account'));
});

test('delete-account: admins and people with an open booking are refused with their own codes', async () => {
  for (const [status, code, http] of [['admin', 'admin_account', 403], ['active_booking', 'active_booking', 409]] as const) {
    const { deps, log } = delDeps({}, { close_account: () => ({ status }) });
    const res = await handleDeleteAccount(post({ password: 'right-password' }, bearer), deps);
    assert.equal(res.status, http);
    assert.deepEqual(await res.json(), { error: code });
    assert.ok(!log.includes('ban') && !log.includes('files'), 'a refused deletion cut the account');
  }
});

test('delete-account: success runs in order: password, database, sessions, ban, files; only own files', async () => {
  const { deps, log, removed, calls } = delDeps();
  const res = await handleDeleteAccount(post({ password: 'right-password' }, bearer), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, purge_after: '2026-12-27T00:00:00Z' });
  assert.deepEqual(log, ['rpc:deletion_attempts_blocked', 'password', 'rpc:close_account', 'signout', 'ban', 'rpc:list_user_files', 'files', 'files']);
  assert.deepEqual(removed.sort(), [`faces/${UID}/f.jpg`, `pets/${UID}/a.jpg`]);
  assert.deepEqual(calls.find((c) => c.name === 'close_account')!.args, { p_user: UID });      // the id comes from the token
});

test('delete-account: if the ban fails the person can retry, and a retry finishes the steps', async () => {
  const failing = delDeps({ banUser: async () => false });
  assert.equal((await handleDeleteAccount(post({ password: 'right-password' }, bearer), failing.deps)).status, 502);
  const retry = delDeps({}, { close_account: () => ({ status: 'already_closed', purge_after: null }) });
  const res = await handleDeleteAccount(post({ password: 'right-password' }, bearer), retry.deps);
  assert.equal(res.status, 200);
  assert.ok(retry.log.includes('ban'));
});

test('delete-account: a failing file delete or database error does not hide the outcome', async () => {
  const files = delDeps({ removeFiles: async () => { throw new Error('x'); } });
  assert.equal((await handleDeleteAccount(post({ password: 'right-password' }, bearer), files.deps)).status, 200);
  const db = delDeps({}, { close_account: () => new Error('db') });
  assert.equal((await handleDeleteAccount(post({ password: 'right-password' }, bearer), db.deps)).status, 502);
  assert.ok(!db.log.includes('ban'));
});

// ---------------------------------------------------------------- export-my-data
test('export-my-data: shape, links only for own files, and the caller id comes from the token', async () => {
  const signed: string[] = [];
  const { rpc, calls } = fakeRpc({
    note_data_export: () => true,
    export_user_data: () => ({ profile: { id: UID }, pets: [], files: [
      { kind: 'face', bucket: 'faces', path: `${UID}/me.jpg` }, { kind: 'pet', bucket: 'pets', path: `${UID}/p/1.jpg` },
      { kind: 'face', bucket: 'faces', path: 'other-user/x.jpg' }, { kind: 'pet', bucket: 'pets', path: `${UID}/../other/x.jpg` },
      { kind: 'id', bucket: 'ids', path: `${UID}/id.jpg` }, { kind: 'pet', bucket: 'pets' }] }),
  });
  const res = await handleExportMyData(post('', bearer), {
    authUser: async () => ({ id: UID }), rpc, now: () => new Date('2026-11-27T10:00:00Z'),
    urls: { async signedUrl(b, p, s) { signed.push(`${b}/${p}/${s}`); return `https://signed.test/${b}/${p}`; } },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.exported_at, '2026-11-27T10:00:00.000Z');
  assert.deepEqual(body.data, { profile: { id: UID }, pets: [] });            // the file list is not part of the data
  assert.deepEqual(body.files, [{ kind: 'face', name: 'me.jpg', url: `https://signed.test/faces/${UID}/me.jpg` }, { kind: 'pet', name: 'p/1.jpg', url: `https://signed.test/pets/${UID}/p/1.jpg` }]);
  assert.deepEqual(signed, [`faces/${UID}/me.jpg/3600`, `pets/${UID}/p/1.jpg/3600`]);
  assert.deepEqual(calls.find((c) => c.name === 'export_user_data')!.args, { p_user: UID });
});

test('export-my-data: three a day, signed-in only, POST only, and database trouble', async () => {
  const urls = { async signedUrl() { return null; } };
  const limited = fakeRpc({ note_data_export: () => false });
  const res = await handleExportMyData(post('', bearer), { authUser: async () => ({ id: UID }), rpc: limited.rpc, urls });
  assert.equal(res.status, 429);
  assert.ok(!limited.calls.some((c) => c.name === 'export_user_data'));
  assert.equal((await handleExportMyData(post(''), { authUser: async () => ({ id: UID }), rpc: limited.rpc, urls })).status, 401);
  assert.equal((await handleExportMyData(new Request('https://f.test/x'), { authUser: async () => ({ id: UID }), rpc: limited.rpc, urls })).status, 405);
  const broken = fakeRpc({ note_data_export: () => true, export_user_data: () => new Error('x') });
  assert.equal((await handleExportMyData(post('', bearer), { authUser: async () => ({ id: UID }), rpc: broken.rpc, urls })).status, 502);
  const none = fakeRpc({ note_data_export: () => true, export_user_data: () => null });
  assert.equal((await handleExportMyData(post('', bearer), { authUser: async () => ({ id: UID }), rpc: none.rpc, urls })).status, 404);
});

// ---------------------------------------------------------------- purge-accounts
test('purge-accounts: needs the secret, deletes the leftover files, returns counts only', async () => {
  const secret = 'x'.repeat(30);
  const removed: string[] = [];
  const mk = (env: Record<string, string | undefined>) => ({
    env: envFrom(env),
    rpc: fakeRpc({ purge_deleted_accounts: () => ({ purged: 2, files: [{ bucket: 'pets', name: 'u/a.jpg' }, { bucket: 'evil', name: 'u/b.jpg' }], messages_deleted: 3, stubs_deleted: 1 }) }).rpc,
    removeMany: async (b: string, n: string[]) => { removed.push(...n.map((x) => `${b}/${x}`)); return true; },
  });
  assert.equal((await handlePurgeAccounts(post({}, { 'x-cleanup-secret': secret }), mk({}))).status, 503);
  assert.equal((await handlePurgeAccounts(post({}, { 'x-cleanup-secret': 'nope' }), mk({ CLEANUP_SECRET: secret }))).status, 401);
  const res = await handlePurgeAccounts(post({}, { 'x-cleanup-secret': secret }), mk({ CLEANUP_SECRET: secret }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { purged: 2, files_removed: 1, files_failed: 0, messages_deleted: 3, conversations_deleted: 0, bookings_deleted: 0, stubs_deleted: 1 });
  assert.deepEqual(removed, ['pets/u/a.jpg']);
  const bad = await handlePurgeAccounts(post({}, { 'x-cleanup-secret': secret }), { ...mk({ CLEANUP_SECRET: secret }), rpc: fakeRpc({ purge_deleted_accounts: () => new Error('x') }).rpc });
  assert.equal(bad.status, 502);
});

// ---------------------------------------------------------------- send-notifications
const SECRET = 's'.repeat(30);
const H = { 'x-notifications-secret': SECRET };
function row(id: number, tokens: string[]) { return { id, title: 'PawsPal', body: 'You have a new message', data: { type: 'message', id: 'c1' }, tokens }; }
function fakeSender(fn: (m: PushMessage[]) => PushResult[] | Error = (m) => m.map(() => ({ ok: true }))) {
  const sent: PushMessage[][] = [];
  const sender: PushSender = { async send(m) { sent.push(m); const r = fn(m); if (r instanceof Error) throw r; return r; } };
  return { sender, sent };
}
const tk = (n: number) => `ExponentPushToken[t${n}]`;

test('send-notifications: secret, method, and the switch', async () => {
  const f = fakeSender();
  const rpc = fakeRpc({ push_is_enabled: () => false });
  assert.equal((await handleSendNotifications(post({}, H), { env: envFrom({}), rpc: rpc.rpc, sender: f.sender })).status, 503);
  assert.equal((await handleSendNotifications(post({}, { 'x-notifications-secret': 'wrong' }), { env: envFrom({ NOTIFICATIONS_SECRET: SECRET }), rpc: rpc.rpc, sender: f.sender })).status, 401);
  assert.equal((await handleSendNotifications(new Request('https://f.test/x'), { env: envFrom({ NOTIFICATIONS_SECRET: SECRET }), rpc: rpc.rpc, sender: f.sender })).status, 405);
  assert.equal(rpc.calls.length, 0, 'the database was asked without the secret');
  const res = await handleSendNotifications(post({}, H), { env: envFrom({ NOTIFICATIONS_SECRET: SECRET }), rpc: rpc.rpc, sender: f.sender });
  assert.deepEqual(await res.json(), { enabled: false, sent: 0, failed: 0, removed_tokens: 0 });
  assert.equal(f.sent.length, 0, 'something was sent with the switch off');
  assert.ok(!rpc.calls.some((c) => c.name === 'claim_notifications'), 'rows were taken with the switch off');
});

test('send-notifications: generic payload per device, DeviceNotRegistered removes the token, rows are finished', async () => {
  const f = fakeSender((m) => m.map((x) => x.to === tk(2) ? { ok: false, error: 'DeviceNotRegistered' } : { ok: true }));
  const rpc = fakeRpc({ push_is_enabled: () => true, claim_notifications: () => [row(1, [tk(1), tk(2)]), row(2, [tk(3)]), row(3, [])], remove_push_tokens: () => 1, finish_notifications: () => 3 });
  const res = await handleSendNotifications(post({}, H), { env: envFrom({ NOTIFICATIONS_SECRET: SECRET }), rpc: rpc.rpc, sender: f.sender });
  assert.deepEqual(await res.json(), { enabled: true, sent: 2, failed: 0, removed_tokens: 1 });
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0].map((m) => m.to), [tk(1), tk(2), tk(3)]);
  for (const m of f.sent[0]) assert.deepEqual({ title: m.title, body: m.body, data: m.data }, { title: 'PawsPal', body: 'You have a new message', data: { type: 'message', id: 'c1' } });
  assert.deepEqual(rpc.calls.find((c) => c.name === 'remove_push_tokens')!.args, { p_tokens: [tk(2)] });
  assert.deepEqual(rpc.calls.find((c) => c.name === 'finish_notifications')!.args, { p_ids: [1, 2, 3] });
});

test('send-notifications: a failing service keeps the rows queued (the database delays the retry), others still finish', async () => {
  const f = fakeSender((m) => m.map((x) => x.to === tk(1) ? { ok: false, error: 'MessageRateExceeded' } : { ok: true }));
  const rpc = fakeRpc({ push_is_enabled: () => true, claim_notifications: () => [row(1, [tk(1)]), row(2, [tk(2)])], finish_notifications: () => 1 });
  const res = await handleSendNotifications(post({}, H), { env: envFrom({ NOTIFICATIONS_SECRET: SECRET }), rpc: rpc.rpc, sender: f.sender });
  assert.deepEqual(await res.json(), { enabled: true, sent: 1, failed: 1, removed_tokens: 0 });
  assert.deepEqual(rpc.calls.find((c) => c.name === 'finish_notifications')!.args, { p_ids: [2] });
  const down = fakeSender(() => new Error('network'));
  const rpc2 = fakeRpc({ push_is_enabled: () => true, claim_notifications: () => [row(1, [tk(1)])] });
  const res2 = await handleSendNotifications(post({}, H), { env: envFrom({ NOTIFICATIONS_SECRET: SECRET }), rpc: rpc2.rpc, sender: down.sender });
  assert.deepEqual(await res2.json(), { enabled: true, sent: 0, failed: 1, removed_tokens: 0 });
  assert.ok(!rpc2.calls.some((c) => c.name === 'finish_notifications'), 'a failed send was marked done');
});

test('send-notifications: batch caps (rows taken, tokens per row, messages per request)', async () => {
  const many = Array.from({ length: 150 }, (_, i) => row(i + 1, Array.from({ length: 8 }, (_, j) => tk(i * 10 + j))));
  const f = fakeSender();
  const rpc = fakeRpc({ push_is_enabled: () => true, claim_notifications: () => many, finish_notifications: () => 0 });
  await handleSendNotifications(post({}, H), { env: envFrom({ NOTIFICATIONS_SECRET: SECRET }), rpc: rpc.rpc, sender: f.sender });
  assert.equal(rpc.calls.find((c) => c.name === 'claim_notifications')!.args.p_limit, MAX_ROWS);
  assert.ok(f.sent.every((chunk) => chunk.length <= MAX_PER_REQUEST));
  assert.equal(f.sent.flat().length, MAX_ROWS * 5);            // at most 100 rows and 5 devices each
  const bad = fakeRpc({ push_is_enabled: () => true, claim_notifications: () => new Error('x') });
  assert.equal((await handleSendNotifications(post({}, H), { env: envFrom({ NOTIFICATIONS_SECRET: SECRET }), rpc: bad.rpc, sender: f.sender })).status, 502);
});

test('expo sender: request shape, per message results, errors throw without leaking tokens', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchOk = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ data: [{ status: 'ok', id: 'a' }, { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }] }), { status: 200 }); }) as unknown as typeof fetch;
  const msgs: PushMessage[] = [{ to: tk(1), title: 'PawsPal', body: 'b', data: {} }, { to: tk(2), title: 'PawsPal', body: 'b', data: {} }];
  assert.deepEqual(await expoSender(fetchOk, 'secret-token').send(msgs), [{ ok: true }, { ok: false, error: 'DeviceNotRegistered' }]);
  assert.equal(seen!.url, EXPO_PUSH_URL);
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, 'Bearer secret-token');
  assert.equal(JSON.parse(seen!.init.body as string).length, 2);
  assert.deepEqual(await expoSender(fetchOk).send([]), []);
  const fetch500 = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(expoSender(fetch500).send(msgs), (e: Error) => !e.message.includes('ExponentPushToken'));
  const fetchShort = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(expoSender(fetchShort).send(msgs));
});
