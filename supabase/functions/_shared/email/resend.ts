// Resend (https://resend.com). Settings: RESEND_API_KEY, EMAIL_FROM (for example "PawsPal <hello@your-domain>").
import { ConfigError, type Env } from '../config.ts';
import type { EmailMessage, EmailProvider } from './types.ts';

export function resendProvider(env: Env, fetchFn: typeof fetch = fetch): EmailProvider {
  const key = env.get('RESEND_API_KEY');
  const from = env.get('EMAIL_FROM');
  if (!key) throw new ConfigError('RESEND_API_KEY is not set');
  if (!from) throw new ConfigError('EMAIL_FROM is not set');
  return {
    name: 'resend',
    async send({ to, subject, text }: EmailMessage) {
      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (!res.ok) throw new Error(`resend answered ${res.status}`);   // status only: never the address or the text
    },
  };
}
