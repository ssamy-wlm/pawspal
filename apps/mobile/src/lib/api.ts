// Talks to the Edge Functions and holds the plain-sentence error mapping. The device id (a random id made on this phone)
// goes only to sign-up; the server stores a one-way hash of it.
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { getItem, setItem } from './storage';
import type { Key } from '../i18n';

const base = () => `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1`;

export class ApiError extends Error {
  constructor(public code: string, public status: number, public data: Record<string, unknown> = {}) { super(code); }
}

/** Which sentence to show for each error code the functions can return. */
const ERROR_KEYS: Record<string, Key> = {
  try_again_later: 'err.try_again_later', invalid_image: 'err.invalid_image', network: 'err.network',
};
export const errorKey = (e: unknown): Key => (e instanceof ApiError ? ERROR_KEYS[e.code] : undefined) ?? 'err.generic';

interface AuthLikeError { code?: string; status?: number; name?: string; message?: string }

/** Which sentence to show for an error from Supabase Auth (sign-up, sign-in, reset). Never includes the person's details. */
export function authErrorKey(e: unknown): Key {
  const err = (e ?? {}) as AuthLikeError;
  const code = err.code ?? '';
  const msg = (err.message ?? '').toLowerCase();
  if (err.name === 'AuthRetryableFetchError' || err.status === 0 || /network|failed to fetch/.test(msg)) return 'err.network';
  if (code === 'user_already_exists' || code === 'email_exists' || /already (been )?registered|already exists/.test(msg)) return 'err.emailTaken';
  if (code === 'weak_password' || /password.*(weak|at least|short)/.test(msg)) return 'err.weakPassword';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || err.status === 429) return 'err.rateLimited';
  if (code === 'email_not_confirmed' || /not confirmed/.test(msg)) return 'err.emailNotConfirmed';
  if (code === 'validation_failed' || code === 'email_address_invalid') return 'err.emailInvalid';
  if (/database error saving new user|unexpected_failure/.test(msg) || code === 'unexpected_failure') return 'err.signupRefused';
  return 'err.generic';
}

const DEVICE_KEY = 'pawspal.device';
let cachedDevice: string | null = null;

/** A random id made on this phone and kept in the keychain. The server stores only a one-way hash of it. */
export async function deviceId(): Promise<string> {
  if (cachedDevice) return cachedDevice;
  let id: string | null = null;
  try { id = await getItem(DEVICE_KEY); } catch { /* fall through to a new id */ }
  if (!id) {
    id = Crypto.randomUUID();
    try { await setItem(DEVICE_KEY, id); } catch { /* the id still works until the app closes */ }
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

export type UploadKind = 'face' | 'id' | 'payment' | 'pet' | 'home' | 'handover';

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

/** A link (good for a minute) to a handover photo of a booking I am in. The server checks I am in it. */
export async function handoverPhotoUrl(photoId: string): Promise<string> {
  return (await call<{ url: string }>('handover-photo-url', { photo_id: photoId }, await accessToken())).url;
}

/** "Something is wrong with the pet": the other person is alerted and the team gets a high-priority report. */
export async function sendEmergency(bookingId: string, note: string | null): Promise<'sent' | 'already_sent'> {
  const r = await call<{ status: 'sent' | 'already_sent' }>('emergency', { booking_id: bookingId, ...(note ? { note } : {}) }, await accessToken());
  return r.status;
}
