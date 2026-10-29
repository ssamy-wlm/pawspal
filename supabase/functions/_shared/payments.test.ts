import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesToHex, hmacSha512 } from './crypto.ts';
import { envFrom } from './config.ts';
import type { Rpc } from './http.ts';
import { handleCreateFeePayment } from './handlers/create-fee-payment.ts';
import { handlePaymentWebhook } from './handlers/paymob-webhook.ts';
import { handleProcessRefunds } from './handlers/process-refunds.ts';
import { handleCleanupPhotos } from './handlers/cleanup-photos.ts';
import { HMAC_FIELDS, hmacString, paymobProvider } from './payments/paymob.ts';
import { paymentProviderFromEnv } from './payments/index.ts';

const logged: string[] = [];
for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) console[m] = (...a: unknown[]) => { logged.push(a.join(' ')); };
test.afterEach(() => { assert.deepEqual(logged.splice(0), [], 'a function printed to the log'); });

const HMAC_SECRET = 'paymob-hmac-secret-for-tests';
const PAY = '0f8fad5b-d9cb-469f-a165-70867728950e';
const BOOKING = '1d3fad5b-d9cb-469f-a165-70867728950e';
const ENV = {
  PAYMENT_PROVIDER: 'paymob', PAYMOB_SECRET_KEY: 'egy_sk_test_secret', PAYMOB_PUBLIC_KEY: 'egy_pk_test_public', PAYMOB_HMAC_SECRET: HMAC_SECRET,
  PAYMOB_NOTIFICATION_URL: 'https://proj.supabase.co/functions/v1/paymob-webhook', PAYMOB_INTEGRATION_IDS: '4097558, 4097559',
};

// The worked example from Paymob's documentation (the "transaction processed" callback).
const sampleObj = {
  amount_cents: 100000, created_at: '2024-06-13T11:33:44.592345', currency: 'EGP', error_occured: false, has_parent_transaction: false, id: 192036465,
  integration_id: 4097558, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
  order: { id: 217503754, merchant_order_id: PAY }, owner: 302852, pending: false, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true,
};

async function signed(obj: unknown, type = 'TRANSACTION', secret = HMAC_SECRET) {
  const hmac = bytesToHex(await hmacSha512(new TextEncoder().encode(secret), hmacString(obj)));
  return { body: JSON.stringify({ type, obj }), url: `https://x/?hmac=${hmac}` };
}
const post = (body: string, url = 'https://x/') => new Request(url, { method: 'POST', body });

type Call = { name: string; args: Record<string, unknown> };
function fakeRpc(handlers: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  const calls: Call[] = [];
  const rpc: Rpc = async (name, args) => {
    calls.push({ name, args });
    const out = handlers[name]?.(args) ?? null;
    return out instanceof Error ? { data: null, error: { message: out.message } } : { data: out, error: null };
  };
  return { rpc, calls };
}

test('the signature text matches the example in Paymob’s documentation, field for field', () => {
  assert.equal(hmacString(sampleObj),
    '1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue');
  assert.equal(HMAC_FIELDS.length, 20);
});

test('webhook: a forged callback is refused and nothing is confirmed', async () => {
  const { rpc, calls } = fakeRpc();
  const env = envFrom(ENV);
  const forged = [
    post(JSON.stringify({ type: 'TRANSACTION', obj: sampleObj })),                                                    // no signature
    post(JSON.stringify({ type: 'TRANSACTION', obj: sampleObj }), 'https://x/?hmac=' + 'a'.repeat(128)),              // wrong signature
    post(JSON.stringify({ type: 'TRANSACTION', obj: sampleObj }), 'https://x/?hmac=abc'),                             // not even the right shape
  ];
  const other = await signed(sampleObj, 'TRANSACTION', 'a-different-secret');                                         // signed with the wrong key
  forged.push(post(other.body, other.url));
  const ok = await signed(sampleObj);
  forged.push(post(ok.body.replace('100000', '1'), ok.url));                                                          // a real signature, a changed amount
  forged.push(post('not json', ok.url), post('{}', ok.url));
  for (const req of forged) assert.equal((await handlePaymentWebhook(req, { env, rpc })).status, 401, 'a forged callback got through');
  assert.deepEqual(calls, [], 'the database was touched by a forged callback');
});

