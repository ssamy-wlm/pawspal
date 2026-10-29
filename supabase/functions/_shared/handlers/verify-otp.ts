// Step 1 of sign-up, second half: the person types the code. We check it with Supabase Auth, count wrong tries
// (two wrong codes need a CAPTCHA or a 10 minute wait), and hand back the session.
import { sha256Hex } from '../crypto.ts';
import { verifyCaptcha } from '../captcha.ts';
import { ConfigError } from '../config.ts';
import { asDecision, json, readJson } from '../http.ts';
import { normalizeEgyptPhone } from '../phone.ts';
import { deviceHash, validDeviceId, type OtpDeps } from './request-otp.ts';

export async function handleVerifyOtp(req: Request, deps: OtpDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const body = await readJson(req, 4 * 1024);
  if (!body) return json(400, { error: 'invalid_request' });
  const phone = normalizeEgyptPhone(body.phone);
  if (!phone.ok) return json(400, { error: 'invalid_phone' });
  if (typeof body.token !== 'string' || !/^[0-9]{4,8}$/.test(body.token) || !validDeviceId(body.device_id)) {
    return json(400, { error: 'invalid_request' });
  }

  const phoneHash = await sha256Hex(phone.digits);
  const devHash = await deviceHash(body.device_id);

  let captchaOk = false;
  if (body.captcha_token !== undefined) {
    try { captchaOk = await verifyCaptcha(deps.env, deps.fetch, body.captcha_token); } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
    }
  }
  const check = await deps.rpc('otp_check_and_log', { p_phone_hash: phoneHash, p_device_hash: devHash, p_captcha_ok: captchaOk, p_mode: 'check' });
  const decision = check.error ? null : asDecision(check.data);
  if (!decision) return json(503, { error: 'try_again_later' });
  if (!decision.allowed && decision.reason === 'captcha_required') {
    return json(429, { error: 'too_many_attempts', retry_after_seconds: decision.retry_after_seconds, captcha_required: !!deps.env.get('CAPTCHA_PROVIDER') });
  }

  const base = deps.env.get('SUPABASE_URL');
  const anon = deps.env.get('SUPABASE_ANON_KEY');
  if (!base || !anon) return json(503, { error: 'try_again_later' });
  let res: Response;
  try {
    res = await deps.fetch(`${base}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'sms', phone: phone.e164, token: body.token }),
    });
  } catch {
    return json(502, { error: 'try_again_later' });
  }

  if (!res.ok) {
    if (res.status >= 500) return json(502, { error: 'try_again_later' });
    await deps.rpc('otp_record_result', { p_phone_hash: phoneHash, p_device_hash: devHash, p_ok: false });
    return json(401, { error: 'invalid_code' });
  }
  const session = await res.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; user?: { id?: string } } | null;
  if (!session?.access_token || !session.refresh_token || !session.user?.id) return json(502, { error: 'try_again_later' });
  await deps.rpc('otp_record_result', { p_phone_hash: phoneHash, p_device_hash: devHash, p_ok: true });
  return json(200, {
    access_token: session.access_token, refresh_token: session.refresh_token,
    expires_in: session.expires_in ?? 3600, token_type: session.token_type ?? 'bearer', user: { id: session.user.id },
  });
}
