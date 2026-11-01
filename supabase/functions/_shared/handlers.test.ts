import test from 'node:test';
import assert from 'node:assert/strict';
import { envFrom } from './config.ts';
import type { Rpc } from './http.ts';
import { handleProcessUpload, type StorageOps } from './handlers/process-upload.ts';
import { handleHandoverPhotoUrl } from './handlers/handover-photo-url.ts';
import { handleEmergency } from './handlers/emergency.ts';
import { handleMembershipReminders } from './handlers/membership-reminders.ts';
import { emailProviderFromEnv } from './email/index.ts';
import type { EmailProvider } from './email/types.ts';
import { has, enc, photo, png } from './test-images.ts';

// ---------------------------------------------------------------- fakes
type RpcCall = { name: string; args: Record<string, unknown> };

function fakeRpc(handlers: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const calls: RpcCall[] = [];
  const rpc: Rpc = async (name, args) => {
    calls.push({ name, args });
    const h = handlers[name];
    if (!h) return { data: null, error: null };
    const out = h(args);
    return out instanceof Error ? { data: null, error: { message: out.message } } : { data: out, error: null };
  };
  return { rpc, calls };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://f.test/x', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

// Nothing in any function may print: codes and numbers must never reach the logs.
const logged: string[] = [];
for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  (console as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { logged.push(a.join(' ')); };
}
test.afterEach(() => { assert.deepEqual(logged.splice(0), [], 'a function printed to the log'); });


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
    { kind: 'avatar', path: `${UID}/x.jpg` }, { kind: 'pet', path: 'other/x.jpg' }, { kind: 'pet', path: `${UID}/../other/x.jpg` },
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



// ---------------------------------------------------------------- cleanup-photos
import { handleCleanupPhotos } from './handlers/cleanup-photos.ts';

const CLEANUP_KEY = 'cleanup-secret-with-enough-length-0123456789';
const cleanupReq = (secret?: string, method = 'POST') => new Request('http://x', { method, headers: secret === undefined ? {} : { 'x-cleanup-secret': secret } });

test('cleanup-photos: refuses everyone without the secret, and does nothing when no secret is set up', async () => {
  const { rpc, calls } = fakeRpc();
  const removed: string[] = [];
  const deps = (env: Record<string, string>) => ({ env: envFrom(env), rpc, removeMany: async (b: string, n: string[]) => { removed.push(b + ':' + n.join(',')); return true; } });
  assert.equal((await handleCleanupPhotos(cleanupReq(CLEANUP_KEY), deps({}))).status, 503);
  assert.equal((await handleCleanupPhotos(cleanupReq(CLEANUP_KEY), deps({ CLEANUP_SECRET: 'short' }))).status, 503);
  assert.equal((await handleCleanupPhotos(cleanupReq(), deps({ CLEANUP_SECRET: CLEANUP_KEY }))).status, 401);
  assert.equal((await handleCleanupPhotos(cleanupReq('wrong'), deps({ CLEANUP_SECRET: CLEANUP_KEY }))).status, 401);
  assert.equal((await handleCleanupPhotos(cleanupReq(CLEANUP_KEY, 'GET'), deps({ CLEANUP_SECRET: CLEANUP_KEY }))).status, 405);
  assert.deepEqual(calls, [], 'the database was not even asked');
  assert.deepEqual(removed, []);
});

test('cleanup-photos: deletes the listed files bucket by bucket, in batches, and ignores unknown buckets', async () => {
  const rows = [
    ...Array.from({ length: 150 }, (_, i) => ({ bucket_id: 'pets', name: `u/p${i}.jpg` })),
    { bucket_id: 'incoming', name: 'u/raw.jpg' },
    { bucket_id: 'avatars', name: 'u/should-never-be-touched.jpg' },
    { bucket_id: 'homes', name: 5 },
  ];
  const { rpc, calls } = fakeRpc({ list_unused_uploads: () => rows });
  const batches: [string, number][] = [];
  const res = await handleCleanupPhotos(cleanupReq(CLEANUP_KEY), { env: envFrom({ CLEANUP_SECRET: CLEANUP_KEY }), rpc, removeMany: async (b, n) => { batches.push([b, n.length]); return true; } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { removed: 151, failed: 0 });
  assert.deepEqual(batches, [['pets', 100], ['pets', 50], ['incoming', 1]]);
  assert.deepEqual(calls.map((c) => c.name), ['list_unused_uploads']);
});

test('cleanup-photos: counts failures honestly and stops cleanly when the database fails', async () => {
  const { rpc } = fakeRpc({ list_unused_uploads: () => [{ bucket_id: 'pets', name: 'a.jpg' }] });
  const res = await handleCleanupPhotos(cleanupReq(CLEANUP_KEY), { env: envFrom({ CLEANUP_SECRET: CLEANUP_KEY }), rpc, removeMany: async () => false });
  assert.deepEqual(await res.json(), { removed: 0, failed: 1 });
  const bad = fakeRpc({ list_unused_uploads: () => new Error('db down') });
  const res2 = await handleCleanupPhotos(cleanupReq(CLEANUP_KEY), { env: envFrom({ CLEANUP_SECRET: CLEANUP_KEY }), rpc: bad.rpc, removeMany: async () => true });
  assert.equal(res2.status, 502);
});

// ---------------------------------------------------------------- handover photos and emergencies (phase 7)
test('process-upload: a handover photo goes to the handovers bucket', async () => {
  const fs = fakeStorage({ [`incoming/${UID}/h.jpg`]: photo() });
  const res = await handleProcessUpload(withAuth({ kind: 'handover', path: `${UID}/h.jpg` }), uploadDeps(fs.storage));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { path: `${UID}/rand-1.jpg` });
  assert.ok(fs.store.has(`handovers/${UID}/rand-1.jpg`));
  assert.ok(!fs.store.has(`incoming/${UID}/h.jpg`));
});

const PHOTO_ID = '99999999-8888-7777-6666-555555555555';
const signer = (url: string | null = 'https://signed.test/x') => {
  const asked: [string, string, number][] = [];
  return { asked, urls: { async signedUrl(b: string, p: string, s: number) { asked.push([b, p, s]); return url; } } };
};

test('handover-photo-url: a person in the booking gets a link that works for a minute', async () => {
  const { rpc, calls } = fakeRpc({ handover_photo_for: () => `${UID}/rand-1.jpg` });
  const s = signer();
  const res = await handleHandoverPhotoUrl(withAuth({ photo_id: PHOTO_ID }), { authUser: async () => ({ id: UID }), rpc, urls: s.urls });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: 'https://signed.test/x', expires_in: 60 });
  assert.deepEqual(calls[0], { name: 'handover_photo_for', args: { p_user: UID, p_photo: PHOTO_ID } });
  assert.deepEqual(s.asked, [['handovers', `${UID}/rand-1.jpg`, 60]]);
});

