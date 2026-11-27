import * as Notifications from 'expo-notifications';
import { supabase } from '../src/lib/supabase';
import { disableNotifications, enableNotifications, notificationsOn, refreshPushToken } from '../src/lib/notifications';
import { isExpoPushToken, loadPrefs, notificationRoute, savePrefs } from '../src/lib/notificationPrefs';

const N = Notifications as jest.Mocked<typeof Notifications>;
const rpc = jest.spyOn(supabase, 'rpc');
beforeEach(async () => {
  rpc.mockResolvedValue({ data: null, error: null } as never);
  await disableNotifications();   // forget any token a previous test stored
  jest.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null } as never);
  N.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true } as never);
});

describe('notificationRoute', () => {
  it('opens the right screen for each type', () => {
    expect(notificationRoute({ type: 'message', id: 'abc-123' })).toBe('/chat/abc-123');
    expect(notificationRoute({ type: 'booking', id: 'abc-123' })).toBe('/booking/abc-123');
    expect(notificationRoute({ type: 'membership', id: 'x' })).toBe('/membership');
    expect(notificationRoute({ type: 'account' })).toBe('/pending');
  });
  it('falls back to the list when the id is missing and ignores odd ids and unknown types', () => {
    expect(notificationRoute({ type: 'message' })).toBe('/(tabs)/chat');
    expect(notificationRoute({ type: 'booking', id: '../../settings' })).toBe('/(tabs)/calendar');
    expect(notificationRoute({ type: 'other', id: '1' })).toBeNull();
    expect(notificationRoute(null)).toBeNull();
    expect(notificationRoute('x')).toBeNull();
  });
});

describe('isExpoPushToken', () => {
  it('accepts only the Expo form', () => {
    expect(isExpoPushToken('ExponentPushToken[abc_123-X]')).toBe(true);
    expect(isExpoPushToken('abc')).toBe(false);
    expect(isExpoPushToken('ExponentPushToken[]')).toBe(false);
  });
});

describe('turning notifications on and off', () => {
  it('does nothing at all until asked (no permission question, no token)', async () => {
    await refreshPushToken();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(await notificationsOn()).toBe(false);
  });

  it('asks the phone, gets the token and registers it', async () => {
    expect(await enableNotifications()).toBe('on');
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('register_push_token', { p_token: 'ExponentPushToken[abc123]', p_platform: expect.stringMatching(/^(ios|android)$/) });
    expect(await notificationsOn()).toBe(true);
  });

  it('stops quietly when the person says no, and registers nothing', async () => {
    N.requestPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
    expect(await enableNotifications()).toBe('denied');
    expect(rpc).not.toHaveBeenCalled();
    N.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false } as never);
    expect(await enableNotifications()).toBe('denied');
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('reports an error when the server refuses the token', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'no' } } as never);
    expect(await enableNotifications()).toBe('error');
    expect(await notificationsOn()).toBe(false);
  });

  it('refreshes the token on later starts without asking again, and unregisters when switched off', async () => {
    await enableNotifications();
    N.requestPermissionsAsync.mockClear();
    N.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never);
    await refreshPushToken();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith('register_push_token', expect.anything());
    await disableNotifications();
    expect(rpc).toHaveBeenLastCalledWith('unregister_push_token', { p_token: 'ExponentPushToken[abc123]' });
    expect(await notificationsOn()).toBe(false);
  });

  it('never throws when signing out offline', async () => {
    await enableNotifications();
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(disableNotifications()).resolves.toBeUndefined();
  });
});

describe('the four switches', () => {
  it('reads them from the server, defaulting odd values to on, and saves them as one object', async () => {
    rpc.mockResolvedValueOnce({ data: { messages: false, bookings: 'x' }, error: null } as never);
    expect(await loadPrefs()).toEqual({ messages: false, bookings: true, membership: true, verification: true });
    expect(rpc).toHaveBeenLastCalledWith('my_notification_prefs');
    await savePrefs({ messages: true, bookings: false, membership: true, verification: true });
    expect(rpc).toHaveBeenLastCalledWith('set_notification_prefs', { p_prefs: { messages: true, bookings: false, membership: true, verification: true } });
  });
  it('throws when the server fails, so the screen can say so', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } } as never);
    await expect(loadPrefs()).rejects.toBeTruthy();
  });
});
