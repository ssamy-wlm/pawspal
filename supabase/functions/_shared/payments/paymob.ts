// Paymob (Egypt), with the Intention API and Unified Checkout. Settings (Supabase secrets):
//   PAYMOB_SECRET_KEY        the secret key (egy_sk_test_... in test mode, egy_sk_live_... when live)
//   PAYMOB_PUBLIC_KEY        the public key (egy_pk_...)
//   PAYMOB_INTEGRATION_IDS   comma list of the card (and wallet) integration ids to offer, from the Paymob dashboard
//   PAYMOB_HMAC_SECRET       the HMAC secret from the dashboard, used to check every callback
//   PAYMOB_NOTIFICATION_URL  where Paymob posts the result: https://<project>.supabase.co/functions/v1/paymob-webhook
//   PAYMOB_RETURN_URL        (optional) where the person lands after paying
//   PAYMOB_BILLING_PHONE     (optional) Paymob wants a phone number on every checkout; we send this placeholder, not the person's number
// Test mode and live mode differ only in which keys and integration ids you set.
//
// Sources: developers.paymob.com (Create Intention, Unified Checkout redirection, HMAC for the transaction callback).
import { ConfigError, type Env } from '../config.ts';
import { bytesToHex, hmacSha512, timingSafeEqual } from '../crypto.ts';
import { PaymentError, type Checkout, type CheckoutInput, type PaymentEvent, type PaymentProvider } from './types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fields that make up the signature, in the order Paymob specifies for the "transaction processed" callback. */
export const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure',
  'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
] as const;

const dig = (obj: unknown, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

/** The text Paymob signs: the field values joined with nothing between them. Booleans are written true or false. */
export function hmacString(obj: unknown): string {
  return HMAC_FIELDS.map((f) => { const v = dig(obj, f); return v === undefined || v === null ? '' : String(v); }).join('');
}

export function paymobProvider(env: Env): PaymentProvider {
  const secretKey = env.get('PAYMOB_SECRET_KEY');
  const publicKey = env.get('PAYMOB_PUBLIC_KEY');
  const hmacSecret = env.get('PAYMOB_HMAC_SECRET');
  const notificationUrl = env.get('PAYMOB_NOTIFICATION_URL');
  const ids = (env.get('PAYMOB_INTEGRATION_IDS') ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  if (!secretKey || !publicKey || !hmacSecret || !notificationUrl || ids.length === 0 || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new ConfigError('Paymob needs PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY, PAYMOB_HMAC_SECRET, PAYMOB_NOTIFICATION_URL and PAYMOB_INTEGRATION_IDS');
  }
  if (!notificationUrl.startsWith('https://')) throw new ConfigError('PAYMOB_NOTIFICATION_URL must start with https://');
  const apiBase = (env.get('PAYMOB_API_URL') ?? 'https://accept.paymob.com').replace(/\/$/, '');
  const checkoutBase = (env.get('PAYMOB_CHECKOUT_URL') ?? 'https://eg.checkout.paymob.com').replace(/\/$/, '');
  const returnUrl = env.get('PAYMOB_RETURN_URL');
  const billingPhone = env.get('PAYMOB_BILLING_PHONE') ?? '+200000000000';
  const auth = { Authorization: `Token ${secretKey}`, 'Content-Type': 'application/json' };

  return {
    name: 'paymob',

    async createCheckout(input: CheckoutInput, fetchFn: typeof fetch): Promise<Checkout> {
      let res: Response;
      try {
        res = await fetchFn(`${apiBase}/v1/intention/`, {
          method: 'POST', headers: auth,
          body: JSON.stringify({
            amount: input.amountCents, currency: input.currency, payment_methods: ids,
            items: [{ name: 'PawsPal booking fee', amount: input.amountCents, description: 'Booking fee', quantity: 1 }],
            billing_data: { first_name: 'PawsPal', last_name: 'User', email: 'NA', phone_number: billingPhone },
            special_reference: input.paymentId,
            notification_url: notificationUrl,
            ...(returnUrl ? { redirection_url: returnUrl } : {}),
          }),
        });
      } catch { throw new PaymentError('paymob', null); }
      if (!res.ok) throw new PaymentError('paymob', res.status);
      const data = await res.json().catch(() => null) as { intention_order_id?: unknown; client_secret?: unknown } | null;
      // The order id is what Paymob signs into its callback, so it is what ties a callback to this payment.
      if (!data || typeof data.client_secret !== 'string' || !data.client_secret || (typeof data.intention_order_id !== 'number' && typeof data.intention_order_id !== 'string')) throw new PaymentError('paymob', res.status);
      const url = `${checkoutBase}/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(data.client_secret)}`;
      return { url, providerRef: String(data.intention_order_id) };
    },

    async parseCallback(rawBody: string, query: URLSearchParams): Promise<PaymentEvent | 'invalid' | null> {
      let body: { type?: unknown; obj?: unknown } | null;
      try { body = JSON.parse(rawBody); } catch { return 'invalid'; }
      if (!body || typeof body !== 'object' || !body.obj || typeof body.obj !== 'object') return 'invalid';
      const given = (query.get('hmac') ?? '').toLowerCase();
      const expected = bytesToHex(await hmacSha512(new TextEncoder().encode(hmacSecret), hmacString(body.obj)));
      const enc = new TextEncoder();
      if (!/^[0-9a-f]{128}$/.test(given) || !timingSafeEqual(enc.encode(given), enc.encode(expected))) return 'invalid';
      // The signature is good. Only transaction callbacks mean anything to us.
      if (body.type !== 'TRANSACTION') return null;
      const o = body.obj;
      const ref = dig(o, 'order.merchant_order_id');
      const txn = dig(o, 'id');
      const amount = dig(o, 'amount_cents');
      const orderId = dig(o, 'order.id');
      if (typeof ref !== 'string' || !UUID.test(ref) || (typeof txn !== 'number' && typeof txn !== 'string') || typeof amount !== 'number' || (typeof orderId !== 'number' && typeof orderId !== 'string')) return 'invalid';
      return {
        paymentId: ref.toLowerCase(), orderRef: String(orderId), txnId: String(txn), amountCents: amount, currency: String(dig(o, 'currency') ?? ''),
        success: dig(o, 'success') === true, pending: dig(o, 'pending') === true,
        refunded: dig(o, 'is_refunded') === true, voided: dig(o, 'is_voided') === true,
        hasParent: dig(o, 'has_parent_transaction') === true, authOnly: dig(o, 'is_auth') === true && dig(o, 'is_capture') !== true,
      };
    },

    async refund(txnId: string, amountCents: number, fetchFn: typeof fetch): Promise<boolean> {
      // To confirm with a real account: the refund request and its answer (docs.paymob.com, Refund Transaction).
      try {
        const res = await fetchFn(`${apiBase}/api/acceptance/void_refund/refund`, { method: 'POST', headers: auth, body: JSON.stringify({ transaction_id: Number(txnId), amount_cents: amountCents }) });
        if (!res.ok) return false;
        const data = await res.json().catch(() => null) as { success?: unknown; is_refunded?: unknown } | null;
        return data?.success === true || data?.is_refunded === true;
      } catch { return false; }
    },
  };
}
