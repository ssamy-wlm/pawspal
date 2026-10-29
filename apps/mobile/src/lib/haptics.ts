// The small buzz on a swipe. Some people do not want it, so Settings can turn it off; the choice is remembered on the phone.
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';

const KEY = 'pawspal.haptics';
let enabled = true;
const listeners = new Set<() => void>();

/** Call once at start-up. Haptics are on until the person turns them off. */
export async function initHaptics(): Promise<void> {
  try { enabled = (await SecureStore.getItemAsync(KEY)) !== 'off'; } catch { enabled = true; }
  listeners.forEach((l) => l());
}

export const hapticsEnabled = () => enabled;

export async function setHapticsEnabled(on: boolean): Promise<void> {
  enabled = on;
  listeners.forEach((l) => l());
  try { await SecureStore.setItemAsync(KEY, on ? 'on' : 'off'); } catch { /* the choice still applies until the app closes */ }
}

/** A light tap, unless haptics are off. Safe to call from anywhere; never throws. */
export function tap(): void {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** For screens that show the setting. */
export function onHapticsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