test('handover-photo-url: someone outside the booking gets nothing, and so does a missing photo', async () => {
  const s = signer();
  const none = fakeRpc({ handover_photo_for: () => null });
  const res = await handleHandoverPhotoUrl(withAuth({ photo_id: PHOTO_ID }), { authUser: async () => ({ id: UID }), rpc: none.rpc, urls: s.urls });
  assert.equal(res.status, 404);
  assert.deepEqual(s.asked, [], 'a link was made for someone outside the booking');
  const down = fakeRpc({ handover_photo_for: () => new Error('db down') });
  assert.equal((await handleHandoverPhotoUrl(withAuth({ photo_id: PHOTO_ID }), { authUser: async () => ({ id: UID }), rpc: down.rpc, urls: s.urls })).status, 502);
  const ok = fakeRpc({ handover_photo_for: () => 'a/b.jpg' });
  const noLink = signer(null);
  assert.equal((await handleHandoverPhotoUrl(withAuth({ photo_id: PHOTO_ID }), { authUser: async () => ({ id: UID }), rpc: ok.rpc, urls: noLink.urls })).status, 502);
});

test('handover-photo-url: signed-in people only, valid ids only, POST only', async () => {
  const s = signer();
  const deps = { authUser: async () => ({ id: UID }), rpc: fakeRpc().rpc, urls: s.urls };
  assert.equal((await handleHandoverPhotoUrl(post({ photo_id: PHOTO_ID }), deps)).status, 401);
  assert.equal((await handleHandoverPhotoUrl(withAuth({ photo_id: PHOTO_ID }), { ...deps, authUser: async () => null })).status, 401);
  for (const bad of [{}, { photo_id: 'nope' }, { photo_id: 5 }, '[]']) assert.equal((await handleHandoverPhotoUrl(withAuth(bad), deps)).status, 400, JSON.stringify(bad));
  assert.equal((await handleHandoverPhotoUrl(new Request('https://f.test/', { method: 'GET' }), deps)).status, 405);
});

