// A by-hand check of the passkey sign-in in a real browser (Chromium via Playwright). It is NOT part of CI because Playwright
// is not a dependency of the repo. Run it from apps/admin after `npm install`:
//   NODE_PATH=$(npm root -g) node scripts/passkey-browser-check.mjs
// It starts a tiny stand-in for Supabase (sign-in, admin_status and the admin-passkey function, checked with the real
// @simplewebauthn/server), builds the admin site against it into .next-passkey-check, serves it, and drives Chromium with a
// virtual authenticator through: setup code -> passkey -> recovery codes -> Security page -> sign out -> sign in with the
// passkey -> sign in with a recovery code. It also checks that no content-policy error appears, and the faster sign-in:
// the email is remembered on this device (second visit), the passkey prompt starts by itself after the password step (a
// cancelled one falls back to the button without looping, and the recovery-code and setup-code paths do not start it), and
// an expired passkey session (the stub can expire it) brings back "Use your passkey" on the same page without signing out.
// MEASURE=1 only counts the network round trips of the sign-in (with an 80 ms stand-in delay) and stops.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const STUB = 4310;
const SITE = 4311;
const ORIGIN = `http://localhost:${SITE}`;
const SUPABASE = `http://localhost:${STUB}`;
const RP_ID = 'localhost';
const EMAIL = 'admin@example.test';
const SETUP_CODE = 'SETUP-TEST-1234';
const MEASURE = process.env.MEASURE === '1';
const DELAY = MEASURE ? 80 : 0;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// ---------------------------------------------------------------- the stand-in for Supabase
const db = { freshUntil: 0, stepUps: 0, sessionId: 'a1b2c3d4-0000-4000-8000-000000000000', passkeys: [], codes: [], challenge: null, verified: false, via: null, userId: '00000000-0000-4000-8000-000000000001' };
const status = () => (db.passkeys.length === 0 ? 'needs_setup' : db.verified ? 'admin' : 'needs_passkey');
const freshCodes = () => { db.codes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex').match(/.{5}/g).join('-')); return db.codes.slice(); };
const sessionId = () => db.sessionId;
const token = () => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: db.userId, session_id: sessionId(), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.stub`;

const reqs = [];      // what the browser asked the stand-in, in order: [label, time]
const fresh = () => db.freshUntil > Date.now();

async function fn(body) {
  const { action } = body;
  const fail = (error) => ({ code: 400, json: { error } });
  const ok = (json = { ok: true }) => ({ code: 200, json });
  const stepUp = () => ({ code: 403, json: { error: 'step_up_required' } });
  if (action === 'status') {
    return ok({ passkeys: db.passkeys.map((p) => ({ id: p.id, name: p.name, created_at: p.created_at, last_used_at: p.last_used_at, device_type: p.deviceType, backed_up: p.backedUp })), verified: db.verified, via: db.verified ? db.via : null, recovery_codes_left: db.codes.length });
  }
  if (action === 'register_options') {
    if (body.setup_code !== SETUP_CODE) { if (!db.verified) return fail('not_allowed'); if (!fresh()) return stepUp(); }   // a valid setup code also works when passkeys exist
    const options = await generateRegistrationOptions({
      rpName: 'PawsPal Admin', rpID: RP_ID, userName: EMAIL, userID: new TextEncoder().encode(db.userId),
      excludeCredentials: db.passkeys.map((p) => ({ id: p.credential.id, transports: p.credential.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    db.challenge = options.challenge;
    return ok({ options });
  }
  if (action === 'register_verify') {
    if (body.setup_code !== SETUP_CODE) { if (!db.verified) return fail('not_allowed'); if (!fresh()) return stepUp(); }
    const v = await verifyRegistrationResponse({ response: body.response, expectedChallenge: db.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true }).catch(() => null);
    if (!v?.verified) return fail('not_allowed');
    const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
    db.passkeys.push({ id: randomBytes(8).toString('hex'), name: body.name || 'This device', created_at: new Date().toISOString(), last_used_at: null, credential, deviceType: credentialDeviceType, backedUp: credentialBackedUp });
    db.verified = true; db.via = 'passkey';
    if (body.setup_code) db.freshUntil = Date.now() + 5 * 60_000;       // the first-time flow goes on to make recovery codes
    return ok();
  }
  if (action === 'login_options') {
    const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required', allowCredentials: db.passkeys.map((p) => ({ id: p.credential.id, transports: p.credential.transports })) });
    db.challenge = options.challenge;
    return ok({ options });
  }
  if (action === 'login_verify') {
    const p = db.passkeys.find((x) => x.credential.id === body.response?.id);
    if (!p) return fail('not_allowed');
    const v = await verifyAuthenticationResponse({ response: body.response, expectedChallenge: db.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, credential: p.credential, requireUserVerification: true }).catch(() => null);
    if (!v?.verified) return fail('not_allowed');
    p.credential.counter = v.authenticationInfo.newCounter; p.last_used_at = new Date().toISOString();
    db.verified = true; db.via = 'passkey';
    return ok();
  }
  if (action === 'recovery_login') {
    const i = db.codes.indexOf(body.code);
    if (i < 0) return fail('not_allowed');
    db.codes.splice(i, 1); db.verified = true; db.via = 'recovery';
    return ok();
  }
  if (!db.verified) return fail('not_allowed');
  if (action === 'step_up_options') {
    const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required', allowCredentials: db.passkeys.map((p) => ({ id: p.credential.id, transports: p.credential.transports })) });
    db.challenge = options.challenge;
    return ok({ options });
  }
  if (action === 'step_up_verify') {
    const p = db.passkeys.find((x) => x.credential.id === body.response?.id);
    if (!p) return fail('not_allowed');
    const v = await verifyAuthenticationResponse({ response: body.response, expectedChallenge: db.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, credential: p.credential, requireUserVerification: true }).catch(() => null);
    if (!v?.verified) return fail('not_allowed');
    p.credential.counter = v.authenticationInfo.newCounter;
    db.freshUntil = Date.now() + 5 * 60_000; db.stepUps += 1;
    return ok({ ok: true, until: new Date(db.freshUntil).toISOString() });
  }
  if (['rename', 'remove', 'recovery_generate'].includes(action) && !fresh()) return stepUp();
  if (action === 'recovery_generate') return ok({ codes: freshCodes() });
  if (action === 'rename') { const p = db.passkeys.find((x) => x.id === body.id); if (!p) return fail('invalid_request'); p.name = body.name; return ok(); }
  if (action === 'remove') { if (db.passkeys.length < 2) return fail('not_allowed'); db.passkeys = db.passkeys.filter((x) => x.id !== body.id); return ok(); }
  if (action === 'sign_out') { db.verified = false; db.via = null; return ok(); }
  return fail('invalid_request');
}

const stub = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile, range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'content-range');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  let raw = ''; for await (const c of req) raw += c;
  const url = new URL(req.url, SUPABASE);
  const send = (code, json) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(json)); };
  const label = url.pathname.startsWith('/functions/v1/') ? `fn:${JSON.parse(raw || '{}').action}` : url.pathname.replace('/rest/v1/rpc/', 'rpc:').replace('/auth/v1/', 'auth:');
  reqs.push([label, Date.now()]);
  if (DELAY) await new Promise((r) => setTimeout(r, DELAY));
  try {
    if (url.pathname.startsWith('/rest/v1/') && url.pathname !== '/rest/v1/rpc/admin_status' && !db.verified && db.passkeys.length) return send(403, { code: '42501', message: 'permission denied' });   // the passkey session ran out
    if (url.pathname === '/auth/v1/token') {
      db.verified = false; db.via = null;                                  // every password sign-in is a new session
      db.sessionId = `${randomBytes(4).toString('hex')}-0000-4000-8000-000000000000`;
      const user = { id: db.userId, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      return send(200, { access_token: token(), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
    }
    if (url.pathname === '/auth/v1/logout') { res.statusCode = 204; res.end(); return; }
    if (url.pathname === '/rest/v1/rpc/admin_status') return send(200, status());
    if (url.pathname.startsWith('/rest/v1/rpc/')) return send(200, {});
    if (url.pathname.startsWith('/rest/v1/')) return send(200, []);
    if (url.pathname === '/functions/v1/admin-passkey') {
      assert.ok((req.headers.authorization ?? '').startsWith('Bearer ey'), 'the function call carries the access token');
      assert.ok(req.headers.apikey, 'the function call carries the anon key');
      const out = await fn(JSON.parse(raw || '{}'));
      return send(out.code, out.json);
    }
    send(404, { error: 'not found' });
  } catch (e) { console.error('stub error', e); send(500, { error: 'stub' }); }
});

// ---------------------------------------------------------------- the site
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-key', NEXT_PUBLIC_TURNSTILE_SITE_KEY: '', NEXT_DIST_DIR: '.next-passkey-check', NEXT_TELEMETRY_DISABLED: '1' };
let site;
// The site runs in its own process group so that stopping it also stops the server npx started (a leftover one would serve an old build).
const killSite = () => { try { if (site?.pid) process.kill(-site.pid); } catch { /* already gone */ } };
const stop = () => { killSite(); stub.close(); };
process.on('exit', killSite);

async function startSite() {
  console.log('building the admin site against the stand-in ...');
  // `next build` can stop once with an upgrade notice about the pinned Next.js version; a second run goes through.
  let build = spawnSync('npx', ['next', 'build'], { env, stdio: 'pipe', encoding: 'utf8' });
  if (build.status !== 0) build = spawnSync('npx', ['next', 'build'], { env, stdio: 'pipe', encoding: 'utf8' });
  if (build.status !== 0) { console.error(build.stdout + build.stderr); throw new Error('build failed'); }
  site = spawn('npx', ['next', 'start', '-p', String(SITE)], { env, stdio: 'pipe', detached: true });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(ORIGIN); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('site did not start');
}

// ---------------------------------------------------------------- the browser
const steps = [];
let lastPage = null;
const step = (name) => { steps.push(name); console.log(`ok  ${name}`); };

async function main() {
  await new Promise((r) => stub.listen(STUB, r));
  await startSite();
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  lastPage = page;
  const problems = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));

  if (!MEASURE) await page.clock.install();       // timers run normally; the check can jump 5 minutes ahead later
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  let { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const heading = (name) => page.getByRole('heading', { name });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const signIn = async () => { if (!(await page.getByLabel('Email').inputValue())) await page.getByLabel('Email').fill(EMAIL); await page.getByLabel('Password').fill('a-long-test-password'); await button('Sign in').click(); };
  const count = (label, from = 0) => reqs.slice(from).filter(([l]) => l === label).length;
  const AUTO_HINT = 'Press "Use your passkey" when you are ready.';
  const verifiedTouch = (v) => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: v });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1. password, then the setup screen
  await page.goto(ORIGIN);
  assert.equal(await page.getByLabel('Email').inputValue(), '', 'first visit: no email remembered');
  const emailInput = page.getByLabel('Email'), passwordInput = page.getByLabel('Password');
  if (!MEASURE) assert.deepEqual(await emailInput.evaluate((e) => [e.type, e.name, e.autocomplete, e.inputMode, !!e.closest('form')]), ['email', 'email', 'username', 'email', true]);
  if (!MEASURE) assert.deepEqual(await passwordInput.evaluate((e) => [e.type, e.name, e.autocomplete, !!e.closest('form')]), ['password', 'password', 'current-password', true]);
  step('the email and password fields carry the password-manager attributes inside one form');
  await emailInput.fill(EMAIL); await passwordInput.fill('a-long-test-password'); await passwordInput.press('Enter');
  step('Enter in the password field submits the form');
  await heading('Set up your passkey').waitFor();
  assert.equal(count('fn:login_options'), 0, 'the setup screen never starts a prompt by itself');
  step('the setup screen does not start a passkey prompt by itself');
  await page.getByText(`Session code: ${db.sessionId.slice(0, 8).toUpperCase()}`).waitFor();
  step('the setup screen shows "Session code" matching the session id in the token');
  step('sign in with the password leads to "Set up your passkey" (admin_status = needs_setup)');

  // 2. a wrong setup code is refused with one calm sentence
  await page.getByLabel('Setup code').fill('WRONG');
  await button('Create passkey').click();
  await page.getByRole('alert').filter({ hasText: 'That did not work' }).waitFor();
  step('a wrong setup code gets a calm one-line error');

  // 3. the right code creates a passkey and shows the recovery codes
  await page.getByLabel('Setup code').fill(SETUP_CODE);
  await page.getByLabel('Name of this device').fill('Test laptop');
  await button('Create passkey').click();
  await heading('Save your recovery codes').waitFor();
  const codes = await page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem').allTextContents();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.ok(await button('Continue').isDisabled(), 'Continue waits for the checkbox');
  step('the passkey is created with the virtual authenticator and 10 recovery codes are shown, Continue is off');
  const [download] = await Promise.all([page.waitForEvent('download'), button('Download as text file').click()]);
  assert.equal(download.suggestedFilename(), 'pawspal-admin-recovery-codes.txt');
  step('"Download as text file" gives the codes file');
  await page.getByLabel('I saved these codes somewhere safe').check();
  await button('Continue').click();
  await heading('Overview').waitFor();
  step('after the checkbox, Continue opens the site (admin_status = admin)');
  if (MEASURE) {
    // Round trips of the sign-in path with an 80 ms stand-in delay: password step, passkey step, and a reload of an open site.
    await button('Sign out').click(); await heading('Admin').waitFor();
    const lines = []; const report = (name, from, t0) => lines.push(`${name}: ${reqs.length - from} requests, ${Date.now() - t0} ms  [${reqs.slice(from).map(([l]) => l).join(', ')}]`);
    let from = reqs.length, t0 = Date.now();
    await signIn();
    const first = await Promise.race([heading('Use your passkey').waitFor().then(() => 'screen'), page.getByRole('navigation', { name: 'Main' }).waitFor().then(() => 'site')]);
    if (first === 'screen') {
      report('password -> passkey screen', from, t0); from = reqs.length; t0 = Date.now();
      await button('Use your passkey').click();
      await page.getByRole('navigation', { name: 'Main' }).waitFor();
      report('button press -> site', from, t0);
    } else report('password -> site (passkey started by itself)', from, t0);
    await wait(300);
    from = reqs.length; t0 = Date.now();
    await page.reload(); await page.getByRole('navigation', { name: 'Main' }).waitFor();
    report('reload of the open site -> site', from, t0);
    console.log('MEASURED\n' + lines.join('\n'));
    await browser.close();
    return;
  }

  // 4. the Security page
  await page.getByRole('link', { name: 'Security' }).click();
  await heading('Security').waitFor();
  await page.getByText('Test laptop').waitFor();
  assert.ok(await button('Remove').isDisabled(), 'the only passkey cannot be removed');
  await page.getByText('cannot be removed').waitFor();
  step('Security lists "Test laptop"; the last passkey cannot be removed and says why');
  // Step-up: the fresh touch has run out. A cancelled touch stops the rename; a real one lets it through.
  db.freshUntil = 0;
  await button('Rename').click();
  await page.getByLabel('New name').fill('My laptop');
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  await button('Save name').click();
  await heading('Touch your passkey to continue').waitFor();
  await button('Touch your passkey').click();
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: 'passkey prompt was closed' }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'passkey prompt was closed' }).waitFor();
  assert.equal(db.passkeys[0].name, 'Test laptop', 'a cancelled touch changes nothing');
  step('step-up: a cancelled passkey touch shows a calm message and the rename does not happen');
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
  await button('Save name').click();
  await heading('Touch your passkey to continue').waitFor();
  await button('Touch your passkey').click();
  await page.locator('strong', { hasText: 'My laptop' }).waitFor();
  assert.equal(db.stepUps, 1);
  assert.equal(db.passkeys[0].name, 'My laptop');
  step('step-up: "Touch your passkey to continue" appears, the touch passes, and the rename is retried and works');
  await page.getByLabel('Name of this device').fill('Same device again');
  await button('Add a passkey').click();
  await page.getByRole('alert').filter({ hasText: 'already has a passkey' }).waitFor();
  step('adding a second passkey on the same device gives the "already registered" message');
  await page.getByText('You have 10 recovery codes left.').waitFor();
  db.freshUntil = 0;
  await button('Make new codes').click();
  await page.getByText('The old codes stop working at once.').waitFor();
  await button('Yes, make new codes').click();
  await heading('Touch your passkey to continue').waitFor();
  await button('Touch your passkey').click();
  await heading('Save your recovery codes').waitFor();
  assert.equal(db.stepUps, 2);
  step('step-up: making new recovery codes asks for a touch first');
  let newCodes = await page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem').allTextContents();
  assert.equal(newCodes.length, 10);
  assert.equal(newCodes.filter((c) => codes.includes(c)).length, 0, 'the new codes are all new');
  assert.ok(await button('Done').isDisabled());
  await page.getByLabel('I saved these codes somewhere safe').check();
  await button('Done').click();
  await page.getByText('You have 10 recovery codes left.').waitFor();
  step('"Make new codes" asks first, shows 10 new codes, and the old ones are replaced');

  // 5. sign out, then the email is already there on the second visit
  await button('Sign out').click();
  await heading('Admin').waitFor();
  assert.equal(db.verified, false, 'sign_out reached the function');
  step('Sign out ends the passkey session on the function and returns to the sign-in');
  assert.equal(await page.getByLabel('Email').inputValue(), EMAIL);
  assert.equal(await page.evaluate(() => localStorage.getItem('pawspal-admin.email')), EMAIL);
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('pawspal-admin')));
  assert.deepEqual(stored, [['pawspal-admin.email', EMAIL]], 'only the address is kept by this site');
  assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('a-long-test-password'), 'the password is never stored');
  assert.equal(await page.getByLabel('Password').evaluate((e) => e === document.activeElement), true, 'the cursor is in the password field');
  step('second visit: the email is prefilled (only the address is stored, never the password) and the cursor is on the password');

  // The prompt starts by itself, but here the touch is refused, so it falls back to the button.
  await verifiedTouch(false);
  let m = reqs.length;
  await signIn();
  await heading('Use your passkey').waitFor();
  await page.getByText(`Session code: ${db.sessionId.slice(0, 8).toUpperCase()}`).waitFor();
  step('sign in with the password leads to "Use your passkey" (admin_status = needs_passkey) and shows "Session code"');
  await page.getByRole('alert').filter({ hasText: AUTO_HINT }).waitFor();
  assert.equal(count('fn:login_options', m), 1, 'the prompt started by itself, once');
  assert.equal(count('fn:login_verify', m), 0);
  assert.ok(await button('Use your passkey').isEnabled(), 'the button is the fallback');
  assert.equal(await page.getByRole('alert').filter({ hasText: 'went wrong' }).count(), 0);
  await wait(1500);
  assert.equal(count('fn:login_options', m), 1, 'a cancelled automatic prompt is not repeated (no loop)');
  step('the passkey prompt starts by itself after the password step; a cancelled one gives a calm hint, the button stays, and it does not loop');

  // Coming back from the setup-code view does not start it again.
  await button('I have a setup code').click();
  await heading('Set up your passkey').waitFor();
  await button('Back').click();
  await heading('Use your passkey').waitFor();
  await wait(500);
  assert.equal(count('fn:login_options', m), 1, 'back from the setup code does not start the prompt');
  step('coming back from "I have a setup code" does not start the prompt again');

  // A second device with a setup code, from the passkey screen ("I have a setup code").
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  ({ authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } }));
  await button('I have a setup code').click();
  await heading('Set up your passkey').waitFor();
  await page.getByLabel('Setup code').fill(SETUP_CODE);
  await page.getByLabel('Name of this device').fill('Second device');
  await button('Create passkey').click();
  await heading('Save your recovery codes').waitFor();
  newCodes = await page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem').allTextContents();
  await page.getByLabel('I saved these codes somewhere safe').check();
  await button('Continue').click();
  await page.getByRole('navigation', { name: 'Main' }).waitFor();
  assert.equal(db.passkeys.length, 2);
  step('"I have a setup code" on the passkey screen adds a second passkey on an account that already has one');
  await button('Sign out').click();
  await verifiedTouch(false);
  await signIn();
  await heading('Use your passkey').waitFor();
  await page.getByRole('alert').filter({ hasText: AUTO_HINT }).waitFor();
  step('a refused prompt (virtual authenticator says no) leaves the button, with the calm hint');
  await verifiedTouch(true);
  await button('Use your passkey').click();
  await page.getByRole('navigation', { name: 'Main' }).waitFor();       // the site opens on the page the person was on
  assert.equal(db.verified, true);
  step('pressing the button still works: login_options, startAuthentication, login_verify open the site');

  // The happy path: the person only touches the sensor.
  await button('Sign out').click();
  await heading('Admin').waitFor();
  m = reqs.length;
  await signIn();
  await page.getByRole('navigation', { name: 'Main' }).waitFor();
  assert.equal(count('fn:login_options', m), 1);
  assert.equal(count('fn:login_verify', m), 1);
  assert.ok(db.passkeys.some((x) => x.last_used_at), 'the function saw the login');
  step('with a working sensor the password step goes straight through the passkey (login_options, login_verify) to the site, no button press');
  assert.equal(count('rpc:admin_status', m), 2, 'admin_status once after the password and once after the passkey');
  assert.equal(count('fn:status', m), 0, 'no extra status call after the passkey sign-in');

  // 5b. The passkey session runs out while the person is working: back to "Use your passkey" on the same page, still signed in.
  await page.getByRole('link', { name: 'Security' }).click();
  await heading('Security').waitFor();
  db.verified = false;                                            // the stand-in lets the 8 hours run out
  m = reqs.length;
  await page.getByRole('link', { name: 'Overview' }).click();      // this page's requests are refused
  await heading('Use your passkey').waitFor();
  await page.getByText('Your passkey check ran out. Touch your passkey to carry on where you were.').waitFor();
  assert.equal(count('auth:logout', m), 0, 'the person was not signed out');
  assert.equal(await page.evaluate(() => location.pathname), '/', 'the address is the page the person was on');
  await wait(800);
  assert.equal(count('fn:login_options', m), 0, 'no prompt starts by itself in the middle of work');
  assert.equal(await page.getByText(/permission denied|42501|JWT|Error/).count(), 0, 'no raw error');
  await button('Use your passkey').click();
  await heading('Overview').waitFor();
  assert.equal(await page.evaluate(() => location.pathname), '/');
  step('a refused request after the passkey session ran out shows "Use your passkey" on the same page without signing out; the touch brings the page back');
  // The same when nothing was clicked: the 5 minute re-check finds it.
  m = reqs.length;
  db.verified = false;
  await page.clock.fastForward('05:05');
  await heading('Use your passkey').waitFor();
  assert.ok(count('rpc:admin_status', m) >= 1, 'the timer asked admin_status');
  assert.equal(count('auth:logout', m), 0);
  assert.equal(count('fn:login_options', m), 0);
  await button('Use your passkey').click();
  await heading('Overview').waitFor();
  step('the 5 minute re-check finds an expired passkey session by itself and shows "Use your passkey" (no sign-out, no automatic prompt)');

  // 6. a recovery code, then the banner (the automatic prompt is refused so the recovery path can be reached)
  await button('Sign out').click();
  await heading('Admin').waitFor();
  await verifiedTouch(false);
  m = reqs.length;
  await signIn();
  await heading('Use your passkey').waitFor();
  await page.getByRole('alert').filter({ hasText: AUTO_HINT }).waitFor();
  await button('Use a recovery code').click();
  await verifiedTouch(true);                                       // even with a working sensor, the recovery path never starts a prompt
  await page.getByLabel('Recovery code').fill('not-a-real-code');
  await button('Use this code').click();
  await page.getByRole('alert').filter({ hasText: 'That did not work' }).waitFor();
  await wait(500);
  assert.equal(count('fn:login_options', m), 1, 'the recovery-code path does not start the passkey prompt');
  step('the recovery-code path does not start the passkey prompt');
  await page.getByLabel('Recovery code').fill(` ${newCodes[0].slice(0, 5)} ${newCodes[0].slice(5)} `);
  assert.equal(await page.getByLabel('Recovery code').inputValue().then((v) => v.replace(/\s/g, '')), newCodes[0]);
  await button('Use this code').click();
  await page.getByRole('navigation', { name: 'Main' }).waitFor();
  await page.getByText('You came in with a recovery code.').first().waitFor();
  step('a recovery code signs in, and the "You came in with a recovery code" banner is on the page');
  await page.getByRole('link', { name: 'Security' }).click();
  await page.getByRole('link', { name: 'Add a new passkey now.' }).waitFor();
  await page.getByText('Add a new passkey now.', { exact: false }).nth(1).waitFor();
  assert.equal(db.codes.length, 9, 'the code was used up');
  step('the Security page carries the same notice, and the used code is gone (9 left)');

  // "Not you? Use another email" forgets the address.
  await button('Sign out').click();
  await heading('Admin').waitFor();
  assert.equal(await page.getByLabel('Email').inputValue(), EMAIL);
  await button('Not you? Use another email').click();
  assert.equal(await page.getByLabel('Email').inputValue(), '');
  assert.equal(await page.evaluate(() => localStorage.getItem('pawspal-admin.email')), null);
  await page.reload();
  await heading('Admin').waitFor();
  assert.equal(await page.getByLabel('Email').inputValue(), '');
  step('"Not you? Use another email" clears the field and forgets the address, also after a reload');

  // 7. passkeys do not need extra permissions in the policy
  assert.deepEqual(problems, [], 'no content-policy or script errors');
  step('no content-policy or script errors in the browser console');

  await browser.close();
}

main().then(
  () => { stop(); console.log(MEASURE ? '\nMeasured.' : `\nPasskey browser check passed (${steps.length} steps).`); process.exit(0); },
  async (e) => { console.error('\nPasskey browser check FAILED:', e); console.error('The page showed:', await lastPage?.locator('body').innerText().catch(() => '(nothing)')); stop(); process.exit(1); },
);
