// Verifies a "Standard Webhooks" signature, which is what Supabase Auth uses to call the Send SMS hook.
// Headers: webhook-id, webhook-timestamp, webhook-signature ("v1,<base64>" ; several may be listed, space separated).
// The signed text is `${id}.${timestamp}.${body}`, with HMAC-SHA256 and the secret from the dashboard (v1,whsec_<base64>).
import { base64ToBytes, bytesToBase64, hmacSha256, timingSafeEqual } from './crypto.ts';

export interface WebhookCheck {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}

export async function verifyStandardWebhook(c: WebhookCheck): Promise<boolean> {
  if (!c.secret || !c.id || !c.timestamp || !c.signature) return false;
  const ts = Number(c.timestamp);
  if (!Number.isFinite(ts) || Math.abs(c.nowSeconds - ts) > (c.toleranceSeconds ?? 300)) return false;   // stale or replayed
  let key: Uint8Array;
  try {
    key = base64ToBytes(c.secret.replace(/^v1,/, '').replace(/^whsec_/, ''));
  } catch {
    return false;
  }
  const expected = await hmacSha256(key, `${c.id}.${c.timestamp}.${c.body}`);
  const expectedB64 = bytesToBase64(expected);
  const enc = new TextEncoder();
  for (const part of c.signature.split(' ')) {
    const [version, sig] = part.split(',');
    if (version === 'v1' && sig && timingSafeEqual(enc.encode(sig), enc.encode(expectedB64))) return true;
  }
  return false;
}