const BOOKING_ID = '12121212-3434-5656-7878-909090909090';
test('emergency: the database is asked with the caller id from the token, never from the body', async () => {
  const { rpc, calls } = fakeRpc({ raise_emergency: () => 'sent' });
  const res = await handleEmergency(withAuth({ booking_id: BOOKING_ID, note: 'Bruno will not eat', user_id: 'someone-else' }), { authUser: async () => ({ id: UID }), rpc });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: 'sent' });
  assert.deepEqual(calls[0], { name: 'raise_emergency', args: { p_user: UID, p_booking: BOOKING_ID, p_note: 'Bruno will not eat' } });
  const again = fakeRpc({ raise_emergency: () => 'already_sent' });
  const res2 = await handleEmergency(withAuth({ booking_id: BOOKING_ID }), { authUser: async () => ({ id: UID }), rpc: again.rpc });
  assert.deepEqual(await res2.json(), { ok: true, status: 'already_sent' });
  assert.equal(again.calls[0].args.p_note, null);
});

test('emergency: refusals from the database become plain codes', async () => {
  const run = async (answer: unknown) => handleEmergency(withAuth({ booking_id: BOOKING_ID }), { authUser: async () => ({ id: UID }), rpc: fakeRpc({ raise_emergency: () => answer }).rpc });
  assert.equal((await run('not_allowed')).status, 403);
  assert.equal((await run('too_many')).status, 429);
  assert.equal((await run('invalid')).status, 400);
  assert.equal((await run('something new')).status, 502);
  assert.equal((await run(new Error('db down'))).status, 502);
});

