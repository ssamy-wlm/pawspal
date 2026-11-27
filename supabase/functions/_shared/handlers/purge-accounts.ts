// Nightly: finishes the deletion of accounts whose grace period ended, and applies the retention of shared history. The database
// does the work (purge_deleted_accounts) and names the leftover photo files; this deletes them. Same secret as cleanup-photos.
// Returns only counts. Never logs anything.
import type { Env } from '../config.ts';
import { checkSecret } from '../secret.ts';
import { json, type Rpc } from '../http.ts';

export interface PurgeDeps {
  env: Env;
  rpc: Rpc;
  removeMany(bucket: string, names: string[]): Promise<boolean>;
}

const BATCH = 100;
const BUCKETS = new Set(['faces', 'pets', 'homes', 'handovers', 'ids', 'payments', 'incoming']);

export async function handlePurgeAccounts(req: Request, deps: PurgeDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const who = await checkSecret(deps.env, 'CLEANUP_SECRET', req, 'x-cleanup-secret');
  if (who === 'not_configured') return json(503, { error: 'not_configured' });
  if (who === 'unauthorized') return json(401, { error: 'unauthorized' });

  const r = await deps.rpc('purge_deleted_accounts', {});
  if (r.error || !r.data || typeof r.data !== 'object') return json(502, { error: 'try_again_later' });
  const d = r.data as Record<string, unknown>;
  const byBucket = new Map<string, string[]>();
  for (const f of Array.isArray(d.files) ? (d.files as { bucket?: unknown; name?: unknown }[]) : []) {
    if (typeof f.bucket !== 'string' || typeof f.name !== 'string' || !BUCKETS.has(f.bucket)) continue;
    byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.name]);
  }
  let removed = 0;
  let failed = 0;
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH);
      if (await deps.removeMany(bucket, batch).catch(() => false)) removed += batch.length; else failed += batch.length;
    }
  }
  const n = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
  return json(200, {
    purged: n('purged'), files_removed: removed, files_failed: failed, messages_deleted: n('messages_deleted'),
    conversations_deleted: n('conversations_deleted'), bookings_deleted: n('bookings_deleted'), stubs_deleted: n('stubs_deleted'),
  });
}
