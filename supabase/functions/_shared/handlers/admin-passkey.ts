// Admin sign-in, step two: a passkey (WebAuthn). The admin site calls this after the email + password step.
//
// The database is the judge: this function only proves, with the WebAuthn library, that a registered passkey (or a one-time
// recovery code) answered, and then asks the database to mark THIS Supabase session as verified (private.admin_passkey_sessions).
// public.is_admin() is true only for such a session. The user id and the session id come from the verified JWT, never from the body.
// Nothing here is logged: no token, code, challenge or credential data.
import { bearerToken, json, readJson, type Rpc } from '../http.ts';
import type { Env } from '../config.ts';

type Bytes = Uint8Array<ArrayBuffer>;

/** The four library calls this handler needs (the real @simplewebauthn/server fits; tests may pass a fake). */
export interface WebAuthnApi {
  generateRegistrationOptions(opts: {
    rpName: string; rpID: string; userName: string; userDisplayName: string; userID: Bytes; challenge: Bytes;
    timeout: number; attestationType: 'none';
    excludeCredentials: { id: string; transports?: string[] }[];
    authenticatorSelection: { residentKey: 'preferred'; userVerification: 'required' };
  }): Promise<{ challenge: string }>;
  verifyRegistrationResponse(opts: {
    response: any; expectedChallenge: string; expectedOrigin: string; expectedRPID: string;
    requireUserPresence: boolean; requireUserVerification: boolean;
  }): Promise<{
    verified: boolean;
    registrationInfo?: {
      credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] };
      credentialDeviceType: string; credentialBackedUp: boolean; userVerified: boolean;
    };
  }>;
  generateAuthenticationOptions(opts: {
    rpID: string; allowCredentials: { id: string; transports?: string[] }[]; userVerification: 'required'; challenge: Bytes; timeout: number;
  }): Promise<{ challenge: string }>;
  verifyAuthenticationResponse(opts: {
    response: any; expectedChallenge: string; expectedOrigin: string; expectedRPID: string;
    credential: { id: string; publicKey: Bytes; counter: number; transports?: string[] };
    requireUserVerification: boolean;
  }): Promise<{ verified: boolean; authenticationInfo: { newCounter: number } }>;
}