test('emergency: signed-in people only, valid input only, POST only', async () => {
  const deps = { authUser: async () => ({ id: UID }), rpc: fakeRpc().rpc };
  assert.equal((await handleEmergency(post({ booking_id: BOOKING_ID }), deps)).status, 401);
  assert.equal((await handleEmergency(withAuth({ booking_id: BOOKING_ID }), { ...deps, authUser: async () => null })).status, 401);
  for (const bad of [{}, { booking_id: 'x' }, { booking_id: BOOKING_ID, note: 5 }, { booking_id: BOOKING_ID, note: 'x'.repeat(501) }]) {
    assert.equal((await handleEmergency(withAuth(bad), deps)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await handleEmergency(new Request('https://f.test/', { method: 'GET' }), deps)).status, 405);
});

test('process-upload: all six kinds go to their own bucket, and only home touches the profile', async () => {
  const buckets = { face: 'faces', id: 'ids', payment: 'payments', pet: 'pets', home: 'homes', handover: 'handovers' };
  for (const [kind, bucket] of Object.entries(buckets)) {
    const fs = fakeStorage({ [`incoming/${UID}/k.jpg`]: photo() });
    const { rpc, calls } = fakeRpc({ attach_home_photo: () => null });
    const res = await handleProcessUpload(withAuth({ kind, path: `${UID}/k.jpg` }), uploadDeps(fs.storage, rpc));
    assert.equal(res.status, 200, kind);
    assert.ok(fs.store.has(`${bucket}/${UID}/rand-1.jpg`), kind);
    assert.ok(!fs.store.has(`incoming/${UID}/k.jpg`), kind);
    assert.deepEqual(calls.map((c) => c.name), kind === 'home' ? ['attach_home_photo'] : [], kind);
  }
  const fs = fakeStorage({ [`incoming/${UID}/k.jpg`]: photo() });
  for (const kind of ['avatar', 'incoming', 'ids', 'selfie']) {
    assert.equal((await handleProcessUpload(withAuth({ kind, path: `${UID}/k.jpg` }), uploadDeps(fs.storage))).status, 400, kind);
  }
});

test('cleanup-photos: cleans ids and payments too', async () => {
  const rows = ['incoming', 'pets', 'homes', 'faces', 'handovers', 'ids', 'payments'].map((b) => ({ bucket_id: b, name: 'u/a.jpg' }));
  const { rpc } = fakeRpc({ list_unused_uploads: () => rows });
  const seen: string[] = [];
  const res = await handleCleanupPhotos(cleanupReq(CLEANUP_KEY), { env: envFrom({ CLEANUP_SECRET: CLEANUP_KEY }), rpc, removeMany: async (b) => { seen.push(b); return true; } });
  assert.deepEqual(await res.json(), { removed: 7, failed: 0 });
  assert.deepEqual(seen, ['incoming', 'pets', 'homes', 'faces', 'handovers', 'ids', 'payments']);
});

// ---------------------------------------------------------------- membership-reminders
const REMIND_KEY = 'reminder-secret-with-enough-length-0123456789';
const remindReq = (secret?: string, method = 'POST') => new Request('http://x', { method, headers: secret === undefined ? {} : { 'x-reminder-secret': secret } });
const U1 = { user_id: 'u1', email: 'ana@example.test', first_name: 'Ana', locale: 'en', paid_until: '2027-01-10' };
const U2 = { user_id: 'u2', email: 'sara@example.test', first_name: 'Sara', locale: 'ar', paid_until: '2027-01-11' };
function fakeProvider(failFor: string[] = []) {
  const sent: { to: string; subject: string; text: string }[] = [];
  const provider: EmailProvider = { name: 'fake', async send(m) { if (failFor.includes(m.to)) throw new Error('refused'); sent.push(m); } };
  return { provider: () => provider, sent };
}
const remindDeps = (rpc: Rpc, p: ReturnType<typeof fakeProvider>, env: Record<string, string> = { REMINDER_SECRET: REMIND_KEY }) => ({ env: envFrom(env), rpc, provider: p.provider });

test('membership-reminders: refuses everyone without the secret and does nothing', async () => {
  const { rpc, calls } = fakeRpc({ list_due_reminders: () => [U1] });
  const p = fakeProvider();
  assert.equal((await handleMembershipReminders(remindReq(REMIND_KEY), remindDeps(rpc, p, {}))).status, 503);
  assert.equal((await handleMembershipReminders(remindReq(REMIND_KEY), remindDeps(rpc, p, { REMINDER_SECRET: 'short' }))).status, 503);
  assert.equal((await handleMembershipReminders(remindReq(), remindDeps(rpc, p))).status, 401);
  assert.equal((await handleMembershipReminders(remindReq('wrong'), remindDeps(rpc, p))).status, 401);
  assert.equal((await handleMembershipReminders(remindReq(REMIND_KEY, 'GET'), remindDeps(rpc, p))).status, 405);
  assert.deepEqual(calls, []);
  assert.deepEqual(p.sent, []);
});

test('membership-reminders: one email per person, in their language, then marked as reminded', async () => {
  const order: string[] = [];
  const { rpc, calls } = fakeRpc({
    list_due_reminders: () => [U1, U2],
    get_payment_settings: () => ({ renewal_fee_egp: '25' }),
    mark_reminded: (a) => { order.push(`mark ${a.p_user}`); return null; },
  });
  const p = fakeProvider();
  const inner = p.provider();
  const spy = { provider: () => ({ name: 'spy', async send(m: Parameters<EmailProvider['send']>[0]) { order.push(`send ${m.to}`); await inner.send(m); } }), sent: p.sent };
  const res = await handleMembershipReminders(remindReq(REMIND_KEY), remindDeps(rpc, spy));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { sent: 2, failed: 0 });
  assert.deepEqual(order, ['send ana@example.test', 'mark u1', 'send sara@example.test', 'mark u2']);
  assert.deepEqual(calls.filter((c) => c.name === 'mark_reminded').map((c) => c.args), [{ p_user: 'u1', p_paid_until: '2027-01-10' }, { p_user: 'u2', p_paid_until: '2027-01-11' }]);
  const [en, ar] = p.sent;
  assert.ok(en.text.includes('renews on 2027-01-10') && en.text.includes('25 EGP') && en.text.includes('Membership') && en.text.includes('InstaPay'));
  assert.ok(/[\u0600-\u06FF]/.test(ar.subject) && ar.text.includes('2027-01-11') && ar.text.includes('25'));
  for (const m of p.sent) assert.ok(!m.subject.includes('!') && !m.text.includes('!'), 'no exclamation marks');
  assert.ok(!JSON.stringify(body).includes('@'), 'the answer carries no emails');
});

