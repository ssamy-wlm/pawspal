import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const app = join(__dirname, '..');
const pub = (f: string) => join(app, 'public', f);
const read = (f: string) => readFileSync(pub(f), 'utf8');
const tokens = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'design', 'tokens.json'), 'utf8'));
const vercel = JSON.parse(readFileSync(join(app, 'vercel.json'), 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[]; rewrites: { source: string; destination: string }[]; buildCommand: string; outputDirectory: string; framework: unknown };
const headerOf = (source: string, key: string) => vercel.headers.find((h) => h.source === source)?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

describe('manifest', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  it('can be installed', () => {
    expect(m).toMatchObject({ short_name: 'PawsPal', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait', lang: 'en' });
    expect(m.name).toContain('PawsPal');
  });
  it('uses the brand navy from the shared tokens', () => {
    expect(m.theme_color).toBe(tokens.color.brand.navy);
    expect(m.background_color).toBe(tokens.color.brand.navy);
  });
  it('has 192 and 512 icons and a maskable one, and every icon file exists', () => {
    const sizes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    for (const i of m.icons) expect(existsSync(pub(i.src.replace(/^\//, '')))).toBe(true);
  });
  it('matches app.json', () => {
    const web = JSON.parse(readFileSync(join(app, 'app.json'), 'utf8')).expo.web;
    expect(web).toMatchObject({ bundler: 'metro', shortName: m.short_name, themeColor: m.theme_color, backgroundColor: m.background_color });
  });
});

describe('page template', () => {
  const html = read('index.html');
  it('links the manifest, icons and the splash colour', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain(tokens.color.brand.navy);
  });
  it('does not lock zoom', () => {
    expect(html).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
    expect(html).not.toMatch(/maximum-scale/i);
  });
  it('has no script of its own (the content policy only allows our script files)', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });
  it('has a start-up picture for every size in sizes.json, and the files exist', () => {
    const sizes = JSON.parse(read('splash/sizes.json')) as { file: string; width: number; height: number; ratio: number }[];
    expect(sizes.length).toBeGreaterThanOrEqual(8);
    for (const s of sizes) {
      expect(html).toContain(`/splash/${s.file}`);
      expect(html).toContain(`device-width: ${s.width}px) and (device-height: ${s.height}px) and (-webkit-device-pixel-ratio: ${s.ratio}`);
      expect(existsSync(pub(`splash/${s.file}`))).toBe(true);
    }
  });
});

describe('offline page', () => {
  const html = read('offline.html');
  it('makes no request to any other site', () => {
    expect(html).not.toMatch(/(src|href|action)\s*=\s*["']?(https?:)?\/\//i);
    expect(html).not.toMatch(/url\(\s*["']?https?:/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });
  it('has no exclamation marks', () => {
    expect(html.replace(/<!doctype[^>]*>/i, '').replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/[!！]/);
  });
  it('speaks English and Arabic, right to left for Arabic', () => {
    expect(html).toContain('lang="en"');
    expect(html).toMatch(/lang="ar" dir="rtl"/);
    expect(html).toMatch(/[؀-ۿ]/);
  });
  it('uses the brand colours', () => {
    for (const c of [tokens.color.brand.navy, tokens.color.dark.text, tokens.color.brand.orange]) expect(html.toUpperCase()).toContain(c.toUpperCase());
  });
});

describe('service worker (sw.js)', () => {
  const source = read('sw.js');
  type Handler = (e: unknown) => void;
  function load() {
    const handlers: Record<string, Handler> = {};
    const store = new Map<string, Map<string, string>>();
    const caches = {
      open: async (name: string) => { const m = store.get(name) ?? new Map<string, string>(); store.set(name, m); return { addAll: async (urls: string[]) => urls.forEach((u) => m.set(u, 'x')), put: async (r: { url: string }) => { m.set(new URL(r.url).pathname, 'x'); } }; },
      match: async (r: string | { url: string }) => { const p = typeof r === 'string' ? r : new URL(r.url).pathname; for (const m of store.values()) if (m.has(p)) return { cached: p }; return undefined; },
      keys: async () => [...store.keys()], delete: async (k: string) => store.delete(k),
    };
    const self = { location: { origin: 'https://app.pawspal.example' }, addEventListener: (n: string, h: Handler) => { handlers[n] = h; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
    const fetchMock = jest.fn(async (r: { url: string }) => ({ ok: true, type: 'basic', url: r.url, clone() { return this; } }));
    vm.runInNewContext(source, { self, caches, fetch: fetchMock, URL, Promise });
    return { handlers, store, fetchMock };
  }
  const event = (url: string, extra: { method?: string; mode?: string } = {}) => {
    const e = { request: { url, method: extra.method ?? 'GET', mode: extra.mode ?? 'cors' }, respondWith: jest.fn() };
    return e;
  };

  it('keeps the offline page and icons when it installs', async () => {
    const { handlers, store } = load();
    let done: Promise<unknown> = Promise.resolve();
    handlers.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    const keys = [...(store.values().next().value as Map<string, string>).keys()];
    expect(keys).toEqual(expect.arrayContaining(['/offline.html', '/icons/icon-192.png']));
  });

  it('never touches another site, so Supabase, tiles and storage go straight to the network', () => {
    const { handlers } = load();
    for (const url of ['https://abc.supabase.co/rest/v1/profiles', 'https://abc.supabase.co/auth/v1/token', 'https://abc.supabase.co/storage/v1/object/x', 'https://tile.openstreetmap.org/1/2/3.png', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js']) {
      const e = event(url); handlers.fetch(e);
      expect(e.respondWith).not.toHaveBeenCalled();
    }
  });

  it('never touches anything that is not a GET', () => {
    const { handlers } = load();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const e = event('https://app.pawspal.example/_expo/static/js/web/x-abc.js', { method }); handlers.fetch(e);
      expect(e.respondWith).not.toHaveBeenCalled();
    }
  });

  it('does not touch API-like paths or files it does not know', () => {
    const { handlers } = load();
    for (const path of ['/rest/v1/x', '/functions/v1/process-upload', '/map-frame.html', '/manifest.webmanifest', '/sw.js']) {
      const e = event(`https://app.pawspal.example${path}`); handlers.fetch(e);
      expect(e.respondWith).not.toHaveBeenCalled();
    }
  });

  it('goes to the network for pages and shows the offline page without a connection', async () => {
    const { handlers, fetchMock, store } = load();
    await handlers.install({ waitUntil: () => {} }); // not awaited by the harness; fill the cache directly
    await (async () => { const c = new Map([['/offline.html', 'x']]); store.set('pawspal-shell-v1', c); })();
    const e = event('https://app.pawspal.example/auth/callback#access_token=SECRET', { mode: 'navigate' });
    handlers.fetch(e);
    expect(e.respondWith).toHaveBeenCalled();
    await e.respondWith.mock.calls[0][0];
    expect(fetchMock).toHaveBeenCalled();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const off = event('https://app.pawspal.example/signin', { mode: 'navigate' });
    handlers.fetch(off);
    await expect(off.respondWith.mock.calls[0][0]).resolves.toEqual({ cached: '/offline.html' });
  });

  it('keeps hashed files for good (cache first) and does not keep pages', async () => {
    const { handlers, fetchMock, store } = load();
    store.set('pawspal-shell-v1', new Map());
    const e = event('https://app.pawspal.example/_expo/static/js/web/entry-abc123.js');
    handlers.fetch(e);
    await e.respondWith.mock.calls[0][0];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.get('pawspal-shell-v1')?.has('/_expo/static/js/web/entry-abc123.js')).toBe(true);
    const again = event('https://app.pawspal.example/_expo/static/js/web/entry-abc123.js');
    handlers.fetch(again);
    await again.respondWith.mock.calls[0][0];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const page = event('https://app.pawspal.example/signin', { mode: 'navigate' });
    handlers.fetch(page);
    await page.respondWith.mock.calls[0][0];
    expect(store.get('pawspal-shell-v1')?.has('/signin')).toBe(false);
  });

  it('has no hard-coded secrets or other origins', () => {
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/service_role/i);
  });
});

describe('the sandboxed map frame (map-frame.js)', () => {
  const source = read('map-frame.js');
  function load() {
    const parent = { postMessage: jest.fn() };
    const listeners: ((e: unknown) => void)[] = [];
    const doc = { open: jest.fn(() => { listeners.length = 0; }), write: jest.fn(), close: jest.fn() };
    const win: Record<string, unknown> = { parent, document: doc, addEventListener: (_: string, fn: (e: unknown) => void) => { listeners.push(fn); } };
    win.window = win;
    vm.runInNewContext(source, { ...win, window: win, document: doc, parent });
    return { parent, doc, win, send: (e: unknown) => [...listeners].forEach((fn) => fn(e)) };
  }
  it('tells the app it is ready, then writes only the page the app sends', () => {
    const { parent, doc, send } = load();
    expect(parent.postMessage).toHaveBeenCalledWith({ pawspal: 'map-frame-ready' }, '*');
    send({ source: parent, data: { pawspal: 'map-html', html: '<p>map</p>' } });
    expect(doc.write).toHaveBeenCalledWith('<p>map</p>');
  });
  it('ignores messages from anywhere else and anything malformed', () => {
    const { doc, send } = load();
    send({ source: {}, data: { pawspal: 'map-html', html: '<p>evil</p>' } });
    send({ source: undefined, data: { pawspal: 'map-html', html: '<p>evil</p>' } });
    expect(doc.write).not.toHaveBeenCalled();
  });
  it('still listens after the page is written (writing clears listeners)', () => {
    const { parent, doc, send } = load();
    send({ source: parent, data: { pawspal: 'map-html', html: 'one' } });
    send({ source: parent, data: { pawspal: 'map-html', html: 'two' } });
    expect(doc.write).toHaveBeenCalledTimes(2);
  });
  it('gives the map page the same message call a phone WebView has, which reaches the app', () => {
    const { parent, win } = load();
    (win.ReactNativeWebView as { postMessage(s: string): void }).postMessage('{"type":"ready"}');
    expect(parent.postMessage).toHaveBeenLastCalledWith({ pawspal: 'map-msg', data: '{"type":"ready"}' }, '*');
  });
});

describe('vercel.json', () => {
  const main = vercel.headers[0];
  const csp = headerOf(main.source, 'Content-Security-Policy') as string;
  const directive = (name: string, policy = csp) => (policy.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `)) ?? '').split(/\s+/).slice(1);

  it('builds the web export into dist, as a plain site', () => {
    expect(vercel).toMatchObject({ buildCommand: 'npx expo export -p web', outputDirectory: 'dist', framework: null });
  });
  it('sends every address that is not a file to the app, but never a missing asset', () => {
    const r = new RegExp(`^${vercel.rewrites[0].source}$`);
    expect(vercel.rewrites[0].destination).toBe('/index.html');
    for (const p of ['/signin', '/auth/callback', '/pets/123', '/signup/account']) expect(r.test(p)).toBe(true);
    for (const p of ['/sw.js', '/manifest.webmanifest', '/_expo/static/js/web/x.js', '/assets/x.png', '/icons/icon-192.png', '/offline.html']) expect(r.test(p)).toBe(false);
  });
  it('has a strict policy: only this site runs script, frames are refused, objects are off', () => {
    expect(directive('default-src')).toEqual(["'self'"]);
    expect(directive('script-src')).toEqual(["'self'"]);
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
    expect(directive('object-src')).toEqual(["'none'"]);
    expect(directive('base-uri')).toEqual(["'self'"]);
    expect(directive('form-action')).toEqual(["'self'"]);
    expect(directive('frame-src')).toEqual(["'self'"]);
    expect(directive('worker-src')).toEqual(["'self'"]);
  });
  it('lets the page talk only to itself and Supabase', () => {
    expect(directive('connect-src')).toEqual(expect.arrayContaining(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co']));
    for (const v of directive('connect-src')) expect(v).toMatch(/^('self'|blob:|https:\/\/\*\.supabase\.co|wss:\/\/\*\.supabase\.co)$/);
    expect(directive('img-src')).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:', 'https://*.supabase.co']));
  });
  it('lists no third-party script, anywhere in the main policy', () => {
    expect(csp).not.toMatch(/unpkg|jsdelivr|cloudflare|google|\*\s|https:\s/);
  });
  it('sends the other security headers', () => {
    expect(headerOf(main.source, 'Referrer-Policy')).toBeTruthy();
    expect(headerOf(main.source, 'X-Content-Type-Options')).toBe('nosniff');
    expect(headerOf(main.source, 'Strict-Transport-Security')).toMatch(/max-age=\d{7,}/);
    expect(headerOf(main.source, 'X-Frame-Options')).toBe('DENY');
    const pp = headerOf(main.source, 'Permissions-Policy') as string;
    expect(pp).toContain('camera=(self)');
    expect(pp).toContain('geolocation=(self)');
    expect(pp).toContain('microphone=()');
  });
  it('gives the map frame its own policy, which is the only place the map script host is allowed', () => {
    const frame = '/map-frame.html';
    const fcsp = headerOf(frame, 'Content-Security-Policy') as string;
    expect(directive('script-src', fcsp)).toEqual(expect.arrayContaining(["'self'", 'https://unpkg.com']));
    expect(directive('frame-ancestors', fcsp)).toEqual(["'self'"]);
    expect(directive('default-src', fcsp)).toEqual(["'none'"]);
    expect(new RegExp(`^${main.source}$`).test(frame)).toBe(false); // the main policy does not apply to it
  });
  it('allows the map host that the map page loads from', () => {
    const { MAPLIBRE_JS_URL, MAPLIBRE_CSS_URL } = jest.requireActual('../src/lib/mapHtml');
    const fcsp = headerOf('/map-frame.html', 'Content-Security-Policy') as string;
    expect(directive('script-src', fcsp)).toContain(new URL(MAPLIBRE_JS_URL).origin);
    expect(directive('style-src', fcsp)).toContain(new URL(MAPLIBRE_CSS_URL).origin);
  });
  it('caches hashed files for a year, and never the service worker, manifest or pages', () => {
    expect(headerOf('/_expo/static/(.*)', 'Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(headerOf('/assets/(.*)', 'Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(headerOf('/sw.js', 'Cache-Control')).toMatch(/no-cache/);
    expect(headerOf('/manifest.webmanifest', 'Cache-Control')).toMatch(/no-cache/);
    expect(headerOf('/manifest.webmanifest', 'Content-Type')).toMatch(/^application\/manifest\+json/);
    const pages = vercel.headers.find((h) => h.headers.some((x) => x.key === 'Cache-Control' && /no-cache/.test(x.value)) && h.source.startsWith('/((?!_expo'));
    expect(pages).toBeTruthy();
    expect(new RegExp(`^${pages!.source}$`).test('/index.html')).toBe(true);
    expect(new RegExp(`^${pages!.source}$`).test('/_expo/static/js/web/a.js')).toBe(false);
  });
});
