import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, envFrom } from './config.ts';
import { emailProviderFromEnv } from './email/index.ts';
import { smtpProvider, smtpSettingsFromEnv, SmtpError, type SmtpMessage, type SmtpTransport } from './email/smtp.ts';
import { handleMembershipReminders } from './handlers/membership-reminders.ts';

const GOOD = { EMAIL_PROVIDER: 'smtp', SMTP_USER: 'pawspal.app@gmail.com', SMTP_PASSWORD: 'abcdefghijklmnop', EMAIL_FROM: 'PawsPal <pawspal.app@gmail.com>' };
const MSG = { to: 'ana@example.test', subject: 'Your PawsPal membership renews soon', text: 'Hi Ana' };

function fakeTransport(fail?: unknown) {
  const sent: SmtpMessage[] = [];
  const t: SmtpTransport = { async sendMail(m) { sent.push(m); if (fail) throw fail; return {}; } };
  return { t, sent };
}
const coded = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('535 5.7.8 Username and Password not accepted for ana@example.test abcdefghijklmnop'), { code, ...extra });

test('smtp config: defaults and the good case', () => {
  const s = smtpSettingsFromEnv(envFrom(GOOD));
  assert.equal(s.host, 'smtp.gmail.com');
  assert.equal(s.port, 465);
  const s2 = smtpSettingsFromEnv(envFrom({ ...GOOD, SMTP_PORT: '465', SMTP_HOST: 'smtp.gmail.com' }));
  assert.equal(s2.port, 465);
});

test('smtp config: missing values are ConfigErrors', () => {
  for (const key of ['SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM']) {
    const env = { ...GOOD, [key]: undefined };
    assert.throws(() => smtpSettingsFromEnv(envFrom(env)), ConfigError, key);
  }
  assert.throws(() => smtpSettingsFromEnv(envFrom({ ...GOOD, SMTP_PASSWORD: '' })), ConfigError);
});

test('smtp config: only port 465; 25 and 587 are refused by name, anything else too', () => {
  for (const port of ['25', '587', '2525', '0', 'abc', '4650', ' 465x']) {
    assert.throws(() => smtpSettingsFromEnv(envFrom({ ...GOOD, SMTP_PORT: port })), ConfigError, port);
  }
  assert.throws(() => smtpSettingsFromEnv(envFrom({ ...GOOD, SMTP_PORT: '587' })), /blocked/);
});

test('smtp config: on Gmail the From address must equal SMTP_USER', () => {
  assert.throws(() => smtpSettingsFromEnv(envFrom({ ...GOOD, EMAIL_FROM: 'PawsPal <other@gmail.com>' })), ConfigError);
  assert.throws(() => smtpSettingsFromEnv(envFrom({ ...GOOD, EMAIL_FROM: 'not an address' })), ConfigError);
  assert.throws(() => smtpSettingsFromEnv(envFrom({ ...GOOD, EMAIL_FROM: 'a@b@c.test' })), ConfigError);
  smtpSettingsFromEnv(envFrom({ ...GOOD, EMAIL_FROM: 'pawspal.app@gmail.com' }));                  // bare address is fine
  smtpSettingsFromEnv(envFrom({ ...GOOD, EMAIL_FROM: 'PawsPal <PawsPal.App@gmail.com>' }));        // case does not matter
  // another host may use another From address
  smtpSettingsFromEnv(envFrom({ ...GOOD, SMTP_HOST: 'smtp.example.test', EMAIL_FROM: 'PawsPal <hello@example.test>' }));
});

test('smtp config: CR/LF in settings is refused', () => {
  assert.throws(() => smtpSettingsFromEnv(envFrom({ ...GOOD, EMAIL_FROM: 'PawsPal <pawspal.app@gmail.com>\r\nBcc: x@example.test' })), ConfigError);
  assert.throws(() => smtpSettingsFromEnv(envFrom({ ...GOOD, SMTP_USER: 'pawspal.app@gmail.com\n' + 'x' })), ConfigError);
  assert.throws(() => smtpSettingsFromEnv(envFrom({ ...GOOD, SMTP_HOST: 'smtp.example.test\r\nx' })), ConfigError);
});

test('smtp send: builds the right message', async () => {
  const { t, sent } = fakeTransport();
  let seen: unknown;
  const p = smtpProvider(envFrom(GOOD), (s) => { seen = s; return t; });
  assert.equal(p.name, 'smtp');
  assert.equal((seen as { port: number }).port, 465);
  await p.send(MSG);
  assert.deepEqual(sent, [{ from: 'PawsPal <pawspal.app@gmail.com>', to: 'ana@example.test', subject: MSG.subject, text: MSG.text }]);
});

