// A scheduled clean-up of photo files nobody uses: raw uploads that were never processed, and clean photos that no pet or
// profile points to (a photo added and never saved). It runs on a timer (see SETUP.md), proves itself with a shared
// secret, asks the database which files are unused, and deletes them through the Storage API.
// It never logs file names.
import type { Env } from '../config.ts';
import { checkSecret } from '../secret.ts';
import { json, type Rpc } from '../http.ts';

export interface CleanupDeps {
  env: Env;
  rpc: Rpc;
  /** Deletes the named files from one bucket. Resolves true when they are gone. */
  removeMany(bucket: string, names: string[]): Promise<boolean>;
}

const BATCH = 100;
const BUCKETS = new Set(['incoming', 'pets', 'homes', 'faces']);

export async function handleCleanupPhotos(req: Request, deps: CleanupDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const who = await checkSecret(deps.env, 'CLEANUP_SECRET', req, 'x-cleanup-secret');
  if (who === 'not_configured') return json(503, { error: 'not_configured' });         // no secret set up, nobody gets in
  if (who === 'unauthorized') return json(401, { error: 'unauthorized' });

  const listed = await deps.rpc('list_unused_uploads', { p_older_than: '1 day' });
  if (listed.error) return json(502, { error: 'try_again_later' });
  const rows = Array.isArray(listed.data) ? (listed.data as { bucket_id?: unknown; name?: unknown }[]) : [];
  const byBucket = new Map<string, string[]>();
  for (const r of rows) {
    if (typeof r.bucket_id !== 'string' || typeof r.name !== 'string' || !BUCKETS.has(r.bucket_id)) continue;   // only the known buckets
    byBucket.set(r.bucket_id, [...(byBucket.get(r.bucket_id) ?? []), r.name]);
  }
  let removed = 0;
  let failed = 0;
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH);
      if (await deps.removeMany(bucket, batch)) removed += batch.length; else failed += batch.length;
    }
  }
  return json(200, { removed, failed });
}
