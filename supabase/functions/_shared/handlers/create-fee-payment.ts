// The app asks to pay the booking fee. The amount is never sent by the app: the database makes a payment row with the
// fee from its server setting, and we ask the payment provider for a checkout page for exactly that amount.
import { ConfigError, type Env } from '../config.ts';
import { bearerToken, json, readJson, type Rpc } from '../http.ts';
import { paymentProviderFromEnv } from '../payments/index.ts';

export interface CreateFeeDeps {
  env: Env;
  fetch: typeof fetch;
  rpc: Rpc;
  authUser(token: string): Promise<{ id: string } | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Plain codes the app understands, from the database's refusal messages. */
function refusal(message: string): { status: number; error: string } {
  if (/not payable/i.test(message)) return { status: 409, error: 'not_payable' };
  if (/other person pays/i.test(message)) return { status: 403, error: 'not_payer' };
  if (/already booked/i.test(message)) return { status: 409, error: 'pet_booked' };
  if (/too many payment attempts/i.test(message)) return { status: 429, error: 'too_many_attempts' };
  if (/not allowed|not found/i.test(message)) return { status: 403, error: 'not_allowed' };
  return { status: 502, error: 'try_again_later' };
}

export async function handleCreateFeePayment(req: Request, deps: CreateFeeDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = bearerToken(req);
  const user = token ? await deps.authUser(token) : null;
  if (!user) return json(401, { error: 'unauthorized' });
  const body = await readJson(req, 1024);
  if (!body || typeof body.booking_id !== 'string' || !UUID.test(body.booking_id)) return json(400, { error: 'invalid_request' });

  let provider;
  try { provider = paymentProviderFromEnv(deps.env); } catch (e) {
    if (e instanceof ConfigError) return json(503, { error: 'not_configured' });
    throw e;
  }
  if (!provider) return json(503, { error: 'not_configured' });

  const begun = await deps.rpc('begin_fee_payment', { p_booking: body.booking_id, p_user: user.id, p_provider: provider.name });
  if (begun.error) { const r = refusal(begun.error.message); return json(r.status, { error: r.error }); }
  const row = (Array.isArray(begun.data) ? begun.data[0] : begun.data) as { payment_id?: string; amount_cents?: number } | null;
  if (!row || typeof row.payment_id !== 'string' || typeof row.amount_cents !== 'number') return json(502, { error: 'try_again_later' });

  try {
    const checkout = await provider.createCheckout({ paymentId: row.payment_id, amountCents: row.amount_cents, currency: 'EGP' }, deps.fetch);
    // The order id must be saved before the person is sent to pay: it is what ties Paymob's callback to this payment.
    const saved = await deps.rpc('set_payment_ref', { p_payment: row.payment_id, p_ref: checkout.providerRef });
    if (saved.error) throw new Error('could not save the order reference');
    return json(200, { url: checkout.url, payment_id: row.payment_id, amount_egp: row.amount_cents / 100 });
  } catch {
    await deps.rpc('fail_fee_payment', { p_payment: row.payment_id });       // no checkout page was made: close this attempt
    return json(502, { error: 'try_again_later' });
  }
}