test('smtp send: header injection and non-single addresses never reach the transport', async () => {
  const { t, sent } = fakeTransport();
  const p = smtpProvider(envFrom(GOOD), () => t);
  const bad = [
    { ...MSG, to: 'ana@example.test\r\nBcc: x@example.test' },
    { ...MSG, to: 'ana@example.test\nx' },
    { ...MSG, subject: 'Hi\r\nBcc: x@example.test' },
    { ...MSG, subject: 'Hi\nx' },
    { ...MSG, to: 'a@example.test, b@example.test' },
    { ...MSG, to: 'Ana <ana@example.test>' },
    { ...MSG, to: 'not-an-address' },
    { ...MSG, to: '' },
  ];
  for (const m of bad) {
    await assert.rejects(p.send(m), (e: Error) => e instanceof SmtpError && e.message === 'smtp rejected' && !e.message.includes('example'));
  }
  assert.equal(sent.length, 0);
});

test('smtp send: each failure maps to a category without leaking details', async () => {
  const cases: [unknown, string][] = [
    [coded('EAUTH', { responseCode: 535 }), 'auth_failed'],
    [coded('EAUTH'), 'auth_failed'],
    [coded('ECONNECTION'), 'connect_failed'],
    [coded('ESOCKET'), 'connect_failed'],
    [coded('ECONNREFUSED'), 'connect_failed'],
    [new Error('whatever ana@example.test'), 'connect_failed'],
    [coded('EENVELOPE', { responseCode: 550 }), 'rejected'],
    [coded('EMESSAGE', { responseCode: 554 }), 'rejected'],
    [coded('ETIMEDOUT'), 'timeout'],
    [coded('ESOCKET', { code: 'ETIMEDOUT' }), 'timeout'],
  ];
  for (const [err, category] of cases) {
    const p = smtpProvider(envFrom(GOOD), () => fakeTransport(err).t);
    await assert.rejects(p.send(MSG), (e: Error) => {
      assert.ok(e instanceof SmtpError);
      assert.equal((e as SmtpError).category, category);
      assert.equal(e.message, `smtp ${category}`);
      for (const secret of ['ana@example.test', 'abcdefghijklmnop', '535', 'Username']) assert.ok(!e.message.includes(secret) && !String(e.cause ?? '').includes(secret));
      return true;
    });
  }
});

test('smtp send: a hung server times out', async () => {
  const hung: SmtpTransport = { sendMail: () => new Promise(() => undefined) };
  const p = smtpProvider(envFrom(GOOD), () => hung, 20);
  await assert.rejects(p.send(MSG), (e: Error) => e instanceof SmtpError && e.category === 'timeout');
});

test('email provider selection: resend, smtp, unknown', () => {
  const rt = { smtpTransport: () => fakeTransport().t };
  assert.equal(emailProviderFromEnv(envFrom({ RESEND_API_KEY: 'k', EMAIL_FROM: 'a@example.test' }), rt).name, 'resend');
  assert.equal(emailProviderFromEnv(envFrom({ ...GOOD }), rt).name, 'smtp');
  assert.throws(() => emailProviderFromEnv(envFrom({ ...GOOD, EMAIL_PROVIDER: 'nope' }), rt), ConfigError);
  assert.throws(() => emailProviderFromEnv(envFrom({ ...GOOD }), {}), ConfigError, 'no client in this runtime');
  assert.throws(() => emailProviderFromEnv(envFrom({ ...GOOD, SMTP_PORT: '587' }), rt), ConfigError);
});

test('membership-reminders through smtp: a provider failure is counted and not marked; bad config is 503', async () => {
  const KEY = 'reminder-secret-with-enough-length-0123456789';
  const calls: string[] = [];
  const rpc = async (name: string) => {
    calls.push(name);
    return name === 'list_due_reminders'
      ? { data: [{ user_id: 'u1', email: 'ana@example.test', first_name: 'Ana', locale: 'en', paid_until: '2027-01-10', amount_egp: 25 }], error: null }
      : { data: null, error: null };
  };
  const req = () => new Request('http://x', { method: 'POST', headers: { 'x-reminder-secret': KEY } });
  const rt = { smtpTransport: () => fakeTransport(coded('EAUTH', { responseCode: 535 })).t };
  const env = envFrom({ ...GOOD, REMINDER_SECRET: KEY });
  const res = await handleMembershipReminders(req(), { env, rpc, provider: (e) => emailProviderFromEnv(e, rt) });
  assert.deepEqual(await res.json(), { sent: 0, failed: 1 });
  assert.ok(!calls.includes('mark_reminded'));
  const bad = await handleMembershipReminders(req(), { env: envFrom({ ...GOOD, REMINDER_SECRET: KEY, SMTP_PORT: '587' }), rpc, provider: (e) => emailProviderFromEnv(e, rt) });
  assert.equal(bad.status, 503);
});
