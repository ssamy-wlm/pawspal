import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { InstallPrompt } from '../src/components/InstallPrompt.web';
import { InstallPrompt as NativeInstallPrompt } from '../src/components/InstallPrompt';
import { rememberDismissed, resetInstallPromptForTests, wasDismissed } from '../src/lib/installPrompt';
import { renderIn } from '../test-utils/render';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const CHROME_IPHONE = IPHONE.replace('Version/17.4 Mobile', 'CriOS/123.0 Mobile');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';

// Jest's window is the global object; the browser details are put on it for each test and taken off after.
const g = globalThis as unknown as Record<string, unknown>;
const KEYS = ['navigator', 'matchMedia', 'addEventListener'] as const;
const saved: Partial<Record<(typeof KEYS)[number], PropertyDescriptor | undefined>> = {};
function setBrowser(ua: string, opts: { standalone?: boolean; touch?: number; platform?: string } = {}) {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const values = {
    navigator: { userAgent: ua, maxTouchPoints: opts.touch ?? 5, platform: opts.platform ?? '', standalone: opts.standalone },
    matchMedia: (q: string) => ({ matches: !!opts.standalone && q.includes('standalone') }),
    addEventListener: (n: string, fn: (e: unknown) => void) => { (listeners[n] ??= []).push(fn); },
  };
  for (const k of KEYS) Object.defineProperty(g, k, { value: values[k], configurable: true, writable: true });
  return listeners;
}
beforeEach(() => { for (const k of KEYS) saved[k] = Object.getOwnPropertyDescriptor(g, k); resetInstallPromptForTests(); });
afterEach(() => { for (const k of KEYS) { if (saved[k]) Object.defineProperty(g, k, saved[k]!); else delete g[k]; } });

describe('Install PawsPal (web)', () => {
  it('shows nothing on a phone app build', async () => {
    const { toJSON } = await renderIn(<NativeInstallPrompt />);
    expect(toJSON()).toBeNull();
  });

  it('on iPhone Safari: a card, then three steps (Share, Add to Home Screen, Add) and no Safari note', async () => {
    setBrowser(IPHONE, { platform: 'iPhone' });
    await renderIn(<InstallPrompt />);
    await waitFor(() => screen.getByText('Install PawsPal'));
    await fireEvent.press(screen.getByText('Show me how'));
    expect(screen.getByText(/Share button/)).toBeTruthy();
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
    expect(screen.getByText('Tap Add.')).toBeTruthy();
    expect(screen.queryByText(/Open this page in Safari/)).toBeNull();
  });

  it('on Chrome for iPhone it also says to open the page in Safari', async () => {
    setBrowser(CHROME_IPHONE, { platform: 'iPhone' });
    await renderIn(<InstallPrompt />);
    await waitFor(() => screen.getByText('Show me how'));
    await fireEvent.press(screen.getByText('Show me how'));
    expect(screen.getByText(/Open this page in Safari/)).toBeTruthy();
  });

  it('in Arabic it shows the Arabic words', async () => {
    setBrowser(IPHONE, { platform: 'iPhone' });
    await renderIn(<InstallPrompt />, { locale: 'ar' });
    await waitFor(() => screen.getByText('ثبّت PawsPal'));
    expect(screen.getByLabelText('إخفاء اقتراح التثبيت')).toBeTruthy();
  });

  it('is hidden when PawsPal is already on the home screen', async () => {
    setBrowser(IPHONE, { standalone: true, platform: 'iPhone' });
    const { toJSON } = await renderIn(<InstallPrompt />);
    expect(toJSON()).toBeNull();
  });

  it('is hidden in a desktop or Android browser until the browser makes its install offer, then runs it', async () => {
    const listeners = setBrowser(ANDROID, { platform: 'Linux armv8l' });
    const { toJSON } = await renderIn(<InstallPrompt />);
    expect(toJSON()).toBeNull();
    const prompt = jest.fn(async () => {});
    await act(async () => { (listeners.beforeinstallprompt ?? []).forEach((fn) => fn({ preventDefault: jest.fn(), prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) })); });
    await waitFor(() => screen.getByText('Install'));
    await fireEvent.press(screen.getByText('Install'));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  });

  it('"Not now" hides the card and remembers it, but the Settings row stays', async () => {
    setBrowser(IPHONE, { platform: 'iPhone' });
    const first = await renderIn(<InstallPrompt />);
    await waitFor(() => screen.getByText('Install PawsPal'));
    await fireEvent.press(screen.getByLabelText('Hide the install suggestion'));
    expect(screen.queryByText('Install PawsPal')).toBeNull();
    expect(await wasDismissed()).toBe(true);
    await first.unmount();
    const again = await renderIn(<InstallPrompt />);
    await act(async () => { await wasDismissed(); }); // let the saved choice load
    expect(again.toJSON()).toBeNull();
  });

  it('keeps the Settings row even after "Not now"', async () => {
    setBrowser(IPHONE, { platform: 'iPhone' });
    await rememberDismissed();
    await renderIn(<InstallPrompt variant="settings" />);
    await waitFor(() => screen.getByText('Install PawsPal'));
    expect(screen.queryByLabelText('Hide the install suggestion')).toBeNull();
  });
});
