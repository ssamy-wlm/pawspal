// "Something is wrong with the pet." Either person in a running booking can raise it. The database alerts the other
// person and opens a high-priority report for the team. The note is stored for the team and never logged here.
import { bearerToken, json, readJson, type Rpc } from '../http.ts';

export interface EmergencyDeps {
  authUser(token: string): Promise<{ id: string } | null>;
  rpc: Rpc;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleEmergency(req: Request, deps: EmergencyDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = bearerToken(req);
  const user = token ? await deps.authUser(token) : null;
  if (!user) return json(401, { error: 'unauthorized' });
  const body = await readJson(req, 2 * 1024);
  if (!body || typeof body.booking_id !== 'string' || !UUID.test(body.booking_id)) return json(400, { error: 'invalid_request' });
  const note = body.note === undefined || body.note === null ? null : body.note;
  if (note !== null && (typeof note !== 'string' || note.length > 500)) return json(400, { error: 'invalid_request' });

  const r = await deps.rpc('raise_emergency', { p_user: user.id, p_booking: body.booking_id, p_note: note });
  if (r.error) return json(502, { error: 'try_again_later' });
  switch (r.data) {
    case 'sent': return json(200, { ok: true, status: 'sent' });
    case 'already_sent': return json(200, { ok: true, status: 'already_sent' });
    case 'too_many': return json(429, { error: 'too_many_attempts' });
    case 'invalid': return json(400, { error: 'invalid_request' });
    case 'not_allowed': return json(403, { error: 'not_allowed' });
    default: return json(502, { error: 'try_again_later' });
  }
}
