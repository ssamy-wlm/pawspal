// Removes anything personal from a crash report before it leaves the phone (docs/security.md: never log message text, codes,
// ID data or exact locations). Used by the crash reporter (monitoring.ts) and tested on its own. It errs on the side of removing.

const MARK = '[removed]';

// Order matters: tokens and emails first, so a long token is not half eaten by the phone-number rule.
const PATTERNS: RegExp[] = [
  /\bExponentPushToken\[[^\]]+\]/g,                                 // push tokens
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,                          // JSON web tokens (sign-in sessions)
  /\bBearer\s+[\w.~+/=-]{8,}/gi,                                    // authorization headers
  /\b(?:sb_(?:secret|publishable)_|sk_(?:live|test)_)[\w-]{8,}/g,   // provider keys
  /[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[A-Za-z]{2,}/g,            // email addresses
  /\b[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\b/g, // ids (user, booking, chat)
  /(?<![\w.])[-+]?\d{1,3}\.\d{4,}\s*,\s*[-+]?\d{1,3}\.\d{4,}/g,     // a latitude, longitude pair
  /\+?\(?\d[\d\s().-]{7,}\d/g,                                       // phone numbers and long digit runs (codes, ID numbers)
  /\b[A-Za-z0-9_-]{32,}\b/g,                                        // any other long opaque string
];

/** Keys whose value is dropped whatever it holds. */
const SECRET_KEY = /pass(word)?|token|secret|authorization|cookie|email|phone|otp|code|body|message|text|note|address|lat|lng|lon|location|id_?number|iban|account|apikey|api_key|details|hint|detail/i;

/** A string with emails, tokens, ids, phone numbers, coordinates and long opaque strings replaced. */
export function scrubString(value: string): string {
  let out = value;
  for (const p of PATTERNS) out = out.replace(p, MARK);
  return out;
}

/** Any value, cleaned: strings are scrubbed, objects and lists are walked, keys that name private things lose their value. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return MARK;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? MARK : scrubValue(v, depth + 1);
  }
  return out;
}

interface EventLike {
  user?: unknown; request?: unknown; breadcrumbs?: unknown; server_name?: unknown; message?: unknown; logentry?: unknown;
  exception?: { values?: { value?: unknown; type?: unknown; stacktrace?: unknown; mechanism?: unknown }[] };
  transaction?: unknown; threads?: unknown; fingerprint?: unknown; dist?: unknown;
  tags?: unknown; extra?: unknown; contexts?: unknown;
}

/** Errors that come from our API, Supabase or Postgres can carry free text (names, bios, "Failing row contains (...)"). */
const API_ERROR_TYPE = /^(ApiError|PostgrestError|AuthApiError|AuthError|AuthRetryableFetchError|AuthUnknownError|AuthSessionMissingError|AuthWeakPasswordError|StorageError|StorageApiError|StorageUnknownError|Functions\w*Error|DatabaseError)$|postgres|supabase/i;
const API_ERROR_TEXT = /Failing row contains|violates .*constraint|duplicate key value|invalid input syntax|PostgrestError|null value in column/i;
/** A bare error code such as "wrong_password" or "23505" is safe to keep. */
const BARE_CODE = /^[A-Za-z0-9_.-]{1,40}$/;

/** For API, Supabase and Postgres errors only the class and a bare code are kept; any message text is dropped. */
export function scrubExceptionText(type: unknown, value: string): string {
  const fromApi = (typeof type === 'string' && API_ERROR_TYPE.test(type)) || API_ERROR_TEXT.test(value);
  if (!fromApi) return scrubString(value);
  return BARE_CODE.test(value.trim()) ? scrubString(value.trim()) : MARK;
}

/**
 * The last step before a crash report is sent: no user, no request, no breadcrumbs, no server name; messages, exception texts,
 * tags, extras and contexts are cleaned. Stack traces (file names and line numbers) stay: they hold no personal data.
 */
export function scrubEvent<T extends EventLike>(event: T): T {
  const e = { ...event } as EventLike;
  delete e.user; delete e.request; delete e.breadcrumbs; delete e.server_name;
  if (typeof e.transaction === 'string') e.transaction = scrubString(e.transaction);   // route names can hold ids
  if (e.threads) e.threads = scrubValue(e.threads);
  if (Array.isArray(e.fingerprint)) e.fingerprint = e.fingerprint.map((f) => (typeof f === 'string' ? scrubString(f) : f));
  if (typeof e.dist === 'string') e.dist = scrubString(e.dist);
  if (typeof e.message === 'string') e.message = scrubString(e.message);
  if (e.logentry) e.logentry = scrubValue(e.logentry);
  if (e.exception?.values) {
    e.exception = { ...e.exception, values: e.exception.values.map((v) => ({ ...v, ...(typeof v.value === 'string' ? { value: scrubExceptionText(v.type, v.value) } : {}), ...(v.mechanism ? { mechanism: scrubValue(v.mechanism) } : {}) })) };
  }
  if (e.tags) e.tags = scrubValue(e.tags);
  if (e.extra) e.extra = scrubValue(e.extra);
  if (e.contexts) e.contexts = scrubValue(e.contexts);
  return e as T;
}

interface BreadcrumbLike { category?: string; type?: string; message?: string; data?: unknown }

/** Breadcrumbs of what was tapped, typed, logged or fetched are dropped; navigation and the rest are kept but cleaned. */
export function scrubBreadcrumb<T extends BreadcrumbLike>(crumb: T): T | null {
  const category = crumb.category ?? '';
  if (/^(ui\.|console|xhr|fetch|http|touch|user|navigation|sentry\.)/.test(category) || crumb.type === 'user' || crumb.type === 'http') return null;
  const out = { ...crumb } as BreadcrumbLike;
  if (typeof out.message === 'string') out.message = scrubString(out.message);
  if (out.data) out.data = scrubValue(out.data);
  return out as T;
}