test('webhook: a signed successful payment confirms the booking with exactly the amount Paymob reports', async () => {
  const { rpc, calls } = fakeRpc({ complete_fee_payment: () => 'paid' });
  const s = await signed(sampleObj);
  const res = await handlePaymentWebhook(post(s.body, s.url), { env: envFrom(ENV), rpc });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: 'paid' });
  assert.deepEqual(calls, [{ name: 'complete_fee_payment', args: { p_payment: PAY, p_txn_id: '192036465', p_amount_cents: 100000, p_currency: 'EGP', p_provider_ref: '217503754' } }]);
});

test('webhook: the signature does not cover our reference, so the order id is passed on for the database to compare', async () => {
  // A genuine callback with someone else's reference swapped in still has a valid signature. It must reach the database
  // carrying the (signed) order id, where the reference check refuses it.
  const { rpc, calls } = fakeRpc({ complete_fee_payment: () => 'reference_mismatch' });
  const s = await signed(sampleObj);
  const swapped = s.body.replace(PAY, '2d3fad5b-d9cb-469f-a165-70867728950e');
  const res = await handlePaymentWebhook(post(swapped, s.url), { env: envFrom(ENV), rpc });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'reference_mismatch' });
  assert.deepEqual(calls[0].args, { p_payment: '2d3fad5b-d9cb-469f-a165-70867728950e', p_txn_id: '192036465', p_amount_cents: 100000, p_currency: 'EGP', p_provider_ref: '217503754' });
});

test('webhook: repeats, failures, pending, refunds and other callback kinds', async () => {
  const run = async (obj: unknown, type = 'TRANSACTION', handlers: Record<string, (a: Record<string, unknown>) => unknown> = {}) => {
    const { rpc, calls } = fakeRpc(handlers);
    const s = await signed(obj, type);
    const res = await handlePaymentWebhook(post(s.body, s.url), { env: envFrom(ENV), rpc });
    return { res, calls };
  };
  const again = await run(sampleObj, 'TRANSACTION', { complete_fee_payment: () => 'already_done' });
  assert.equal(again.res.status, 200);
  assert.deepEqual(await again.res.json(), { ok: true, status: 'already_done' });
  const refundDue = await run(sampleObj, 'TRANSACTION', { complete_fee_payment: () => 'refund_due' });
  assert.deepEqual(await refundDue.res.json(), { ok: true, status: 'refund_due' });
  const failed = await run({ ...sampleObj, success: false });
  assert.equal(failed.res.status, 200);
  assert.deepEqual(failed.calls, [{ name: 'fail_fee_payment', args: { p_payment: PAY } }]);
  const pending = await run({ ...sampleObj, success: false, pending: true });
  assert.deepEqual(pending.calls, []);
  const refunded = await run({ ...sampleObj, is_refunded: true });
  assert.deepEqual(refunded.calls, []);
  const voided = await run({ ...sampleObj, is_voided: true });
  assert.deepEqual(voided.calls, []);
  const cardToken = await run(sampleObj, 'TOKEN');
  assert.equal(cardToken.res.status, 200);
  assert.deepEqual(cardToken.calls, []);
  const mismatch = await run(sampleObj, 'TRANSACTION', { complete_fee_payment: () => 'amount_mismatch' });
  assert.equal(mismatch.res.status, 400);
  const unknown = await run(sampleObj, 'TRANSACTION', { complete_fee_payment: () => new Error('unknown payment') });
  assert.equal(unknown.res.status, 404);
  const down = await run(sampleObj, 'TRANSACTION', { complete_fee_payment: () => new Error('connection lost') });
  assert.equal(down.res.status, 502);                                                                                  // Paymob will try again
});

test('webhook: wrong method, empty or huge bodies, and no provider set up', async () => {
  const { rpc } = fakeRpc();
  const env = envFrom(ENV);
  assert.equal((await handlePaymentWebhook(new Request('https://x/'), { env, rpc })).status, 405);
  assert.equal((await handlePaymentWebhook(post(''), { env, rpc })).status, 400);
  assert.equal((await handlePaymentWebhook(post('x'.repeat(70000)), { env, rpc })).status, 400);
  const s = await signed(sampleObj);
  assert.equal((await handlePaymentWebhook(post(s.body, s.url), { env: envFrom({}), rpc })).status, 503);
  assert.equal((await handlePaymentWebhook(post(s.body, s.url), { env: envFrom({ ...ENV, PAYMOB_HMAC_SECRET: undefined }), rpc })).status, 503);
});

