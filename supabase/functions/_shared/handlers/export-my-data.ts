// "Download my data." The database gathers everything that belongs to the caller (export_user_data); this function adds links
// (valid one hour) to the caller's own photo files. Three exports a day. Nothing is logged.
import { bearerToken, json, type Rpc } from '../http.ts';
import type { SignedUrlOps } from './handover-photo-url.ts';

export interface ExportDeps {
  authUser(token: string): Promise<{ id: string } | null>;
  rpc: Rpc;
  urls: SignedUrlOps;
  now?: () => Date;
}

export const EXPORT_URL_SECONDS = 3600;
const BUCKETS = new Set(['faces', 'pets', 'homes', 'handovers']);

export async function handleExportMyData(req: Request, deps: ExportDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = bearerToken(req);
  const user = token ? await deps.authUser(token) : null;
  if (!user) return json(401, { error: 'unauthorized' });

  const allowed = await deps.rpc('note_data_export', { p_user: user.id });
  if (allowed.error) return json(502, { error: 'try_again_later' });
  if (allowed.data !== true) return json(429, { error: 'too_many_attempts' });

  const exported = await deps.rpc('export_user_data', { p_user: user.id });
  if (exported.error) return json(502, { error: 'try_again_later' });
  if (!exported.data || typeof exported.data !== 'object' || Array.isArray(exported.data)) return json(404, { error: 'not_found' });
  const { files: listed, ...data } = exported.data as Record<string, unknown>;

  const files: { kind: string; name: string; url: string }[] = [];
  for (const f of Array.isArray(listed) ? (listed as { kind?: unknown; bucket?: unknown; path?: unknown }[]) : []) {
    // Only the caller's own files: their folder, a known bucket, no way out of the folder.
    if (typeof f.kind !== 'string' || typeof f.bucket !== 'string' || typeof f.path !== 'string') continue;
    if (!BUCKETS.has(f.bucket) || !f.path.startsWith(`${user.id}/`) || f.path.includes('..')) continue;
    const url = await deps.urls.signedUrl(f.bucket, f.path, EXPORT_URL_SECONDS);
    if (url) files.push({ kind: f.kind, name: f.path.slice(user.id.length + 1), url });
  }
  return json(200, { ok: true, exported_at: (deps.now?.() ?? new Date()).toISOString(), data, files });
}
