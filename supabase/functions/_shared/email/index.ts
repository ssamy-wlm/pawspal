// Picks the email provider from settings.
//
//   EMAIL_PROVIDER  default "resend"
//   RESEND_API_KEY, EMAIL_FROM  for resend
//   SMTP_USER, SMTP_PASSWORD, EMAIL_FROM (+ SMTP_HOST, SMTP_PORT)  for smtp (Gmail interim; the client is passed in by the Deno entry)
//
// A missing key throws ConfigError, and the function answers 503 instead of pretending to send.
import { ConfigError, type Env } from '../config.ts';
import { resendProvider } from './resend.ts';
import { smtpProvider, type SmtpTransportFactory } from './smtp.ts';
import type { EmailProvider } from './types.ts';

// To add a provider: write its file, then add one line here.
export interface EmailRuntime {
  /** The real SMTP client, from the Deno-only layer. Without it the smtp provider answers ConfigError. */
  smtpTransport?: SmtpTransportFactory;
}

const REGISTRY: Record<string, (env: Env, rt: EmailRuntime) => EmailProvider> = {
  resend: (env) => resendProvider(env),
  smtp: (env, rt) => smtpProvider(env, rt.smtpTransport),
};

export function emailProviderFromEnv(env: Env, runtime: EmailRuntime = {}): EmailProvider {
  const name = (env.get('EMAIL_PROVIDER') ?? 'resend').trim() || 'resend';
  const make = REGISTRY[name];
  if (!make) throw new ConfigError(`Unknown email provider "${name}". Known: ${Object.keys(REGISTRY).join(', ')}`);
  return make(env, runtime);
}