test('paymob: asks for a checkout for exactly the amount given, and builds the checkout address', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'int_1', intention_order_id: 555, client_secret: 'cs/1 2' }), { status: 201 }); }) as unknown as typeof fetch;
  const provider = paymobProvider(envFrom(ENV));
  const out = await provider.createCheckout({ paymentId: PAY, amountCents: 7500, currency: 'EGP' }, fetchFn);
  assert.equal(out.url, 'https://eg.checkout.paymob.com/?publicKey=egy_pk_test_public&clientSecret=cs%2F1%202');
  assert.equal(out.providerRef, '555');                                                   // the order id Paymob signs into its callbacks
  assert.equal(calls[0].url, 'https://accept.paymob.com/v1/intention/');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Token egy_sk_test_secret');
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.amount, 7500);
  assert.equal(body.currency, 'EGP');
  assert.equal(body.special_reference, PAY);
  assert.deepEqual(body.payment_methods, [4097558, 4097559]);
  assert.equal(body.items[0].amount, 7500);
  assert.equal(body.notification_url, ENV.PAYMOB_NOTIFICATION_URL);
  assert.ok(!JSON.stringify(body).includes('+2010'), 'a real phone number was sent');
});

test('paymob: a checkout answer without an order id is refused, so a payment can always be tied to its order', async () => {
  const noOrder = (async () => new Response(JSON.stringify({ id: 'x', client_secret: 'cs' }), { status: 201 })) as unknown as typeof fetch;
  await assert.rejects(paymobProvider(envFrom(ENV)).createCheckout({ paymentId: PAY, amountCents: 7500, currency: 'EGP' }, noOrder), /paymob refused/);
});

test('paymob: setup mistakes are named, and the provider is chosen by a setting', () => {
  assert.equal(paymentProviderFromEnv(envFrom({})), null);
  assert.equal(paymentProviderFromEnv(envFrom(ENV))!.name, 'paymob');
  assert.throws(() => paymentProviderFromEnv(envFrom({ PAYMENT_PROVIDER: 'nope' })), /Unknown payment provider/);
  assert.throws(() => paymobProvider(envFrom({ ...ENV, PAYMOB_INTEGRATION_IDS: 'abc' })), /Paymob needs/);
  assert.throws(() => paymobProvider(envFrom({ ...ENV, PAYMOB_NOTIFICATION_URL: 'http://insecure' })), /https/);
});

const user = async (t: string) => (t === 'good' ? { id: 'user-1' } : null);
const withAuth = (body: unknown, token = 'good') => new Request('https://x/', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const fetchOk = (async () => new Response(JSON.stringify({ id: 'int_9', intention_order_id: 909, client_secret: 'secret9' }), { status: 201 })) as unknown as typeof fetch;

test('create-fee-payment: the app sends only the booking, and the amount comes from the database', async () => {
  const { rpc, calls } = fakeRpc({ begin_fee_payment: () => [{ payment_id: PAY, amount_cents: 7500 }] });
  const res = await handleCreateFeePayment(withAuth({ booking_id: BOOKING, amount: 1, amount_cents: 1, fee: 0 }), { env: envFrom(ENV), fetch: fetchOk, rpc, authUser: user });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: 'https://eg.checkout.paymob.com/?publicKey=egy_pk_test_public&clientSecret=secret9', payment_id: PAY, amount_egp: 75 });
  assert.deepEqual(calls[0], { name: 'begin_fee_payment', args: { p_booking: BOOKING, p_user: 'user-1', p_provider: 'paymob' } });
  assert.deepEqual(calls[1], { name: 'set_payment_ref', args: { p_payment: PAY, p_ref: '909' } });
});

test('create-fee-payment: checks who is asking, what they ask, and whether payment is set up', async () => {
  const { rpc, calls } = fakeRpc();
  const base = { env: envFrom(ENV), fetch: fetchOk, rpc, authUser: user };
  assert.equal((await handleCreateFeePayment(new Request('https://x/'), base)).status, 405);
  assert.equal((await handleCreateFeePayment(withAuth({ booking_id: BOOKING }, 'bad'), base)).status, 401);
  assert.equal((await handleCreateFeePayment(new Request('https://x/', { method: 'POST', body: '{}' }), base)).status, 401);
  assert.equal((await handleCreateFeePayment(withAuth({}), base)).status, 400);
  assert.equal((await handleCreateFeePayment(withAuth({ booking_id: 'not-a-uuid' }), base)).status, 400);
  assert.equal((await handleCreateFeePayment(withAuth({ booking_id: BOOKING }), { ...base, env: envFrom({}) })).status, 503);
  assert.deepEqual(calls, []);
});

