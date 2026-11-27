// What the Privacy part of Settings needs besides the server calls: the export as text, and clearing this device.
import { supabase } from './supabase';
import { removeItem } from './storage';
import type { ExportedData } from './api';

/** The keys the app keeps in storage.ts (the sign-in session itself is removed by signing out). */
export const LOCAL_KEYS = ['pawspal.device', 'pawspal.haptics', 'pawspal.locale', 'pawspal.theme', 'pawspal.pushToken'];

/** The export as readable JSON: the data and the photo links together. */
export function exportJson(r: ExportedData): string {
  return JSON.stringify({ exported_at: r.exported_at, data: r.data, files: r.files }, null, 2);
}

/** A file name such as pawspal-my-data-2026-11-27.json (the date comes from the server answer; today's date if it is odd). */
export function exportFileName(exportedAt: string | undefined, now: Date = new Date()): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(exportedAt ?? '')?.[0] ?? now.toISOString().slice(0, 10);
  return `pawspal-my-data-${day}.json`;
}

/**
 * After the account is closed: end the session on this device (the server session is already dead, so only this device is
 * touched) and forget everything the app saved here. Language and theme go too: this is a clean slate.
 */
export async function clearLocalData(): Promise<void> {
  try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* the session is already invalid */ }
  await Promise.all(LOCAL_KEYS.map((k) => removeItem(k).catch(() => {})));
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const mine = Object.keys(window.localStorage).filter((k) => k.startsWith('pawspal.') || k.startsWith('sb-'));
      mine.forEach((k) => window.localStorage.removeItem(k));
    } catch { /* storage may be blocked */ }
  }
}
