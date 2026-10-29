// Steps 2 and 3 of sign-up: the selfie check and the ID check. The provider is chosen by the IDENTITY_PROVIDER setting.
// Nothing is approved unless a provider is configured. PawsPal stores no ID image: only the result and a one-way
// hash of the document, which stops one document opening two accounts and stops banned people returning.
import type { Env } from '../config.ts';
import { ConfigError } from '../config.ts';
import { sha256Hex } from '../crypto.ts';
import { bearerToken, json, readJson, type Rpc } from '../http.ts';
import { identityProviderFromEnv } from '../identity/index.ts';

export interface IdentityDeps {
  env: Env;
  authUser(token: string): Promise<{ id: string } | null>;
  download(bucket: string, path: string): Promise<Uint8Array | null>;
  rpc: Rpc;
}

export async function handleVerifyIdentity(req: Request, deps: IdentityDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = bearerToken(req);
  const user = token ? await deps.authUser(token) : null;
  if (!user) return json(401, { error: 'unauthorized' });

  const body = await readJson(req, 2 * 1024);
  const step = body?.step;
  if (!body || (step !== 'face' && step !== 'id')) return json(400, { error: 'invalid_request' });

  let provider;
  try { provider = identityProviderFromEnv(deps.env); } catch (e) {
    if (e instanceof ConfigError) return json(503, { error: 'not_configured' });
    throw e;
  }
  if (!provider) return json(503, { error: 'not_configured' });

  const deviceId = typeof body.device_id === 'string' && body.device_id.length >= 8 && body.device_id.length <= 80 ? body.device_id : null;
  const devHash = deviceId ? await sha256Hex('device:' + deviceId) : null;
  // Test outcomes exist only for the fake provider.
  const testOutcome = provider.name === 'fake' && typeof body.test_outcome === 'string' ? body.test_outcome : undefined;

  if (step === 'face') {
    const facePath = typeof body.face_path === 'string' ? body.face_path : '';
    if (!new RegExp(`^${user.id}/[A-Za-z0-9._-]{1,100}$`).test(facePath)) return json(400, { error: 'invalid_request' });
    const image = await deps.download('faces', facePath);
    if (!image) return json(404, { error: 'not_found' });
    const result = await provider.checkFace({ userId: user.id, image, testOutcome });
    if (!result.ok) return json(200, { ok: false, face: false });
    const saved = await deps.rpc('record_verification', {
      p_user: user.id, p_face: true, p_id: null, p_adult: null, p_face_path: facePath, p_id_hash: null, p_device_hash: devHash });
    if (saved.error) return json(502, { error: 'try_again_later' });
    if (saved.data !== 'ok') return json(403, { error: 'identity_refused' });   // never says why
    return json(200, { ok: true, face: true });
  }

  const result = await provider.checkId({ userId: user.id, testOutcome });
  if (!result.ok) return json(200, { ok: false, id: false });
  const saved = await deps.rpc('record_verification', {
    p_user: user.id, p_face: null, p_id: true, p_adult: result.isAdult, p_face_path: null, p_id_hash: result.documentHash, p_device_hash: devHash });
  if (saved.error) return json(502, { error: 'try_again_later' });
  if (saved.data !== 'ok') return json(403, { error: 'identity_refused' });
  return json(200, { ok: true, id: true, adult: result.isAdult });
}
