// The web build has no push notifications yet. Settings shows "available in the phone app" instead of the switches.
// Metro picks this file on the web, so expo-notifications is not part of the web bundle.
export type EnableResult = 'on' | 'denied' | 'unavailable' | 'error';
export { DEFAULT_PREFS, KINDS, loadPrefs, notificationRoute, savePrefs } from './notificationPrefs';
export type { NotificationKind, NotificationPrefs } from './notificationPrefs';

export const notificationsAvailable = (): boolean => false;
export const enableNotifications = async (): Promise<EnableResult> => 'unavailable';
export const refreshPushToken = async (): Promise<void> => {};
export const disableNotifications = async (): Promise<void> => {};
export const notificationsOn = async (): Promise<boolean> => false;
export const installForegroundHandler = (): void => {};
