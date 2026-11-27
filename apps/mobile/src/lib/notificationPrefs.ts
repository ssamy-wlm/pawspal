// The parts of notifications that are the same on every platform: the four switches, where a tap leads, the token format.
import { supabase } from './supabase';

export type NotificationKind = 'messages' | 'bookings' | 'membership' | 'verification';
export type NotificationPrefs = Record<NotificationKind, boolean>;
export const KINDS: NotificationKind[] = ['messages', 'bookings', 'membership', 'verification'];
export const DEFAULT_PREFS: NotificationPrefs = { messages: true, bookings: true, membership: true, verification: true };

/** Where a notification's tap leads. `type` and `id` come from the server; the id is checked before it goes in an address. */
export function notificationRoute(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { type, id } = data as { type?: unknown; id?: unknown };
  const safeId = typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
  switch (type) {
    case 'message': return safeId ? `/chat/${safeId}` : '/(tabs)/chat';
    case 'booking': return safeId ? `/booking/${safeId}` : '/(tabs)/calendar';
    case 'membership': return '/membership';
    case 'account': return '/pending';        // the gate sends an active person on to Explore
    default: return null;
  }
}

/** A push token has the form ExponentPushToken[...]. */
export const isExpoPushToken = (v: unknown): v is string => typeof v === 'string' && /^ExponentPushToken\[[^\]\s]+\]$/.test(v);

/** The four switches as the server stores them. Missing or odd values fall back to "on". */
export async function loadPrefs(): Promise<NotificationPrefs> {
  const { data, error } = await supabase.rpc('my_notification_prefs');
  if (error) throw error;
  const d = (data ?? {}) as Partial<Record<NotificationKind, unknown>>;
  return Object.fromEntries(KINDS.map((k) => [k, typeof d[k] === 'boolean' ? d[k] : true])) as NotificationPrefs;
}

export async function savePrefs(prefs: NotificationPrefs): Promise<void> {
  const { error } = await supabase.rpc('set_notification_prefs', { p_prefs: prefs });
  if (error) throw error;
}
