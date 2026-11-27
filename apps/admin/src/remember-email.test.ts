import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cleanEmail, EMAIL_KEY, forgetEmail, readRememberedEmail, rememberEmail, type EmailStorage } from './remember-email.ts';

const memory = (): EmailStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};
const broken: EmailStorage = {
  getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); },
};

test('the email is remembered under one key, and only the address is stored', () => {
  const s = memory();
  assert.equal(readRememberedEmail(s), '');
  assert.equal(rememberEmail('  admin@example.test ', s), true);
  assert.equal(EMAIL_KEY, 'pawspal-admin.email');
  assert.deepEqual([...s.data.entries()], [[EMAIL_KEY, 'admin@example.test']]);
  assert.equal(readRememberedEmail(s), 'admin@example.test');
});

test('"Not you? Use another email" forgets it', () => {
  const s = memory();
  rememberEmail('admin@example.test', s);
  forgetEmail(s);
  assert.equal(readRememberedEmail(s), '');
  assert.equal(s.data.size, 0);
});

test('a missing or failing storage never throws and just means "not remembered"', () => {
  assert.equal(readRememberedEmail(broken), '');
  assert.equal(rememberEmail('admin@example.test', broken), false);
  assert.doesNotThrow(() => forgetEmail(broken));
  assert.equal(readRememberedEmail(null), '');
  assert.equal(rememberEmail('admin@example.test', null), false);
  assert.doesNotThrow(() => forgetEmail(null));
});

test('only something that looks like one address is stored or prefilled', () => {
  const s = memory();
  for (const bad of ['', '   ', 'no-at-sign', '@x.test', 'a@', 'a@b@c', 'a b@c.test', 'a@b.test\nsecret', 'x'.repeat(255) + '@a.test']) {
    assert.equal(cleanEmail(bad), null, JSON.stringify(bad));
    assert.equal(rememberEmail(bad, s), false);
  }
  assert.equal(s.data.size, 0);
  assert.equal(cleanEmail(42), null);
  // a value planted in storage that is not an address (or is a password-like string with spaces) is ignored
  s.data.set(EMAIL_KEY, 'my password is hunter2');
  assert.equal(readRememberedEmail(s), '');
  s.data.set(EMAIL_KEY, '{"a":1}');
  assert.equal(readRememberedEmail(s), '');
});

test('the sign-in form is one real form with the fields password managers look for, and the password is never stored', () => {
  const shell = readFileSync(new URL('./shell.tsx', import.meta.url), 'utf8');
  const form = shell.slice(shell.indexOf('function SignIn('), shell.indexOf('/** Everything the site shows'));
  assert.match(form, /<form onSubmit=\{submit\}/);
  assert.match(form, /type="email" name="email" autoComplete="username" inputMode="email"/);
  assert.match(form, /type="password" name="password" autoComplete="current-password"/);
  assert.match(form, /type="submit"/);
  assert.match(form, /Not you\? Use another email/);
  assert.match(form, /rememberEmail\(email\)/);
  assert.doesNotMatch(form, /rememberEmail\(password|localStorage|sessionStorage/);
  const lib = readFileSync(new URL('./remember-email.ts', import.meta.url), 'utf8');
  assert.equal((lib.match(/setItem\(/g) ?? []).length, 2, 'one in the interface, one call');
});