test('membership-reminders: no amount in the settings means no amount in the email', async () => {
  const { rpc } = fakeRpc({ list_due_reminders: () => [U1], get_payment_settings: () => new Error('x') });
  const p = fakeProvider();
  await handleMembershipReminders(remindReq(REMIND_KEY), remindDeps(rpc, p));
  assert.ok(p.sent[0].text.includes('renews on 2027-01-10') && !/EGP|\d+ ?جنيه/.test(p.sent[0].text));
});

test('membership-reminders: a failed send is counted and not marked, the others still go out', async () => {
  const { rpc, calls } = fakeRpc({ list_due_reminders: () => [U1, U2] });
  const p = fakeProvider([U1.email]);
  const res = await handleMembershipReminders(remindReq(REMIND_KEY), remindDeps(rpc, p));
  assert.deepEqual(await res.json(), { sent: 1, failed: 1 });
  assert.deepEqual(calls.filter((c) => c.name === 'mark_reminded').map((c) => c.args.p_user), ['u2']);
});

test('membership-reminders: nobody due, database trouble, and provider settings missing', async () => {
  const p = fakeProvider();
  const empty = fakeRpc({ list_due_reminders: () => [] });
  assert.deepEqual(await (await handleMembershipReminders(remindReq(REMIND_KEY), remindDeps(empty.rpc, p))).json(), { sent: 0, failed: 0 });
  const down = fakeRpc({ list_due_reminders: () => new Error('db down') });
  assert.equal((await handleMembershipReminders(remindReq(REMIND_KEY), remindDeps(down.rpc, p))).status, 502);
  const due = fakeRpc({ list_due_reminders: () => [U1] });
  const env = { REMINDER_SECRET: REMIND_KEY };
  const deps = { env: envFrom(env), rpc: due.rpc, provider: emailProviderFromEnv };
  assert.equal((await handleMembershipReminders(remindReq(REMIND_KEY), deps)).status, 503, 'no RESEND_API_KEY');
  assert.equal((await handleMembershipReminders(remindReq(REMIND_KEY), { ...deps, env: envFrom({ ...env, RESEND_API_KEY: 'k' }) })).status, 503, 'no EMAIL_FROM');
  assert.equal((await handleMembershipReminders(remindReq(REMIND_KEY), { ...deps, env: envFrom({ ...env, EMAIL_PROVIDER: 'nope' }) })).status, 503, 'unknown provider');
  assert.deepEqual(due.calls, [], 'nothing was read before the provider was ready');
});

test('email: resend gets the right request and a refusal throws without the address', async () => {
  const env = envFrom({ RESEND_API_KEY: 'key-123', EMAIL_FROM: 'PawsPal <hi@example.test>' });
  assert.equal(emailProviderFromEnv(env).name, 'resend');
  const { resendProvider } = await import('./email/resend.ts');
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
  await resendProvider(env, ok).send({ to: 'a@example.test', subject: 'S', text: 'T' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer key-123');
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { from: 'PawsPal <hi@example.test>', to: ['a@example.test'], subject: 'S', text: 'T' });
  const bad = (async () => new Response('{}', { status: 422 })) as unknown as typeof fetch;
  await assert.rejects(resendProvider(env, bad).send({ to: 'a@example.test', subject: 'S', text: 'T' }), (e: Error) => !e.message.includes('a@example.test'));
});
