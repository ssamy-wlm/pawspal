// Every photo goes through here. The app uploads a raw file to incoming/<its own id>/, then calls this function.
// We clean it (no GPS or other hidden data), save the clean copy under a random name in the real bucket, and delete
// the raw file. The app can never write the real buckets itself.
import { json, readJson, bearerToken, type Rpc } from '../http.ts';
import { ImageError, sanitizeImage } from '../image.ts';

export interface StorageOps {
  download(bucket: string, path: string): Promise<Uint8Array | null>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<boolean>;
  remove(bucket: string, path: string): Promise<void>;
}

export interface UploadDeps {
  authUser(token: string): Promise<{ id: string } | null>;
  storage: StorageOps;
  rpc: Rpc;
  randomId(): string;
}

const BUCKET_FOR: Record<string, string> = { face: 'faces', pet: 'pets', home: 'homes', handover: 'handovers' };

export async function handleProcessUpload(req: Request, deps: UploadDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = bearerToken(req);
  const user = token ? await deps.authUser(token) : null;
  if (!user) return json(401, { error: 'unauthorized' });

  const body = await readJson(req, 2 * 1024);
  const kind = typeof body?.kind === 'string' ? body.kind : '';
  const path = typeof body?.path === 'string' ? body.path : '';
  const bucket = BUCKET_FOR[kind];
  // The raw file must be one this person uploaded to their own incoming folder.
  const ownFile = new RegExp(`^${user.id}/[A-Za-z0-9._-]{1,100}$`);
  if (!bucket || !ownFile.test(path) || path.includes('..')) return json(400, { error: 'invalid_request' });

  const raw = await deps.storage.download('incoming', path);
  if (!raw) return json(404, { error: 'not_found' });

  let cleaned;
  try {
    cleaned = sanitizeImage(raw);
  } catch (e) {
    await deps.storage.remove('incoming', path);          // do not keep a file we refused
    if (e instanceof ImageError) return json(422, { error: 'invalid_image', reason: e.code });
    throw e;
  }

  const finalPath = `${user.id}/${deps.randomId()}.${cleaned.info.type === 'png' ? 'png' : 'jpg'}`;
  const saved = await deps.storage.upload(bucket, finalPath, cleaned.bytes, cleaned.info.type === 'png' ? 'image/png' : 'image/jpeg');
  if (!saved) return json(502, { error: 'try_again_later' });
  await deps.storage.remove('incoming', path);

  if (kind === 'home') {
    const attached = await deps.rpc('attach_home_photo', { p_user: user.id, p_path: finalPath });
    if (attached.error) return json(502, { error: 'try_again_later' });
  }
  return json(200, { path: finalPath });
}
