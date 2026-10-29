// The Send SMS hook. Supabase Auth calls this every time it needs to deliver a sign-in code, and we choose the provider.
// Every code, whether it came from the app or not, passes through here, so the per-number limit cannot be skipped.
import { sha256Hex } from '../crypto.ts';
import type { Env } from '../config.ts';
import { ConfigError } from '../config.ts';
import { asDecision, json, type Rpc } from '../http.ts';
import { normalizeEgyptPhone } from '../phone.ts';
import { sendCode, smsProvidersFromEnv, smsText } from '../sms/index.ts';
import { verifyStandardWebhook } from '../webhook.ts';

export interface SendSmsDeps {
  env: Env;
  fetch: typeof fetch;
  rpc: Rpc;
  nowSeconds: () => number;
}

// Supabase shows the "message" to the person who asked for the code.
const hookError = (status: number, message: string) => json(status, { error: { http_code: status, message } });

export async function handleSendSms(req: Request, deps: SendSmsDeps): Promise<Response> {
  if (req.method !== 'POST') return hookError(405, 'method not allowed');
  const body = await req.text();
  if (body.length === 0 || body.length > 8 * 1024) return hookError(400, 'bad request');

  const ok = await verifyStandardWebhook({
    secret: deps.env.get('SEND_SMS_HOOK_SECRET') ?? '',
    id: req.headers.get('webhook-id'),
    timestamp: req.headers.get('webhook-timestamp'),
    signature: req.headers.get('webhook-signature'),
    body,
    nowSeconds: deps.nowSeconds(),
  });
  if (!ok) return hookError(401, 'unauthorized');

  let payload: { user?: { phone?: unknown }; sms?: { otp?: unknown } };
  try { payload = JSON.parse(body); } catch { return hookError(400, 'bad request'); }
  const phone = normalizeEgyptPhone(payload.user?.phone);
  const otp = payload.sms?.otp;
  if (!phone.ok) return hookError(400, 'only Egyptian mobile numbers are supported');
  if (typeof otp !== 'string' || !/^[0-9]{4,10}$/.test(otp)) return hookError(400, 'bad request');

  let providers;
  try { providers = smsProvidersFromEnv(deps.env); } catch (e) {
    if (e instanceof ConfigError) return hookError(503, 'sign-in codes are not available yet');
    throw e;
  }
  if (providers.length === 0) return hookError(503, 'sign-in codes are not available yet');

  const rpc = await deps.rpc('otp_check_and_log', { p_phone_hash: await sha256Hex(phone.digits), p_device_hash: null, p_captcha_ok: false, p_mode: 'send' });
  const decision = rpc.error ? null : asDecision(rpc.data);
  if (!decision) return hookError(503, 'please try again later');
  if (!decision.allowed) return hookError(429, `too many codes requested; try again in ${Math.ceil(decision.retry_after_seconds / 60)} min`);

  try {
    await sendCode(providers, { to: phone.e164, code: otp, text: smsText(deps.env, otp) }, { fetch: deps.fetch });
  } catch {
    return hookError(502, 'could not send the code; please try again');
  }
  return json(200, {});
}
