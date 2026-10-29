// Small helpers shared by every function.
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Reads a small JSON body. Returns null when it is missing, too big or not an object. */
export async function readJson(req: Request, maxBytes = 16 * 1024): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length === 0 || text.length > maxBytes) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() || null : null;
}

export interface OtpDecision {
  allowed: boolean;
  reason: string | null;
  retry_after_seconds: number;
  captcha_required: boolean;
}

export function asDecision(data: unknown): OtpDecision | null {
  const d = data as Partial<OtpDecision> | null;
  if (!d || typeof d.allowed !== 'boolean') return null;
  return { allowed: d.allowed, reason: d.reason ?? null, retry_after_seconds: Number(d.retry_after_seconds ?? 0), captcha_required: !!d.captcha_required };
}
