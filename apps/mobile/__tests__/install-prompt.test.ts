import {
  captureInstallPrompt, hasDeferredPrompt, installMode, isIos, isIosSafari, isStandalone, onInstallChange,
  rememberDismissed, resetInstallPromptForTests, runInstallPrompt, wasDismissed,
} from '../src/lib/installPrompt';

const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const CHROME_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1';
const SAFARI_IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

describe('which browser is this', () => {
  it('knows iPhone and iPad, including an iPad that says it is a Mac', () => {
    expect(isIos(SAFARI_IPHONE)).toBe(true);
    expect(isIos(CHROME_IPHONE)).toBe(true);
    expect(isIos(SAFARI_IPAD_AS_MAC, 5, 'MacIntel')).toBe(true);
    expect(isIos(SAFARI_IPAD_AS_MAC, 0, 'MacIntel')).toBe(false); // a real Mac has no touch screen
    expect(isIos(CHROME_ANDROID)).toBe(false);
    expect(isIos(CHROME_MAC)).toBe(false);
  });

  it('tells Safari from other browsers on iOS', () => {
    expect(isIosSafari(SAFARI_IPHONE)).toBe(true);
    expect(isIosSafari(SAFARI_IPAD_AS_MAC, 5, 'MacIntel')).toBe(true);
    expect(isIosSafari(CHROME_IPHONE)).toBe(false);
    expect(isIosSafari(SAFARI_IPHONE.replace('Safari/604.1', 'Safari/604.1 FxiOS/124')) ).toBe(false);
    expect(isIosSafari(CHROME_ANDROID)).toBe(false);
  });
});

describe('already installed', () => {
  const win = (standalone: boolean | undefined, displayMode: boolean) => ({
    navigator: { standalone }, matchMedia: (q: string) => ({ matches: displayMode && q.includes('standalone') }),
  }) as never;
  it('is true from the home screen on iPhone and in a standalone window elsewhere', () => {
    expect(isStandalone(win(true, false))).toBe(true);
    expect(isStandalone(win(undefined, true))).toBe(true);
    expect(isStandalone(win(false, false))).toBe(false);
    expect(isStandalone(win(undefined, false))).toBe(false);
  });
  it('is false (not a crash) when the browser cannot say', () => {
    expect(isStandalone({ navigator: {}, matchMedia: () => { throw new Error('no'); } } as never)).toBe(false);
  });
});

describe('installMode', () => {
  it('hides once installed, whatever else is true', () => {
    expect(installMode({ standalone: true, deferred: true, ios: true })).toBe('hidden');
  });
  it('uses the browser offer when there is one, the iPhone steps on iOS, nothing otherwise', () => {
    expect(installMode({ standalone: false, deferred: true, ios: false })).toBe('prompt');
    expect(installMode({ standalone: false, deferred: false, ios: true })).toBe('ios');
    expect(installMode({ standalone: false, deferred: false, ios: false })).toBe('hidden');
  });
});

describe('"not now" is remembered', () => {
  it('starts as not dismissed, then stays dismissed', async () => {
    expect(await wasDismissed()).toBe(false);
    await rememberDismissed();
    expect(await wasDismissed()).toBe(true);
  });
});

describe('the browser install offer', () => {
  beforeEach(() => resetInstallPromptForTests());
  const fakeWindow = () => {
    const handlers: Record<string, ((e: Event) => void)[]> = {};
    return {
      addEventListener: (name: string, fn: (e: Event) => void) => { (handlers[name] ??= []).push(fn); },
      fire: (name: string, e: Record<string, unknown> = {}) => (handlers[name] ?? []).forEach((fn) => fn({ preventDefault: jest.fn(), ...e } as never)),
    };
  };

  it('keeps the offer, keeps the page from showing the browser\'s own bar, and runs it once', async () => {
    const w = fakeWindow();
    captureInstallPrompt(w as never);
    const changed = jest.fn();
    onInstallChange(changed);
    const preventDefault = jest.fn();
    const prompt = jest.fn(async () => {});
    w.fire('beforeinstallprompt', { preventDefault, prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    expect(preventDefault).toHaveBeenCalled();
    expect(hasDeferredPrompt()).toBe(true);
    expect(changed).toHaveBeenCalled();
    await expect(runInstallPrompt()).resolves.toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(hasDeferredPrompt()).toBe(false);
    await expect(runInstallPrompt()).resolves.toBe('unavailable');
  });

  it('forgets the offer once the app is installed', () => {
    const w = fakeWindow();
    captureInstallPrompt(w as never);
    w.fire('beforeinstallprompt', { prompt: jest.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    w.fire('appinstalled');
    expect(hasDeferredPrompt()).toBe(false);
  });

  it('listens only once even if asked twice, and does nothing without a window', () => {
    const w = fakeWindow();
    const add = jest.spyOn(w, 'addEventListener');
    captureInstallPrompt(w as never);
    captureInstallPrompt(w as never);
    expect(add).toHaveBeenCalledTimes(2); // beforeinstallprompt and appinstalled, once each
    resetInstallPromptForTests();
    expect(() => captureInstallPrompt(null)).not.toThrow();
  });

  it('says "unavailable" when the browser refuses to show it', async () => {
    const w = fakeWindow();
    captureInstallPrompt(w as never);
    w.fire('beforeinstallprompt', { prompt: jest.fn(async () => { throw new Error('no'); }), userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    await expect(runInstallPrompt()).resolves.toBe('unavailable');
  });
});
