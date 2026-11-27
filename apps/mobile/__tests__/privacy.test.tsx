import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { COMBOS, renderIn } from '../test-utils/render';
import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';
import { setLocaleForTests } from '../src/i18n';
import { ApiError } from '../src/lib/api';
import * as api from '../src/lib/api';
import * as priv from '../src/lib/privacy';
import { ToastProvider } from '../src/components/Toast';
import Settings from '../app/settings';
import DownloadData from '../app/settings/download-data';
import DeleteAccount, { sameWord } from '../app/settings/delete-account';
import Goodbye from '../app/goodbye';
import NotificationSettings from '../app/settings/notifications';
import * as notif from '../src/lib/notifications';

jest.mock('../src/lib/auth', () => ({ useAuth: () => ({ ready: true, session: { user: { id: 'me' } }, state: { status: 'active' }, refresh: jest.fn(), signOut: jest.fn(async () => {}) }) }));
jest.mock('../src/lib/api', () => ({ ...jest.requireActual('../src/lib/api'), exportMyData: jest.fn(), deleteAccount: jest.fn() }));
jest.mock('../src/lib/privacy', () => ({ ...jest.requireActual('../src/lib/privacy'), clearLocalData: jest.fn(async () => {}) }));
jest.mock('../src/lib/notifications', () => ({
  __esModule: true, ...jest.requireActual('../src/lib/notificationPrefs'),
  notificationsAvailable: jest.fn(() => true), notificationsOn: jest.fn(async () => false),
  enableNotifications: jest.fn(async () => 'on'), disableNotifications: jest.fn(async () => {}),
}));

const a = api as jest.Mocked<typeof api>;
const n = notif as jest.Mocked<typeof notif>;
const words = (l: 'en' | 'ar') => (l === 'ar' ? ar : en);
const wrap = (ui: React.ReactElement) => <ToastProvider>{ui}</ToastProvider>;
afterEach(() => setLocaleForTests('en'));
beforeEach(() => { jest.clearAllMocks(); });

describe.each(COMBOS)('privacy in $mode / $locale', ({ mode, locale }) => {
  const w = words(locale);

  it('Settings has Privacy with Download and Delete, and the Notifications entry on a phone', async () => {
    await renderIn(wrap(<Settings />), { mode, locale });
    expect(screen.getByText(w['settings.privacy'])).toBeTruthy();
    expect(screen.getByText(w['privacy.download'])).toBeTruthy();
    expect(screen.getByText(w['settings.notifications'])).toBeTruthy();
    await fireEvent.press(screen.getByText(w['privacy.delete']));
    expect(router.push).toHaveBeenCalledWith('/settings/delete-account');
  });

  it('delete button stays off until the password and the typed word are both filled', async () => {
    await renderIn(wrap(<DeleteAccount />), { mode, locale });
    const button = () => screen.getByRole('button', { name: w['delete.button'] });
    expect(button().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText(w['delete.password']), 'correct horse');
    expect(button().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText(w['delete.confirm'].replace('{word}', w['delete.word'])), w['delete.word']);
    expect(button().props.accessibilityState.disabled).toBe(false);
  });

  it('goodbye screen says goodbye and returns to the start', async () => {
    await renderIn(<Goodbye />, { mode, locale });
    expect(screen.getByRole('header', { name: w['goodbye.title'] })).toBeTruthy();
    await fireEvent.press(screen.getByText(w['goodbye.button']));
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(JSON.stringify(w['goodbye.body'])).not.toContain('!');
  });
});

