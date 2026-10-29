// A provider you describe with settings only, for any SMS company that has an HTTPS API (including Egyptian
// providers). No code change is needed to point it at a new company.
//
//   SMS_HTTP_URL      required, https only. Example: https://sms.example.com/api/send
//   SMS_HTTP_METHOD   default POST
//   SMS_HTTP_HEADERS  JSON object. Example: {"Authorization":"Bearer abc","X-Sender":"PawsPal"}
//   SMS_HTTP_BODY     JSON template. Default: {"to":"{{to}}","message":"{{message}}"}
//                     Placeholders: {{to}} (+2010...), {{to_digits}} (2010...), {{message}}, {{code}}
//   SMS_HTTP_FORMAT   json (default) or form (application/x-www-form-urlencoded)
//
// Any 2xx answer counts as "sent". Keep the keys in Supabase secrets, never in Git.
import { ConfigError, type Env } from '../config.ts';
import { SmsError, type SmsDeps, type SmsMessage, type SmsProvider } from './types.ts';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function fillTemplate(value: Json, vars: Record<string, string>): Json {
  if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (m, name: string) => (name in vars ? vars[name] : m));
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, vars)]));
  }
  return value;
}

export function genericHttpProvider(env: Env): SmsProvider {
  const url = env.get('SMS_HTTP_URL');
  if (!url || !url.startsWith('https://')) throw new ConfigError('SMS_HTTP_URL must be set and start with https://');
  const method = (env.get('SMS_HTTP_METHOD') ?? 'POST').toUpperCase();
  const format = env.get('SMS_HTTP_FORMAT') ?? 'json';
  if (format !== 'json' && format !== 'form') throw new ConfigError('SMS_HTTP_FORMAT must be json or form');
  let headers: Record<string, string>;
  let template: Json;
  try {
    headers = JSON.parse(env.get('SMS_HTTP_HEADERS') ?? '{}');
    template = JSON.parse(env.get('SMS_HTTP_BODY') ?? '{"to":"{{to}}","message":"{{message}}"}');
  } catch {
    throw new ConfigError('SMS_HTTP_HEADERS and SMS_HTTP_BODY must be valid JSON');
  }

  return {
    name: 'generic-http',
    async send(msg: SmsMessage, deps: SmsDeps) {
      const vars = { to: msg.to, to_digits: msg.to.replace(/^\+/, ''), message: msg.text, code: msg.code };
      const filled = fillTemplate(template, vars) as { [k: string]: Json };
      const init: RequestInit = { method, headers: { ...headers } };
      if (method !== 'GET') {
        if (format === 'json') {
          (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
          init.body = JSON.stringify(filled);
        } else {
          (init.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded';
          init.body = new URLSearchParams(Object.entries(filled).map(([k, v]) => [k, String(v)])).toString();
        }
      }
      let res: Response;
      try {
        res = await deps.fetch(url, init);
      } catch {
        throw new SmsError('generic-http', null);
      }
      if (!res.ok) throw new SmsError('generic-http', res.status);
    },
  };
}
