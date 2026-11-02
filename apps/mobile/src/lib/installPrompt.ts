// The logic behind "Install PawsPal" on the web: what kind of browser this is, whether the app is already installed,
// the browser's own install offer (Chrome, Edge, Android), and whether the person said "not now". No React in here.
import { getItem, setItem } from './storage';

export type InstallMode = 'hidden' | 'prompt' | 'ios';

const DISMISS_KEY = 'pawspal.install.dismissed';

/** iPhone and iPad. Newer iPads report themselves as a Mac, so a touch screen gives them away. */
export function isIos(ua: string, maxTouchPoints = 0, platform = ''): boolean {
  return /iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform || ua) && maxTouchPoints > 1);
}

/** Safari itself, not Chrome, Firefox, Edge, Opera or an app's own browser on iOS. */
export function isIosSafari(ua: string, maxTouchPoints = 0, platform = ''): boolean {
  return isIos(ua, maxTouchPoints, platform) && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|Instagram|FBAN|FBAV|Line\//i.test(ua);
}

/** Already opened from the home screen (the page runs without browser bars). */
export function isStandalone(win: Pick<Window, 'matchMedia'> & { navigator: { standalone?: boolean } }): boolean {
  try {
    if (win.navigator.standalone === true) return true;
    return !!win.matchMedia?.('(display-mode: standalone)').matches || !!win.matchMedia?.('(display-mode: fullscreen)').matches;
  } catch { return false; }
}

/** Which kind of help to show. `deferred` is true once the browser has offered its own install dialog. */
export function installMode(opts: { standalone: boolean; deferred: boolean; ios: boolean }): InstallMode {
  if (opts.standalone) return 'hidden';
  if (opts.deferred) return 'prompt';
  return opts.ios ? 'ios' : 'hidden';
}

export async function wasDismissed(): Promise<boolean> {
  try { return (await getItem(DISMISS_KEY)) === '1'; } catch { return false; }
}
export async function rememberDismissed(): Promise<void> {
  try { await setItem(DISMISS_KEY, '1'); } catch { /* it will show again next visit */ }
}

/** The browser's install offer, as far as we use it. */
export interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

/** Start listening as early as possible: the browser makes its offer once, soon after the page loads. Safe to call twice. */
let capturing = false;
export function captureInstallPrompt(target: Pick<Window, 'addEventListener'> | null = typeof window !== 'undefined' ? window : null): void {
  if (!target || capturing) return;
  capturing = true;
  target.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; tell(); });
  target.addEventListener('appinstalled', () => { deferred = null; tell(); });
}

export const hasDeferredPrompt = (): boolean => deferred !== null;
export function onInstallChange(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Shows the browser's own install dialog. Gives back what the person chose. */
export async function runInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const ev = deferred;
  if (!ev) return 'unavailable';
  deferred = null; // the offer can be used only once
  tell();
  try { await ev.prompt(); return (await ev.userChoice).outcome; } catch { return 'unavailable'; }
}

/** Test helper. */
export function resetInstallPromptForTests(): void { deferred = null; capturing = false; listeners.clear(); }