describe('download my data', () => {
  const result = { ok: true as const, exported_at: '2026-11-27T10:00:00Z', data: { profile: { first_name: 'Mona' } }, files: [{ kind: 'pet', name: 'p.jpg', url: 'https://x.supabase.co/signed/p.jpg' }] };
  const fill = async () => {
    await renderIn(wrap(<DownloadData />));
    await fireEvent.changeText(screen.getByLabelText(en['delete.password']), 'pw');
    await fireEvent.press(screen.getByRole('button', { name: en['privacy.download'] }));
  };

  it('Settings opens the password screen instead of downloading at once', async () => {
    await renderIn(wrap(<Settings />));
    await fireEvent.press(screen.getByText(en['privacy.download']));
    expect(router.push).toHaveBeenCalledWith('/settings/download-data');
    expect(a.exportMyData).not.toHaveBeenCalled();
  });

  it('keeps the button off until the password is filled', async () => {
    await renderIn(wrap(<DownloadData />));
    expect(screen.getByRole('button', { name: en['privacy.download'] }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText(en['delete.password']), 'pw');
    expect(screen.getByRole('button', { name: en['privacy.download'] }).props.accessibilityState.disabled).toBe(false);
  });

  it('sends the password, exports the data and photo links as one JSON file, opens the share sheet', async () => {
    a.exportMyData.mockResolvedValue(result);
    await fill();
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
    expect(a.exportMyData).toHaveBeenCalledWith('pw');
    expect(screen.getByLabelText(en['delete.password']).props.value).toBe('');   // the password is cleared
  });

  it.each([['wrong_password', 'delete.err.wrong_password'], ['too_many_attempts', 'delete.err.too_many_attempts'], ['network', 'err.network'], ['try_again_later', 'err.try_again_later']] as const)('shows %s calmly and clears the password', async (code, key) => {
    a.exportMyData.mockRejectedValueOnce(new ApiError(code, 400));
    await fill();
    expect(await screen.findByText(en[key])).toBeTruthy();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(screen.getByLabelText(en['delete.password']).props.value).toBe('');
  });
});

describe('privacy helpers', () => {
  it('names the file by the export date and puts data and links together', () => {
    expect(priv.exportFileName('2026-11-27T10:00:00Z')).toBe('pawspal-my-data-2026-11-27.json');
    expect(priv.exportFileName('nonsense', new Date('2026-01-02T00:00:00Z'))).toBe('pawspal-my-data-2026-01-02.json');
    const json = JSON.parse(priv.exportJson({ ok: true, exported_at: 'e', data: { a: 1 }, files: [{ kind: 'k', name: 'n', url: 'u' }] }));
    expect(json).toEqual({ exported_at: 'e', data: { a: 1 }, files: [{ kind: 'k', name: 'n', url: 'u' }] });
  });
  it('compares the typed word without case or stray spaces, in both languages', () => {
    expect(sameWord(' delete ', 'DELETE')).toBe(true);
    expect(sameWord('حذف', 'حذف')).toBe(true);
    expect(sameWord('delet', 'DELETE')).toBe(false);
  });
});

describe('delete my account', () => {
  const fill = async (locale: 'en' | 'ar' = 'en') => {
    await renderIn(wrap(<DeleteAccount />), { locale });
    const w = words(locale);
    await fireEvent.changeText(screen.getByLabelText(w['delete.password']), 'pw');
    await fireEvent.changeText(screen.getByLabelText(w['delete.confirm'].replace('{word}', w['delete.word'])), w['delete.word']);
    await fireEvent.press(screen.getByRole('button', { name: w['delete.button'] }));
  };

  it('on success signs out, clears this phone and shows the goodbye screen', async () => {
    a.deleteAccount.mockResolvedValue(undefined);
    await fill();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/goodbye'));
    expect(a.deleteAccount).toHaveBeenCalledWith('pw');
    expect(priv.clearLocalData).toHaveBeenCalled();
  });

  it('says what is wrong, keeps the account and stays on the screen', async () => {
    a.deleteAccount.mockRejectedValue(new ApiError('wrong_password', 400));
    await fill();
    expect(await screen.findByText(en['delete.err.wrong_password'])).toBeTruthy();
    expect(priv.clearLocalData).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('with an unfinished booking, explains and links to the bookings', async () => {
    a.deleteAccount.mockRejectedValue(new ApiError('active_booking', 409));
    await fill();
    expect(await screen.findByText(en['delete.err.active_booking'])).toBeTruthy();
    await fireEvent.press(screen.getByText(en['delete.viewBookings']));
    expect(router.push).toHaveBeenCalledWith('/(tabs)/calendar');
  });

  it.each([['too_many_attempts', 'delete.err.too_many_attempts'], ['open_case', 'delete.err.open_case'], ['admin_account', 'delete.err.admin_account'], ['not_allowed', 'err.notAllowed'], ['try_again_later', 'err.try_again_later'], ['network', 'err.network']] as const)('maps %s', async (code, key) => {
    a.deleteAccount.mockRejectedValue(new ApiError(code, 400));
    await fill();
    expect(await screen.findByText(en[key])).toBeTruthy();
  });

  it('works in Arabic', async () => {
    a.deleteAccount.mockResolvedValue(undefined);
    await fill('ar');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/goodbye'));
  });
});

describe('notification settings', () => {
  const rpcPrefs = { messages: true, bookings: true, membership: false, verification: true };
  beforeEach(() => {
    jest.spyOn(notif, 'loadPrefs').mockResolvedValue(rpcPrefs);
    jest.spyOn(notif, 'savePrefs').mockResolvedValue(undefined);
  });

  it('the four switches stay off-limits until notifications are switched on, then save each change', async () => {
    await renderIn(wrap(<NotificationSettings />));
    const master = screen.getByRole('switch', { name: en['notif.master'] });
    await waitFor(() => expect(notif.loadPrefs).toHaveBeenCalled());
    expect(screen.getByRole('switch', { name: en['notif.messages'] }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(master);
    expect(n.enableNotifications).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('switch', { name: en['notif.messages'] }).props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByRole('switch', { name: en['notif.membership'] }));
    expect(notif.savePrefs).toHaveBeenCalledWith({ ...rpcPrefs, membership: true });
  });

  it('explains when the phone refused permission', async () => {
    n.enableNotifications.mockResolvedValueOnce('denied');
    await renderIn(wrap(<NotificationSettings />));
    await fireEvent.press(screen.getByRole('switch', { name: en['notif.master'] }));
    expect(await screen.findByText(en['notif.denied'])).toBeTruthy();
  });

  it('shows "available in the phone app" where there is no push', async () => {
    n.notificationsAvailable.mockReturnValue(false);
    await renderIn(wrap(<NotificationSettings />));
    expect(screen.getByText(en['notif.web'])).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    n.notificationsAvailable.mockReturnValue(true);
  });
});
