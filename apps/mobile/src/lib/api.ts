// Talks to the Edge Functions. The app never sends a phone number or a device id anywhere else.
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import type { Key } from '../i18n';

const base = () => `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1`;

export class ApiError extends Error {
  constructor(public code: string, public status: number, public data: Record<string, unknown> = {}) { super(code); }
}

/** Which sentence to show for each error code the functions can return. */
const ERROR_KEYS: Record<string, Key> = {
  invalid_phone: 'err.invalid_phone', phone_limit: 'err.phone_limit', device_limit: 'err.device_limit',
  too_many_attempts: 'err.too_many_attempts', captcha_required: 'err.too_many_attempts', too_soon: 'err.too_soon',
  send_failed: 'err.send_failed', invalid_code: 'err.invalid_code', try_again_later: 'err.try_again_later',
  not_configured: 'err.not_configured', identity_refused: 'err.identity_refused', invalid_image: 'err.invalid_image',
  network: 'err.network', captcha_failed: 'err.captcha_failed', request_new_code: 'err.request_new_code',
};
export const errorKey = (e: unknown): Key => (e instanceof ApiError ? ERROR_KEYS[e.code] : undefined) ?? 'err.generic';

const DEVICE_KEY = 'pawspal.device';
let cachedDevice: string | null = null;

/** A random id made on this phone and kept in the keychain. The server stores only a one-way hash of it. */
export async function deviceId(): Promise<string> {
  if (cachedDevice) return cachedDevice;
  let id: string | null = null;
  try { id = await SecureStore.getItemAsync(DEVICE_KEY); } catch { /* fall through to a new id */ }
  if (!id) {
    id = Crypto.randomUUID();
    try { await SecureStore.setItemAsync(DEVICE_KEY, id); } catch { /* the id still works until the app closes */ }
  }
  cachedDevice = id;
  return id;
}

async function call<T>(name: string, body: Record<string, unknown>, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(typeof data.error === 'string' ? data.error : 'generic', res.status, data);
  return data as T;
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new ApiError('unauthorized', 401);
  return data.session.access_token;
}

export async function requestOtp(phone: string, captchaToken?: string): Promise<{ resend_after_seconds: number }> {
  return call('request-otp', { phone, device_id: await deviceId(), ...(captchaToken ? { captcha_token: captchaToken } : {}) });
}

/** Checks the code and signs the person in on this phone. */
export async function verifyOtp(phone: string, token: string, captchaToken?: string): Promise<void> {
  const s = await call<{ access_token: string; refresh_token: string }>('verify-otp',
    { phone, token, device_id: await deviceId(), ...(captchaToken ? { captcha_token: captchaToken } : {}) });
  const { error } = await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  if (error) throw new ApiError('try_again_later', 0);
}

export type UploadKind = 'face' | 'pet' | 'home';

/**
 * Sends a photo to the private "incoming" folder, then asks the server to clean it (all hidden data, including GPS,
 * is removed) and save it. The app never writes the real folders itself. Returns the clean file's path.
 */
export async function uploadPhoto(kind: UploadKind, uri: string): Promise<string> {
  const token = await accessToken();
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new ApiError('unauthorized', 401);
  let bytes: ArrayBuffer;
  try { bytes = await (await fetch(uri)).arrayBuffer(); } catch { throw new ApiError('invalid_image', 0); }
  const path = `${uid}/${Crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from('incoming').upload(path, bytes, { contentType: 'image/jpeg' });
  if (up.error) throw new ApiError('try_again_later', 0);
  const done = await call<{ path: string }>('process-upload', { kind, path }, token);
  return done.path;
}

/** Face step needs the cleaned selfie's path; the ID step needs nothing from the app (the provider looks at the ID). */
export async function verifyFace(facePath: string): Promise<boolean> {
  const r = await call<{ ok: boolean }>('verify-identity', { step: 'face', face_path: facePath, device_id: await deviceId() }, await accessToken());
  return r.ok;
}

/** Asks the server for a checkout page for the booking fee. The amount is the server's; the app never sends one. */
export async function createFeePayment(bookingId: string): Promise<{ url: string; payment_id: string; amount_egp: number }> {
  return call('create-fee-payment', { booking_id: bookingId }, await accessToken());
}

export async function verifyId(): Promise<{ ok: boolean; adult: boolean }> {
  const r = await call<{ ok: boolean; adult?: boolean }>('verify-identity', { step: 'id', device_id: await deviceId() }, await accessToken());
  return { ok: r.ok, adult: r.adult !== false };
}
