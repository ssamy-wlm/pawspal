import * as Sentry from '@sentry/react-native';
import { initMonitoring, sentryOptions } from '../src/lib/monitoring';

const init = Sentry.init as jest.Mock;
beforeEach(() => init.mockClear());

describe('crash reporting', () => {
  it('is NOT started without a DSN', () => {
    expect(initMonitoring(undefined, false)).toBe(false);
    expect(initMonitoring('', false)).toBe(false);
    expect(initMonitoring('   ', false)).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('is NOT started in development, even with a DSN', () => {
    expect(initMonitoring('https://key@o1.ingest.sentry.io/1', true)).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('is NOT started by the app as tests run (no DSN is set here)', () => {
    expect(process.env.EXPO_PUBLIC_SENTRY_DSN).toBeUndefined();
    expect(initMonitoring()).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('starts in a production build with a DSN, with the privacy settings', () => {
    expect(initMonitoring('https://key@o1.ingest.sentry.io/1', false)).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    const o = init.mock.calls[0][0];
    expect(o).toMatchObject({ dsn: 'https://key@o1.ingest.sentry.io/1', environment: 'production', sendDefaultPii: false, maxBreadcrumbs: 0, tracesSampleRate: 0, attachScreenshot: false });
    expect(o.release).toMatch(/^pawspal-dahab@/);
    expect(o).not.toHaveProperty('user');
  });

  it('runs every event and breadcrumb through the scrubbers', () => {
    const o = sentryOptions('https://key@o1.ingest.sentry.io/1');
    const e = o.beforeSend({ type: undefined, user: { id: '1' }, message: 'a@b.co' } as never) as { user?: unknown; message?: string };
    expect(e.user).toBeUndefined();
    expect(e.message).toBe('[removed]');
    expect(o.beforeBreadcrumb({ category: 'ui.click', message: 'Send' })).toBeNull();
  });

  it('never throws when the SDK fails to start', () => {
    init.mockImplementationOnce(() => { throw new Error('native module missing'); });
    expect(initMonitoring('https://key@o1.ingest.sentry.io/1', false)).toBe(false);
  });
});
