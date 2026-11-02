/* PawsPal service worker.
 * What it does: keeps the app's own files so the app opens fast, and shows /offline.html when there is no connection.
 * What it never does: touch anything that is not this site's own GET files. Sign-in, the database, storage, the functions,
 * the map tiles and every other site go straight to the network and are never kept.
 * Change CACHE when this file's behaviour changes; old caches are deleted on activate. */
const CACHE = 'pawspal-shell-v1';
const SHELL = ['/offline.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Files whose name carries a content hash never change, so they are kept for good: the app bundle and the fonts and images in it.
const isHashedAsset = (url) => url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/');

const isShellFile = (url) => url.pathname === '/offline.html' || url.pathname === '/favicon.svg' || url.pathname.startsWith('/icons/');

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;                         // never touch POST, PUT, DELETE
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;              // never touch another origin (Supabase, tiles, anything)
  if (request.mode === 'navigate') {
    // Pages (sign-in links included): the network first, so a new version shows at once and nothing with a token is kept.
    // The offline page shows when there is no connection.
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }

  if (isHashedAsset(url)) {
    // Cache first: a hashed file is the same forever.
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') { const copy = response.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
        return response;
      }))
    );
    return;
  }

  if (isShellFile(url)) {
    // The offline page and the icons: cache first, so they are always there.
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
  // Everything else (map frame, splash pictures, ...) goes to the network as usual.
});