test('create-fee-payment: turns the database’s refusals into plain codes', async () => {
  const cases: [string, number, string][] = [
    ['booking not payable', 409, 'not_payable'], ['the other person pays the booking fee', 403, 'not_payer'],
    ['that pet is already booked for these dates', 409, 'pet_booked'], ['too many payment attempts', 429, 'too_many_attempts'],
    ['not allowed', 403, 'not_allowed'], ['booking not found', 403, 'not_allowed'], ['something odd', 502, 'try_again_later'],
  ];
  for (const [message, status, error] of cases) {
    const { rpc } = fakeRpc({ begin_fee_payment: () => new Error(message) });
    const res = await handleCreateFeePayment(withAuth({ booking_id: BOOKING }), { env: envFrom(ENV), fetch: fetchOk, rpc, authUser: user });
    assert.equal(res.status, status);
    assert.equal((await res.json()).error, error);
  }
});

test('create-fee-payment: when Paymob cannot make a checkout, the attempt is closed', async () => {
  const { rpc, calls } = fakeRpc({ begin_fee_payment: () => [{ payment_id: PAY, amount_cents: 7500 }] });
  const down = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
  const res = await handleCreateFeePayment(withAuth({ booking_id: BOOKING }), { env: envFrom(ENV), fetch: down, rpc, authUser: user });
  assert.equal(res.status, 502);
  assert.deepEqual(calls.map((c) => c.name), ['begin_fee_payment', 'fail_fee_payment']);
});

const REFUND_SECRET = 'refund-secret-with-enough-length-12345';
const refundReq = (secret?: string) => new Request('https://x/', { method: 'POST', headers: secret ? { 'x-refund-secret': secret } : {} });

test('process-refunds: only with the secret; confirmed refunds are recorded, unconfirmed ones stay due', async () => {
  const rows = [
    { payment_id: 'p1', provider: 'paymob', provider_txn_id: '111', refund_cents: 7500 },
    { payment_id: 'p2', provider: 'paymob', provider_txn_id: '222', refund_cents: 6500 },
    { payment_id: 'p3', provider: 'other', provider_txn_id: '333', refund_cents: 100 },
  ];
  const { rpc, calls } = fakeRpc({ list_refunds_due: () => rows });
  const marks = () => calls.filter((c: Call) => c.name === 'mark_refund_result').map((c: Call) => c.args);
  const asked: unknown[] = [];
  const fetchFn = (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string); asked.push(b);
    return new Response(JSON.stringify(b.transaction_id === 111 ? { success: true } : { success: false }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = envFrom({ ...ENV, REFUND_SECRET });
  assert.equal((await handleProcessRefunds(refundReq(), { env, fetch: fetchFn, rpc })).status, 401);
  assert.equal((await handleProcessRefunds(refundReq('wrong'), { env, fetch: fetchFn, rpc })).status, 401);
  assert.equal((await handleProcessRefunds(refundReq(REFUND_SECRET), { env: envFrom(ENV), fetch: fetchFn, rpc })).status, 503);
  assert.deepEqual(calls, []);
  const res = await handleProcessRefunds(refundReq(REFUND_SECRET), { env, fetch: fetchFn, rpc });
  assert.deepEqual(await res.json(), { refunded: 1, failed: 1 });
  assert.deepEqual(asked, [{ transaction_id: 111, amount_cents: 7500 }, { transaction_id: 222, amount_cents: 6500 }]);
  assert.deepEqual(marks(), [{ p_payment: 'p1', p_ok: true }, { p_payment: 'p2', p_ok: false }]);
});

test('the photo clean-up still refuses callers without its secret (shared check)', async () => {
  const { rpc, calls } = fakeRpc();
  const deps = { env: envFrom({ CLEANUP_SECRET: 'cleanup-secret-with-enough-length-1' }), rpc, removeMany: async () => true };
  assert.equal((await handleCleanupPhotos(new Request('https://x/', { method: 'POST' }), deps)).status, 401);
  assert.deepEqual(calls, []);
});
