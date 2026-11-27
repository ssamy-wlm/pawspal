// SMTP provider (interim: Gmail, until the founder has a domain for Resend).
// Settings (Edge Function secrets): EMAIL_PROVIDER=smtp, SMTP_USER, SMTP_PASSWORD (a Gmail app password), EMAIL_FROM,
// optional SMTP_HOST (default smtp.gmail.com) and SMTP_PORT (default 465).
//
// Implicit TLS on 465 only. Supabase Edge Functions block 25 and 587, and plain STARTTLS must never be offered.
// This file is pure logic: the real client (nodemailer) lives in smtp-deno.ts and is injected, so tests use a fake.
// Errors carry only a short category. Never the server's text, the password, the address or a token. Nothing is logged.
import { ConfigError, type Env } from '../config.ts';
import type { EmailMessage, EmailProvider } from './types.ts';

export interface SmtpMessage { from: string; to: string; subject: string; text: string }

/** What the testable part needs from an SMTP client. */
export interface SmtpTransport {
  sendMail(msg: SmtpMessage): Promise<unknown>;
}

export interface SmtpSettings { host: string; port: 465; user: string; password: string; from: string }

/** Builds the real client from validated settings (implicit TLS, short socket timeouts). Supplied by the Deno entry layer. */
export type SmtpTransportFactory = (settings: SmtpSettings) => SmtpTransport;

export type SmtpFailure = 'auth_failed' | 'connect_failed' | 'rejected' | 'timeout';

/** Thrown by send(). The message is the category and nothing else. */
export class SmtpError extends Error {
  readonly category: SmtpFailure;
  constructor(category: SmtpFailure) {
    super(`smtp ${category}`);
    this.name = 'SmtpError';
    this.category = category;
  }
}

export const SMTP_TIMEOUT_MS = 15_000;
const BLOCKED_PORTS = new Set(['25', '587']);
const ADDRESS = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)+$/;
const CRLF = /[\r\n\u0085\u2028\u2029\0]/;

/** The address part of "Name <a@b.c>" or a bare "a@b.c". null when it is not one plain address. */
export function addressOf(value: string): string | null {
  const v = value.trim();
  const m = /^[^<>]*<([^<>]+)>$/.exec(v);
  const addr = (m ? m[1] : v).trim();
  return addr.length <= 254 && ADDRESS.test(addr) ? addr : null;
}

export function smtpSettingsFromEnv(env: Env): SmtpSettings {
  const host = (env.get('SMTP_HOST') ?? '').trim() || 'smtp.gmail.com';
  const portText = (env.get('SMTP_PORT') ?? '').trim() || '465';
  const user = (env.get('SMTP_USER') ?? '').trim();
  const password = env.get('SMTP_PASSWORD') ?? '';
  const from = (env.get('EMAIL_FROM') ?? '').trim();

  if (BLOCKED_PORTS.has(portText)) throw new ConfigError(`SMTP_PORT ${portText} is blocked on Supabase Edge Functions. Use 465 (implicit TLS)`);
  if (portText !== '465') throw new ConfigError('SMTP_PORT must be 465 (implicit TLS only)');
  if (!/^[A-Za-z0-9.\-]+$/.test(host)) throw new ConfigError('SMTP_HOST is not a valid host name');
  if (!user) throw new ConfigError('SMTP_USER is not set');
  if (!password) throw new ConfigError('SMTP_PASSWORD is not set');
  if (!from) throw new ConfigError('EMAIL_FROM is not set');
  if (CRLF.test(user) || CRLF.test(from) || CRLF.test(host)) throw new ConfigError('SMTP settings must not contain line breaks');
  const fromAddress = addressOf(from);
  if (!fromAddress) throw new ConfigError('EMAIL_FROM does not hold a valid address');
  const userAddress = addressOf(user);
  if (host.toLowerCase() === 'smtp.gmail.com') {
    if (!userAddress) throw new ConfigError('SMTP_USER must be the Gmail address');
    if (fromAddress.toLowerCase() !== userAddress.toLowerCase()) {
      throw new ConfigError('For Gmail the EMAIL_FROM address must equal SMTP_USER, or Gmail rewrites it');
    }
  }
  return { host, port: 465, user, password, from };
}

/** Maps whatever the client threw to one short category. Looks at codes only, never copies text. */
export function categorize(e: unknown): SmtpFailure {
  const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : '';
  const responseCode = Number((e as { responseCode?: unknown })?.responseCode);
  if (e instanceof SmtpError) return e.category;
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534 || responseCode === 454) return 'auth_failed';
  if (code === 'ETIMEDOUT' || code === 'ETIMEOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout';
  if (code === 'EENVELOPE' || code === 'EMESSAGE' || (responseCode >= 400 && responseCode < 600)) return 'rejected';
  return 'connect_failed';
}

export function smtpProvider(env: Env, factory?: SmtpTransportFactory, timeoutMs: number = SMTP_TIMEOUT_MS): EmailProvider {
  const settings = smtpSettingsFromEnv(env);
  if (!factory) throw new ConfigError('No SMTP client is available in this runtime');
  const transport = factory(settings);
  return {
    name: 'smtp',
    async send({ to, subject, text }: EmailMessage) {
      if (CRLF.test(to) || CRLF.test(subject)) throw new SmtpError('rejected');
      const target = addressOf(to);
      if (!target || target !== to.trim() || /[<>,;"]/.test(to)) throw new SmtpError('rejected');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SmtpError('timeout')), timeoutMs); });
      try {
        await Promise.race([transport.sendMail({ from: settings.from, to: target, subject, text }), deadline]);
      } catch (e) {
        throw new SmtpError(categorize(e));            // category only: never the server's text, the address or the password
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
