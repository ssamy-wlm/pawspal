// Paymob tells us a payment's result. This is the ONLY way a booking fee becomes paid. A callback is believed only when
// its HMAC signature matches (so a forged one is refused), and the amount must be exactly what we asked for (the database
// checks that). Repeats are harmless. Nothing about the person or the card is logged.
import type { Env } from '../config.ts';
import { ConfigError } from '../config.ts';
import { json, type Rpc } from '../http.ts';
import { paymentProviderFromEnv } from '../payments/index.ts';

export interface WebhookDeps {
  env: Env;
  rpc: Rpc;
}

export async function handlePaymentWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const raw = await req.text();
  if (raw.length === 0 || raw.length > 64 * 1024) return json(400, { error: 'invalid_request' });

  let provider;
  try { provider = paymentProviderFromEnv(deps.env); } catch (e) {
    if (e instanceof ConfigError) return json(503, { error: 'not_configured' });
    throw e;
  }
  if (!provider) return json(503, { error: 'not_configured' });

  const event = await provider.parseCallback(raw, new URL(req.url).searchParams);
  if (event === 'invalid') return json(401, { error: 'invalid_signature' });
  if (event === null) return json(200, { ok: true, ignored: true });           // a signed callback of a kind we do not act on

  // Refunds and voids are reported back to us too; they are not payments.
  if (event.refunded || event.voided || event.hasParent) return json(200, { ok: true, ignored: true });
  if (event.pending || event.authOnly) return json(200, { ok: true, pending: true });         // money held but not taken yet

  if (!event.success) {
    await deps.rpc('fail_fee_payment', { p_payment: event.paymentId, p_ref: event.orderRef });
    return json(200, { ok: true, status: 'failed' });
  }
  const done = await deps.rpc('complete_fee_payment', { p_payment: event.paymentId, p_txn_id: event.txnId, p_amount_cents: event.amountCents, p_currency: event.currency, p_provider_ref: event.orderRef });
  if (done.error) return json(/unknown payment/i.test(done.error.message) ? 404 : 502, { error: 'try_again_later' });
  // A wrong amount is recorded for refund (nothing more to retry); a reference that is not ours changes nothing.
  if (done.data === 'reference_mismatch') return json(400, { error: done.data });
  return json(200, { ok: true, status: done.data });
}