export interface AdminPasskeyDeps {
  /** The user and Supabase session of a verified access token, or null. The session id is the JWT claim `session_id`. */
  authUser(token: string): Promise<{ id: string; sessionId: string } | null>;
  rpc: Rpc;
  webauthn: WebAuthnApi;
  env: Env;
  random(bytes: number): Bytes;
  now(): number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // 32 characters, no 0 O 1 I: one random byte & 31 picks one, evenly
const PASSKEY_MINUTES = 8 * 60;
const RECOVERY_MINUTES = 30;
const OPTIONS_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------- small helpers
export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(text: string): Bytes {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The Supabase session id inside an access token the auth server already accepted. Null when absent or not a uuid. */
export function sessionIdFromJwt(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(part)));
    const sid = claims && typeof claims === 'object' ? (claims as Record<string, unknown>).session_id : null;
    return typeof sid === 'string' && UUID.test(sid) ? sid.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Upper case, letters and digits only: "abcd-efgh ..." and "ABCDEFGH..." are the same code. */
export const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** One recovery code: 16 characters from a 32-character alphabet (80 bits), shown as XXXX-XXXX-XXXX-XXXX. */
function makeRecoveryCode(random: (n: number) => Bytes): string {
  const bytes = random(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += ALPHABET[bytes[i] & 31];
  return out.replace(/(.{4})(?=.)/g, '$1-');
}

interface Config { rpId: string; rpName: string; origin: string }

/** Reads the three settings. Null (= not configured) when one is missing or does not fit together. */
export function adminConfig(env: Env): Config | null {
  const rpId = (env.get('ADMIN_RP_ID') ?? '').trim().toLowerCase();
  const origin = (env.get('ADMIN_ORIGIN') ?? '').trim();
  const rpName = (env.get('ADMIN_RP_NAME') ?? '').trim();
  if (!rpId || !origin || !rpName || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(rpId)) return null;
  let url: URL;
  try { url = new URL(origin); } catch { return null; }
  if (url.origin !== origin) return null;                                           // exactly one origin: no path, no list
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) return null;
  if (url.hostname !== rpId && !url.hostname.endsWith('.' + rpId)) return null;      // the RP ID must be the site's own domain
  return { rpId, rpName, origin };
}

const REFUSED = () => json(403, { error: 'not_allowed' });
const BAD = () => json(400, { error: 'invalid_request' });
const BUSY = () => json(502, { error: 'try_again_later' });
const TOO_MANY = () => json(429, { error: 'too_many_attempts' });

function withCors(res: Response, origin: string | null, allowed: string | null): Response {
  const h = new Headers(res.headers);
  h.append('Vary', 'Origin');
  if (origin !== null && allowed !== null && origin === allowed) {
    h.set('Access-Control-Allow-Origin', allowed);
    h.set('Access-Control-Allow-Headers', 'authorization, content-type, apikey, x-client-info');
    h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    h.set('Access-Control-Max-Age', '600');
  }
  return new Response(res.body, { status: res.status, headers: h });
}

interface State {
  is_admin_row: boolean;
  passkeys: { id: string; name: string; created_at: string; last_used_at: string | null; device_type: string | null; backed_up: boolean | null }[];
  verified: boolean;
  via: 'passkey' | 'recovery' | null;
  expires_at: string | null;
  /** A fresh passkey proof (login, registration or step_up_verify) in the last 5 minutes. */
  step_up: boolean;
  recovery_codes_left: number;
  /** Too many failures: 5 an hour for this Supabase session, 20 for the user (a verified session only counts its own). */
  locked: boolean;
}

// ---------------------------------------------------------------- the handler
export async function handleAdminPasskey(req: Request, deps: AdminPasskeyDeps): Promise<Response> {
  const cfg = adminConfig(deps.env);
  const origin = req.headers.get('origin');
  const done = (res: Response) => withCors(res, origin, cfg ? cfg.origin : null);

  if (req.method === 'OPTIONS') return done(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return done(json(405, { error: 'method_not_allowed' }));
  if (!cfg) return done(json(503, { error: 'not_configured' }));
  // A browser always names its origin. Anything but the admin site's own address is refused (no CORS headers either).
  if (origin !== null && origin !== cfg.origin) return done(REFUSED());

  const token = bearerToken(req);
  const user = token ? await deps.authUser(token) : null;
  if (!user || !UUID.test(user.id) || !UUID.test(user.sessionId)) return done(json(401, { error: 'unauthorized' }));
  const body = await readJson(req, 16 * 1024);
  if (!body || typeof body.action !== 'string') return done(BAD());

  try {
    return done(await route(body.action, body, user, cfg, deps));
  } catch {
    return done(BUSY());      // a library or network failure; never echo the reason
  }
}

async function route(action: string, body: Record<string, unknown>, user: { id: string; sessionId: string }, cfg: Config, deps: AdminPasskeyDeps): Promise<Response> {
  const { rpc, webauthn } = deps;
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc(name, args);
    if (r.error) throw new Error('rpc');
    return r.data;
  };
  const note = (kind: string, details: Record<string, unknown> = {}, session: string | null = null) => call('pk_note', { p_user: user.id, p_kind: kind, p_details: details, p_session: session });
  const fail = async (reason: string) => { await note('login_failed', { reason }, user.sessionId); return REFUSED(); };
  const state = (await call('pk_state', { p_user: user.id, p_session: user.sessionId })) as State | null;
  if (!state || state.is_admin_row !== true) return REFUSED();              // every action first needs an admins row

  const viaPasskey = state.verified && state.via === 'passkey';
  const failed = state.locked === true;
  const STEP_UP = () => json(403, { error: 'step_up_required' });       // the one refusal with its own body
  const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
  const nameOf = (v: unknown): string | null | undefined => {            // undefined = fine, absent; null = invalid
    if (v === undefined || v === null) return undefined;
    const s = str(v, 200)?.trim();
    return s && s.length >= 1 && s.length <= 40 ? s : null;
  };

  switch (action) {
    case 'status': {
      const status = state.verified ? 'admin' : state.passkeys.length === 0 ? 'needs_setup' : 'needs_passkey';
      return json(200, { ok: true, status, verified: state.verified, via: state.via, passkeys: state.passkeys, recovery_codes_left: state.recovery_codes_left, step_up: state.step_up });
    }

    case 'register_options': {
      const name = nameOf(body.name);
      if (name === null) return BAD();
      const code = str(body.setup_code, 64);
      if (code) {
        // A founder setup code opens this door on its own (and needs no step-up).
        const c = await call('pk_check_setup_code', { p_user: user.id, p_session: user.sessionId, p_code: code });
        if (c === 'locked') return TOO_MANY();
        if (c !== 'ok') return REFUSED();
      } else {
        // Otherwise: a verified session. A password alone never registers a passkey; a passkey session also needs a fresh proof
        // (a stolen access token is not enough); a recovery session has no passkey to prove with and is exempt.
        if (!state.verified) return REFUSED();
        if (failed) return TOO_MANY();
        if (viaPasskey && !state.step_up) return STEP_UP();
      }
      if (state.passkeys.length >= 10) return json(400, { error: 'passkey_limit' });
      const existing = (await call('pk_credentials', { p_user: user.id })) as { id: string; transports?: string[] }[];
      const handle = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pawspal-admin-passkey:' + user.id)));
      const options = await webauthn.generateRegistrationOptions({
        rpName: cfg.rpName, rpID: cfg.rpId, userName: name ?? 'PawsPal admin', userDisplayName: name ?? 'PawsPal admin',
        userID: handle, challenge: deps.random(32), timeout: OPTIONS_TIMEOUT_MS, attestationType: 'none',
        excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      });
      await call('pk_new_challenge', { p_user: user.id, p_session: user.sessionId, p_purpose: 'register', p_challenge: options.challenge });
      return json(200, { ok: true, options });
    }

    case 'register_verify': {
      const name = nameOf(body.name);
      const response = body.response;
      if (name === null || !response || typeof response !== 'object' || Array.isArray(response)) return BAD();
      const setupCode = str(body.setup_code, 64);
      if (!setupCode) {
        if (!state.verified) return REFUSED();
        if (viaPasskey && !state.step_up) return STEP_UP();
      }
      if (failed) return TOO_MANY();
      const challenge = await call('pk_take_challenge', { p_user: user.id, p_session: user.sessionId, p_purpose: 'register' });
      if (typeof challenge !== 'string') return REFUSED();
      let verified: Awaited<ReturnType<WebAuthnApi['verifyRegistrationResponse']>> | null = null;
      try {
        verified = await webauthn.verifyRegistrationResponse({
          response, expectedChallenge: challenge, expectedOrigin: cfg.origin, expectedRPID: cfg.rpId,
          requireUserPresence: true, requireUserVerification: true,
        });
      } catch { verified = null; }
      const info = verified?.verified ? verified.registrationInfo : undefined;
      if (!info || info.userVerified !== true) {
        return fail('register');
      }
      const label = name ?? `Passkey ${new Date(deps.now()).toISOString().slice(0, 10)}`;
      const added = (await call('pk_add_credential', {
        p_user: user.id, p_credential_id: info.credential.id, p_public_key: b64urlEncode(info.credential.publicKey),
        p_counter: info.credential.counter, p_transports: info.credential.transports ?? null,
        p_device_type: info.credentialDeviceType, p_backed_up: info.credentialBackedUp, p_name: label, p_setup_code: setupCode || null, p_session: user.sessionId,
      })) as { status: string; id?: string } | null;
      switch (added?.status) {
        case 'ok': break;
        case 'limit': return json(400, { error: 'passkey_limit' });
        case 'duplicate': return json(409, { error: 'already_registered' });
        case 'invalid': return BAD();
        default: return REFUSED();                                           // bad_setup_code, not_allowed
      }
      const until = await call('pk_start_session', { p_user: user.id, p_session: user.sessionId, p_passkey_id: added.id, p_via: 'passkey', p_minutes: PASSKEY_MINUTES });
      if (typeof until !== 'string') return BUSY();
      await note('passkey_added', { name: label, device_type: info.credentialDeviceType, backed_up: info.credentialBackedUp });
      if (setupCode) await note('setup');
      await note('passkey_login', { reason: 'register' });
      return json(200, { ok: true, passkey: { id: added.id, name: label }, session: { via: 'passkey', expires_at: until } });
    }

    case 'login_options':
    case 'step_up_options': {
      const stepUp = action === 'step_up_options';
      if (state.passkeys.length === 0 || (stepUp && !viaPasskey)) return REFUSED();
      if (failed) return TOO_MANY();
      const creds = (await call('pk_credentials', { p_user: user.id })) as { id: string; transports?: string[] }[];
      const options = await webauthn.generateAuthenticationOptions({
        rpID: cfg.rpId, allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
        userVerification: 'required', challenge: deps.random(32), timeout: OPTIONS_TIMEOUT_MS,
      });
      await call('pk_new_challenge', { p_user: user.id, p_session: user.sessionId, p_purpose: stepUp ? 'stepup' : 'login', p_challenge: options.challenge });
      return json(200, { ok: true, options });
    }

    case 'login_verify':
    case 'step_up_verify': {
      const stepUp = action === 'step_up_verify';
      const response = body.response as Record<string, unknown> | undefined;
      if (!response || typeof response !== 'object' || Array.isArray(response) || typeof response.id !== 'string' || response.id.length > 1024) return BAD();
      if (state.passkeys.length === 0 || (stepUp && !viaPasskey)) return REFUSED();
      if (failed) return TOO_MANY();
      const purpose = stepUp ? 'stepup' : 'login';
      const challenge = await call('pk_take_challenge', { p_user: user.id, p_session: user.sessionId, p_purpose: purpose });
      if (typeof challenge !== 'string') return fail('challenge');
      const cred = (await call('pk_credential', { p_user: user.id, p_credential_id: response.id })) as
        { id: string; credential_id: string; public_key: string; counter: number | string; transports: string[] } | null;
      if (!cred) return fail('unknown_credential');
      let result: Awaited<ReturnType<WebAuthnApi['verifyAuthenticationResponse']>> | null = null;
      try {
        result = await webauthn.verifyAuthenticationResponse({
          response, expectedChallenge: challenge, expectedOrigin: cfg.origin, expectedRPID: cfg.rpId,
          credential: { id: cred.credential_id, publicKey: b64urlDecode(cred.public_key), counter: Number(cred.counter), transports: cred.transports },
          requireUserVerification: true,
        });
      } catch { result = null; }
      if (!result?.verified) return fail('verify');
      // Clone detection: the counter must grow (0 and 0 is fine for synced passkeys).
      const counterOk = await call('pk_use_counter', { p_id: cred.id, p_new: result.authenticationInfo.newCounter });
      if (counterOk !== true) return fail('counter');
      if (stepUp) {
        const until = await call('pk_set_step_up', { p_user: user.id, p_session: user.sessionId });
        if (typeof until !== 'string') return BUSY();
        return json(200, { ok: true, until });
      }
      const until = await call('pk_start_session', { p_user: user.id, p_session: user.sessionId, p_passkey_id: cred.id, p_via: 'passkey', p_minutes: PASSKEY_MINUTES });
      if (typeof until !== 'string') return BUSY();
      await note('passkey_login');
      return json(200, { ok: true, session: { via: 'passkey', expires_at: until } });
    }

    case 'recovery_login': {
      const code = str(body.code, 64);
      if (!code) return BAD();
      // Already verified by a passkey: nothing to do and no code is used up.
      if (viaPasskey) return json(200, { ok: true, session: { via: 'passkey', expires_at: state.expires_at } });
      if (failed) return TOO_MANY();
      const normal = normaliseCode(code);
      if (normal.length !== 16) return REFUSED();                            // obviously not one of ours: not counted as a guess
      // One database step: the code is used up and the 30 minute session starts together, so a failure cannot lose a code.
      const r = (await call('pk_use_recovery_code', { p_user: user.id, p_session: user.sessionId, p_hash: await sha256Hex(normal) })) as { status: string; expires_at?: string } | null;
      if (r?.status === 'locked') return TOO_MANY();
      if (r?.status === 'already') return json(200, { ok: true, session: { via: 'passkey', expires_at: r.expires_at } });
      if (r?.status !== 'ok') return REFUSED();
      await note('recovery_used');
      return json(200, { ok: true, session: { via: state.verified ? state.via : 'recovery', expires_at: r.expires_at } });
    }

    case 'recovery_generate': {
      if (!viaPasskey) return REFUSED();                                     // a recovery session cannot make new recovery codes
      if (!state.step_up) return STEP_UP();
      const codes = Array.from({ length: 10 }, () => makeRecoveryCode(deps.random));
      const hashes = await Promise.all(codes.map((c) => sha256Hex(normaliseCode(c))));
      await call('pk_replace_recovery_codes', { p_user: user.id, p_hashes: hashes });
      await note('recovery_generated');
      return json(200, { ok: true, codes });
    }

    case 'rename': {
      if (!viaPasskey) return REFUSED();
      if (!state.step_up) return STEP_UP();
      const name = nameOf(body.name);
      if (typeof body.id !== 'string' || !UUID.test(body.id) || name === undefined || name === null) return BAD();
      const ok = await call('pk_rename', { p_user: user.id, p_id: body.id, p_name: name });
      if (ok !== true) return json(404, { error: 'not_found' });
      await note('passkey_renamed', { name });
      return json(200, { ok: true });
    }

    case 'remove': {
      if (!viaPasskey) return REFUSED();
      if (!state.step_up) return STEP_UP();
      if (typeof body.id !== 'string' || !UUID.test(body.id)) return BAD();
      const r = await call('pk_remove', { p_user: user.id, p_id: body.id });
      if (r === 'last') return json(409, { error: 'last_passkey' });
      if (r !== 'ok') return json(404, { error: 'not_found' });
      await note('passkey_removed');
      return json(200, { ok: true });
    }

    case 'sign_out': {
      await call('pk_end_session', { p_session: user.sessionId });
      return json(200, { ok: true });
    }

    default:
      return BAD();
  }
}
