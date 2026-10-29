import test from 'node:test';
import assert from 'node:assert/strict';
import { envFrom, ConfigError } from './config.ts';
import { fillTemplate, genericHttpProvider } from './sms/generic-http.ts';
import { whatsappCloudProvider } from './sms/whatsapp-cloud.ts';
import { sendCode, smsProvidersFromEnv, smsText } from './sms/index.ts';
import { SmsError } from './sms/types.ts';

type Call = { url: string; init: RequestInit };
const recorder = (status = 200) => {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status }); }) as unknown as typeof fetch;
  return { calls, fetchFn };
};
const msg = { to: '+201012345678', code: '482913', text: 'PawsPal: your code is 482913' };

test('generic-http: sends the message with your own URL, headers and body template', async () => {
  const { calls, fetchFn } = recorder();
  const p = genericHttpProvider(envFrom({
    SMS_HTTP_URL: 'https://sms.example.eg/v1/send',
    SMS_HTTP_HEADERS: '{"Authorization":"Bearer abc","X-Sender":"PawsPal"}',
    SMS_HTTP_BODY: '{"recipients":["{{to_digits}}"],"sender":"PawsPal","text":"{{message}}","meta":{"code":"{{code}}"}}',
  }));
  await p.send(msg, { fetch: fetchFn });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://sms.example.eg/v1/send');
  assert.equal(calls[0].init.method, 'POST');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer abc');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { recipients: ['201012345678'], sender: 'PawsPal', text: 'PawsPal: your code is 482913', meta: { code: '482913' } });
});

test('generic-http: default body, and form format', async () => {
  const a = recorder();
  await genericHttpProvider(envFrom({ SMS_HTTP_URL: 'https://x.example/send' })).send(msg, { fetch: a.fetchFn });
  assert.deepEqual(JSON.parse(a.calls[0].init.body as string), { to: '+201012345678', message: 'PawsPal: your code is 482913' });
  const b = recorder();
  await genericHttpProvider(envFrom({ SMS_HTTP_URL: 'https://x.example/send', SMS_HTTP_FORMAT: 'form', SMS_HTTP_BODY: '{"mobile":"{{to_digits}}","msg":"{{message}}"}' })).send(msg, { fetch: b.fetchFn });
  assert.equal((b.calls[0].init.headers as Record<string, string>)['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(b.calls[0].init.body as string).get('mobile'), '201012345678');
});

test('generic-http: placeholders are filled safely (quotes cannot break the JSON)', () => {
  assert.deepEqual(fillTemplate({ a: '{{message}}' }, { message: 'He said "hi" \\ {{code}}' }), { a: 'He said "hi" \\ {{code}}' });
});

test('generic-http: refuses unsafe or broken settings', () => {
  assert.throws(() => genericHttpProvider(envFrom({})), ConfigError);
  assert.throws(() => genericHttpProvider(envFrom({ SMS_HTTP_URL: 'http://plain.example/send' })), ConfigError);
  assert.throws(() => genericHttpProvider(envFrom({ SMS_HTTP_URL: 'https://x.example', SMS_HTTP_BODY: '{bad' })), ConfigError);
  assert.throws(() => genericHttpProvider(envFrom({ SMS_HTTP_URL: 'https://x.example', SMS_HTTP_FORMAT: 'xml' })), ConfigError);
});

test('generic-http: a failing provider throws an error that holds no number, code or reply', async () => {
  const { fetchFn } = recorder(500);
  const p = genericHttpProvider(envFrom({ SMS_HTTP_URL: 'https://x.example/send' }));
  await assert.rejects(p.send(msg, { fetch: fetchFn }), (e: Error) => {
    assert.ok(e instanceof SmsError);
    assert.doesNotMatch(e.message, /482913|201012345678/);
    return true;
  });
  const boom = (async () => { throw new Error('connect ECONNREFUSED to +201012345678 with 482913'); }) as unknown as typeof fetch;
  await assert.rejects(p.send(msg, { fetch: boom }), (e: Error) => { assert.doesNotMatch(e.message, /482913|201012345678/); return true; });
});

test('whatsapp-cloud: sends an authentication template through the Cloud API', async () => {
  const { calls, fetchFn } = recorder();
  const p = whatsappCloudProvider(envFrom({ WHATSAPP_PHONE_NUMBER_ID: '123456789', WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_TEMPLATE_NAME: 'pawspal_otp' }));
  await p.send(msg, { fetch: fetchFn });
  assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/123456789/messages');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.to, '201012345678');
  assert.equal(body.template.name, 'pawspal_otp');
  assert.equal(body.template.language.code, 'ar');
  assert.equal(body.template.components[0].parameters[0].text, '482913');
  assert.throws(() => whatsappCloudProvider(envFrom({ WHATSAPP_PHONE_NUMBER_ID: '1' })), ConfigError);
  assert.throws(() => whatsappCloudProvider(envFrom({ WHATSAPP_PHONE_NUMBER_ID: '../x', WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_TEMPLATE_NAME: 'n' })), ConfigError);
});

test('registry: reads SMS_PROVIDERS in order, and nothing set means no provider', () => {
  assert.deepEqual(smsProvidersFromEnv(envFrom({})), []);
  const env = envFrom({ SMS_PROVIDERS: 'whatsapp-cloud, generic-http', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_TEMPLATE_NAME: 'n', SMS_HTTP_URL: 'https://x.example/send' });
  assert.deepEqual(smsProvidersFromEnv(env).map((p) => p.name), ['whatsapp-cloud', 'generic-http']);
  assert.throws(() => smsProvidersFromEnv(envFrom({ SMS_PROVIDERS: 'twilio' })), /Unknown SMS provider/);
});

test('sendCode: falls back to the next provider, and fails only when all fail', async () => {
  const log: string[] = [];
  const fail = (name: string) => ({ name, async send() { log.push(name); throw new SmsError(name, 503); } });
  const ok = (name: string) => ({ name, async send() { log.push(name); } });
  const deps = { fetch: (() => { throw new Error('unused'); }) as unknown as typeof fetch };
  assert.equal(await sendCode([fail('a'), ok('b'), ok('c')], msg, deps), 'b');
  assert.deepEqual(log, ['a', 'b']);
  await assert.rejects(sendCode([fail('a'), fail('b')], msg, deps), SmsError);
  await assert.rejects(sendCode([], msg, deps), SmsError);
});

test('smsText: bilingual by default, or your own wording', () => {
  assert.equal(smsText(envFrom({}), '123456'), 'PawsPal: your code is 123456 | رمز PawsPal: 123456');
  assert.equal(smsText(envFrom({ SMS_MESSAGE: 'كود {{code}}' }), '9'), 'كود 9');
});
