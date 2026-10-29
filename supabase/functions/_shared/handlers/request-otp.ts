// Step 1 of sign-up: the app asks for a code. This function applies the per-device limit, hides banned numbers,
// handles the optional CAPTCHA, then asks Supabase Auth to send the code (which calls the send-sms hook).
import { sha256Hex } from '../crypto.ts';
import { captchaConfigured, verifyCaptcha } from '../captcha.ts';
import type { Env } from '../config.ts';
import { ConfigError } from '../config.ts';
import { asDecision, json, readJson, type Rpc } from '../http.ts';
import { normalizeEgyptPhone } from '../phone.ts';

export interface OtpDeps {
  env: Env;
  fetch: typeof fetch;
  rpc: Rpc;
}

export const RESEND_AFTER_SECONDS = 60;

/** The device id is made by the app and kept on the phone. It is hashed here, so only the hash is stored. */
export const deviceHash = (deviceId: string) => sha256Hex('device:' + deviceId);
export const validDeviceId = (v: unknown): v is string => typeof v === 'string' && v.length >= 8 && v.length <= 80;

export async function handleRequestOtp(req: Request, deps: OtpDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const body = await readJson(req, 4 * 1024);
  if (!body) return json(400, { error: 'invalid_request' });
  const phone = normalizeEgyptPhone(body.phone);
  if (!phone.ok) return json(400, { error: 'invalid_phone' });
  if (!validDeviceId(body.device_id)) return json(400, { error: 'invalid_request' });

  const captchaToken = typeof body.captcha_token === 'string' && body.captcha_token.length > 0 && body.captcha_token.length <= 4096 ? body.captcha_token : null;
  const phoneHash = await sha256Hex(phone.digits);
  const devHash = await deviceHash(body.device_id);

  // A banned number gets the same answer as everyone else and no code. It cannot tell it was recognised.
  const banned = await deps.rpc('is_phone_banned', { p_phone: phone.e164 });
  if (banned.error) return json(503, { error: 'try_again_later' });
  if (banned.data === true) return json(200, { ok: true, resend_after_seconds: RESEND_AFTER_SECONDS });

  const check = await deps.rpc('otp_check_and_log', { p_phone_hash: phoneHash, p_device_hash: devHash, p_captcha_ok: false, p_mode: 'request' });
  const decision = check.error ? null : asDecision(check.data);
  if (!decision) return json(503, { error: 'try_again_later' });
  if (!decision.allowed) {
    const error = decision.reason === 'captcha_required' && !captchaConfigured(deps.env) ? 'too_many_attempts' : decision.reason;
    return json(429, { error, retry_after_seconds: decision.retry_after_seconds, captcha_required: decision.captcha_required && captchaConfigured(deps.env) });
  }

  const base = deps.env.get('SUPABASE_URL');
  const anon = deps.env.get('SUPABASE_ANON_KEY');
  if (!base || !anon) return json(503, { error: 'try_again_later' });
  let res: Response;
  try {
    res = await deps.fetch(`${base}/auth/v1/otp`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      // Supabase Auth checks the CAPTCHA itself when it is switched on (Authentication, Attack Protection), so a direct call
      // to Auth without a token fails too. We only pass the token along; checking it here would use it up.
      body: JSON.stringify({ phone: phone.e164, create_user: true, channel: 'sms', ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}) }),
    });
  } catch {
    return json(502, { error: 'send_failed' });
  }
  if (res.ok) return json(200, { ok: true, resend_after_seconds: RESEND_AFTER_SECONDS });
  if (res.status === 400 || res.status === 422) {
    const text = await res.clone().text().catch(() => '');
    if (/captcha/i.test(text)) return json(400, { error: 'captcha_failed', captcha_required: true });
  }
  if (res.status === 429) {
    const text = await res.text().catch(() => '');
    const m = text.match(/after (\d+) seconds?/i);
    return json(429, { error: 'too_soon', retry_after_seconds: m ? Number(m[1]) : RESEND_AFTER_SECONDS });
  }
  return json(502, { error: 'send_failed' });
}
