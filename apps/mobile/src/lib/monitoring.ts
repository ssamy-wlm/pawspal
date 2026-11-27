// Crash reporting with Sentry (phone only: monitoring.web.ts does nothing). It starts only when EXPO_PUBLIC_SENTRY_DSN is set
// AND this is a production build, so development and tests never send anything. No user, no IP, no request bodies, no
// breadcrumbs; everything that is sent passes through scrub.ts first. See docs/security.md and apps/mobile/README.md.
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { scrubBreadcrumb, scrubEvent } from './scrub';

/** The settings Sentry is started with. Exported so a test can read them. */
export function sentryOptions(dsn: string) {
  return {
    dsn,
    environment: 'production',
    release: `pawspal-dahab@${Constants.expoConfig?.version ?? 'unknown'}`,
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableUserInteractionTracing: false,
    enableAutoPerformanceTracing: false,
    beforeSend: (event: Sentry.ErrorEvent) => scrubEvent(event),
    beforeBreadcrumb: (crumb: Sentry.Breadcrumb) => scrubBreadcrumb(crumb),
  };
}

/** Start crash reporting if there is a DSN and this is a production build. Returns whether it started. */
export function initMonitoring(dsn: string | undefined = process.env.EXPO_PUBLIC_SENTRY_DSN, dev: boolean = __DEV__): boolean {
  if (dev || !dsn || !dsn.trim()) return false;
  try {
    Sentry.init(sentryOptions(dsn.trim()));
    return true;
  } catch {
    return false; // crash reporting must never stop the app from opening
  }
}
