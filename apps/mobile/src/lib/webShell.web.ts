/** Registers the offline page and cache (public/sw.js). Only in the published site: never while developing. */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const start = () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* the app works without it */ }); };
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
}

/** Fades out the plain navy start-up picture from the page's HTML (see app/+html.tsx) once the app can draw. */
export function hideWebSplash(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('pp-splash');
  if (!el) return;
  el.setAttribute('data-hidden', 'true');
  setTimeout(() => el.remove(), 400);
}
