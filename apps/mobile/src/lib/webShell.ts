// Things only the web build does around the app (the service worker and the start-up picture). On a phone they do nothing;
// webShell.web.ts has the real ones, which Metro picks for the web build.
export function registerServiceWorker(): void {}
export function hideWebSplash(): void {}
