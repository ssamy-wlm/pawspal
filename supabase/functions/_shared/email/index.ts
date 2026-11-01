// Picks the email provider from settings.
//
//   EMAIL_PROVIDER  default "resend"
//   RESEND_API_KEY, EMAIL_FROM  for resend
//
// A missing key throws ConfigError, and the function answers 503 instead of pretending to send.
import { ConfigError, type Env } from '../config.ts';
import { resendProvider } from './resend.ts';
import type { EmailProvider } from './types.ts';

// To add a provider: write its file, then add one line here.
const REGISTRY: Record<string, (env: Env) => EmailProvider> = {
  resend: (env) => resendProvider(env),
};

export function emailProviderFromEnv(env: Env): EmailProvider {
  const name = (env.get('EMAIL_PROVIDER') ?? 'resend').trim() || 'resend';
  const make = REGISTRY[name];
  if (!make) throw new ConfigError(`Unknown email provider "${name}". Known: ${Object.keys(REGISTRY).join(', ')}`);
  return make(env);
}
