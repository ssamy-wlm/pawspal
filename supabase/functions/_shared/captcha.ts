// Optional CAPTCHA (Cloudflare Turnstile or hCaptcha), used after two wrong sign-in codes.
//   CAPTCHA_PROVIDER  turnstile | hcaptcha   (unset = no CAPTCHA: the person waits 10 minutes instead)
//   CAPTCHA_SECRET    the provider's secret key (a secret)
import { ConfigError, type Env } from './config.ts';

const ENDPOINTS: Record<string, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
};

export function captchaConfigured(env: Env): boolean {
  return !!(env.get('CAPTCHA_PROVIDER') ?? '').trim();
}

export async function verifyCaptcha(env: Env, fetchFn: typeof fetch, token: unknown): Promise<boolean> {
  const provider = (env.get('CAPTCHA_PROVIDER') ?? '').trim();
  if (!provider) return false;
  const endpoint = ENDPOINTS[provider];
  const secret = env.get('CAPTCHA_SECRET');
  if (!endpoint || !secret) throw new ConfigError('CAPTCHA_PROVIDER must be turnstile or hcaptcha, and CAPTCHA_SECRET must be set');
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return false;
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }).toString(),
    });
    if (!res.ok) return false;
    return (await res.json())?.success === true;
  } catch {
    return false;
  }
}
