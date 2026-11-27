// The Expo push service (https://exp.host/--/api/v2/push/send). The only file that knows its address and format.
// Nothing here logs a token, a title or a body.
export interface PushMessage { to: string; title: string; body: string; data: Record<string, unknown>; sound?: 'default' }
/** One result per message, in the same order. error is the service's code, for example DeviceNotRegistered. */
export interface PushResult { ok: boolean; error?: string }
export interface PushSender { send(messages: PushMessage[]): Promise<PushResult[]> }

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export function expoSender(fetchFn: typeof fetch = fetch, accessToken?: string): PushSender {
  return {
    async send(messages) {
      if (messages.length === 0) return [];
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const res = await fetchFn(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
      if (!res.ok) throw new Error(`push service answered ${res.status}`);
      const parsed = (await res.json()) as { data?: unknown };
      if (!Array.isArray(parsed.data) || parsed.data.length !== messages.length) throw new Error('unexpected push answer');
      return (parsed.data as { status?: unknown; details?: { error?: unknown } }[]).map((t) =>
        t && t.status === 'ok' ? { ok: true } : { ok: false, error: typeof t?.details?.error === 'string' ? t.details.error : 'error' });
    },
  };
}
