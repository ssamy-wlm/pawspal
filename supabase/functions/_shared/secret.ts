// Functions that a timer or another service calls (not a person) prove themselves with a shared secret in a header.
import type { Env } from './config.ts';
import { sha256Hex, timingSafeEqual } from './crypto.ts';

export type SecretCheck = 'ok' | 'not_configured' | 'unauthorized';

/** No secret set up (or one that is too short) means nobody gets in. Both are hashed first, so the comparison takes the same time whatever the guess. */
export async function checkSecret(env: Env, name: string, req: Request, header: string): Promise<SecretCheck> {
  const secret = env.get(name);
  if (!secret || secret.length < 24) return 'not_configured';
  const given = req.headers.get(header) ?? '';
  const enc = new TextEncoder();
  const ok = timingSafeEqual(enc.encode(await sha256Hex(given)), enc.encode(await sha256Hex(secret)));
  return ok ? 'ok' : 'unauthorized';
}
