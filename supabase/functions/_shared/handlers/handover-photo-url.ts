// The booking partner's handover photo. The files are private: nobody can read the other side's photo straight from
// storage. The database says whether this person is in the booking; if so, we hand back a link that works for a minute.
import { bearerToken, json, readJson, type Rpc } from '../http.ts';

export interface SignedUrlOps {
  signedUrl(bucket: string, path: string, seconds: number): Promise<string | null>;
}

export interface HandoverUrlDeps {
  authUser(token: string): Promise<{ id: string } | null>;
  rpc: Rpc;
  urls: SignedUrlOps;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HANDOVER_URL_SECONDS = 60;

export async function handleHandoverPhotoUrl(req: Request, deps: HandoverUrlDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = bearerToken(req);
  const user = token ? await deps.authUser(token) : null;
  if (!user) return json(401, { error: 'unauthorized' });
  const body = await readJson(req, 1024);
  if (!body || typeof body.photo_id !== 'string' || !UUID.test(body.photo_id)) return json(400, { error: 'invalid_request' });

  const found = await deps.rpc('handover_photo_for', { p_user: user.id, p_photo: body.photo_id });
  if (found.error) return json(502, { error: 'try_again_later' });
  if (typeof found.data !== 'string' || found.data === '') return json(404, { error: 'not_found' });   // not in this booking looks the same as not there

  const url = await deps.urls.signedUrl('handovers', found.data, HANDOVER_URL_SECONDS);
  if (!url) return json(502, { error: 'try_again_later' });
  return json(200, { url, expires_in: HANDOVER_URL_SECONDS });
}
