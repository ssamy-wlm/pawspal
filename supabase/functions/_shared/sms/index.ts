// Picks the SMS provider(s) from settings and sends with fallback.
//
//   SMS_PROVIDERS  comma list, tried in order until one works. Example: whatsapp-cloud,generic-http
//   SMS_MESSAGE    text with {{code}}. Default is bilingual (Arabic and English).
//
// Unset means "no provider configured": the send-sms hook then refuses to send (it never pretends to).
import { ConfigError, type Env } from '../config.ts';
import { genericHttpProvider } from './generic-http.ts';
import { SmsError, type SmsDeps, type SmsMessage, type SmsProvider } from './types.ts';
import { whatsappCloudProvider } from './whatsapp-cloud.ts';

// To add a provider: write its file, then add one line here.
const REGISTRY: Record<string, (env: Env) => SmsProvider> = {
  'generic-http': genericHttpProvider,
  'whatsapp-cloud': whatsappCloudProvider,
};

export function smsProvidersFromEnv(env: Env): SmsProvider[] {
  const names = (env.get('SMS_PROVIDERS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return names.map((name) => {
    const make = REGISTRY[name];
    if (!make) throw new ConfigError(`Unknown SMS provider "${name}". Known: ${Object.keys(REGISTRY).join(', ')}`);
    return make(env);
  });
}

export function smsText(env: Env, code: string): string {
  const template = env.get('SMS_MESSAGE') ?? 'PawsPal: your code is {{code}} | رمز PawsPal: {{code}}';
  return template.replace(/\{\{code\}\}/g, code);
}

/** Tries each provider in order. Returns the name of the one that worked. Throws SmsError if none did. */
export async function sendCode(providers: SmsProvider[], msg: SmsMessage, deps: SmsDeps): Promise<string> {
  let last: SmsError | null = null;
  for (const p of providers) {
    try {
      await p.send(msg, deps);
      return p.name;
    } catch (e) {
      last = e instanceof SmsError ? e : new SmsError(p.name, null);
    }
  }
  throw last ?? new SmsError('none', null);
}
