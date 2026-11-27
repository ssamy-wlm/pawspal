// Sends the queued push notifications. A timer calls it every minute with a shared secret. Nothing is sent unless the founder
// turned the switch on (app_settings.push_enabled). The content is generic and comes from the database; this only delivers it.
// Never logs or returns tokens or text: the answer is counts.
import type { Env } from '../config.ts';
import { checkSecret } from '../secret.ts';
import { json, type Rpc } from '../http.ts';
import type { PushMessage, PushSender } from '../push/expo.ts';

export interface SendDeps {
  env: Env;
  rpc: Rpc;
  sender: PushSender;
}

export const MAX_ROWS = 100;          // notifications taken per run
export const MAX_PER_REQUEST = 100;   // messages per call to the push service (its own limit)
const MAX_TOKENS_PER_ROW = 5;

interface Row { id: number; title: string; body: string; data: Record<string, unknown>; tokens: string[] }

function asRows(data: unknown): Row[] {
  if (!Array.isArray(data)) return [];
  const out: Row[] = [];
  for (const r of data as Partial<Row>[]) {
    if (typeof r.id !== 'number' || typeof r.title !== 'string' || typeof r.body !== 'string' || !r.data || typeof r.data !== 'object') continue;
    const tokens = Array.isArray(r.tokens) ? r.tokens.filter((t): t is string => typeof t === 'string').slice(0, MAX_TOKENS_PER_ROW) : [];
    out.push({ id: r.id, title: r.title, body: r.body, data: r.data as Record<string, unknown>, tokens });
  }
  return out.slice(0, MAX_ROWS);
}

export async function handleSendNotifications(req: Request, deps: SendDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const who = await checkSecret(deps.env, 'NOTIFICATIONS_SECRET', req, 'x-notifications-secret');
  if (who === 'not_configured') return json(503, { error: 'not_configured' });
  if (who === 'unauthorized') return json(401, { error: 'unauthorized' });

  const enabled = await deps.rpc('push_is_enabled', {});
  if (enabled.error) return json(502, { error: 'try_again_later' });
  if (enabled.data !== true) return json(200, { enabled: false, sent: 0, failed: 0, removed_tokens: 0 });     // the switch is off: nothing is taken, nothing is sent

  const claimed = await deps.rpc('claim_notifications', { p_limit: MAX_ROWS });
  if (claimed.error) return json(502, { error: 'try_again_later' });
  const rows = asRows(claimed.data);

  // One message per device. Remember which row each message belongs to.
  const flat: { rowId: number; msg: PushMessage }[] = [];
  for (const r of rows) for (const to of r.tokens) flat.push({ rowId: r.id, msg: { to, title: r.title, body: r.body, data: r.data, sound: 'default' } });

  const okRows = new Set<number>();          // delivered to at least one device
  const retryRows = new Set<number>();       // a failure that may pass: stays in the queue, the database delays the next try
  const deadTokens = new Set<string>();
  for (let i = 0; i < flat.length; i += MAX_PER_REQUEST) {
    const chunk = flat.slice(i, i + MAX_PER_REQUEST);
    let results;
    try {
      results = await deps.sender.send(chunk.map((c) => c.msg));
    } catch {
      for (const c of chunk) retryRows.add(c.rowId);
      continue;
    }
    chunk.forEach((c, j) => {
      const res = results[j];
      if (res?.ok) okRows.add(c.rowId);
      else if (res?.error === 'DeviceNotRegistered') deadTokens.add(c.msg.to);
      else retryRows.add(c.rowId);
    });
  }

  let removed = 0;
  if (deadTokens.size > 0) {
    const r = await deps.rpc('remove_push_tokens', { p_tokens: [...deadTokens] });
    if (!r.error && typeof r.data === 'number') removed = r.data;
  }
  // Done: delivered somewhere, or nothing left to try (no devices, or every device is gone). Failures with a chance stay queued.
  const done = rows.filter((r) => okRows.has(r.id) || !retryRows.has(r.id)).map((r) => r.id);
  if (done.length > 0) await deps.rpc('finish_notifications', { p_ids: done });
  const sent = rows.filter((r) => okRows.has(r.id)).length;
  return json(200, { enabled: true, sent, failed: rows.filter((r) => retryRows.has(r.id) && !okRows.has(r.id)).length, removed_tokens: removed });
}
