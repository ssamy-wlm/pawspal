// Push notifications (phone only). Nothing here runs until the person turns notifications on in Settings: the permission
// question is never asked at first launch. The server sends generic text and an opaque id; a tap opens the right screen.
// On the web there is no push yet: `notificationsAvailable()` is false and Settings shows "available in the phone app".
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { getItem, removeItem, setItem } from './storage';
import { isExpoPushToken } from './notificationPrefs';

export type EnableResult = 'on' | 'denied' | 'unavailable' | 'error';
export { DEFAULT_PREFS, KINDS, loadPrefs, notificationRoute, savePrefs } from './notificationPrefs';
export type { NotificationKind, NotificationPrefs } from './notificationPrefs';

const TOKEN_KEY = 'pawspal.pushToken';
const CHANNEL = 'default';

export const notificationsAvailable = (): boolean => Platform.OS === 'ios' || Platform.OS === 'android';

/** The OS permission, asked only here (and only when the person has just switched notifications on). */
async function ensurePermission(ask: boolean): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!ask || !current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

async function registerToken(ask: boolean): Promise<EnableResult> {
  if (!notificationsAvailable()) return 'unavailable';
  try {
    if (!(await ensurePermission(ask))) return 'denied';
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'PawsPal', importance: Notifications.AndroidImportance.DEFAULT, sound: null });
    }
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    if (!isExpoPushToken(token)) return 'error';
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    if (error) return 'error';
    await setItem(TOKEN_KEY, token).catch(() => {});
    return 'on';
  } catch {
    return 'error';
  }
}

/** The person switched notifications on: ask the OS (if needed), get the token and register it. */
export const enableNotifications = (): Promise<EnableResult> => registerToken(true);

/** On start-up: if notifications were turned on before, quietly refresh the token (they can change). Never asks. */
export async function refreshPushToken(): Promise<void> {
  try {
    if (!notificationsAvailable() || (await getItem(TOKEN_KEY)) === null) return;
    await registerToken(false);
  } catch { /* nothing to do */ }
}

/** Switched off, or signing out: tell the server to stop sending to this phone. Never throws. */
export async function disableNotifications(): Promise<void> {
  try {
    const token = await getItem(TOKEN_KEY);
    if (!token) return;
    await supabase.rpc('unregister_push_token', { p_token: token });
    await removeItem(TOKEN_KEY);
  } catch { /* the server also drops tokens that stop working */ }
}

/** Whether this phone has a registered token (the "on" state of the master setting). */
export async function notificationsOn(): Promise<boolean> {
  try { return (await getItem(TOKEN_KEY)) !== null; } catch { return false; }
}

/** While the app is open a notification is shown by our own small banner (Toast), without sound, not by the system. */
export function installForegroundHandler(): void {
  if (!notificationsAvailable()) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
  });
}
