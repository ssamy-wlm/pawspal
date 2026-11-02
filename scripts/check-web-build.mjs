// Smoke test for the web build. Run after `npm run build:web` (in apps/mobile):  node ../../scripts/check-web-build.mjs
// It checks that the export has everything an installable site needs, that no secret got into it, and that the headers
// in vercel.json are the strict ones. Like apps/admin/scripts/smoke.mjs: one line per check, non-zero exit on any failure.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const app = join(root, 'apps/mobile');
const dist = join(app, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('Missing apps/mobile/dist/index.html. Run "npm run build:web" in apps/mobile first.');
  process.exit(1);
}
const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));
const tokens = json(join(root, 'design/tokens.json'));
const vercel = json(join(app, 'vercel.json'));
const html = read(join(dist, 'index.html'));
const manifest = existsSync(join(dist, 'manifest.webmanifest')) ? json(join(dist, 'manifest.webmanifest')) : null;
const sw = existsSync(join(dist, 'sw.js')) ? read(join(dist, 'sw.js')) : '';
const offline = existsSync(join(dist, 'offline.html')) ? read(join(dist, 'offline.html')) : '';

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const files = walk(dist);
const textFiles = files.filter((f) => ['.js', '.html', '.json', '.webmanifest', '.css', '.svg', '.map', '.txt'].includes(extname(f)));
const policyOf = (source) => vercel.headers.find((h) => h.source === source)?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
const mainSource = vercel.headers[0]?.source;
const csp = policyOf(mainSource);
const frameCsp = policyOf('/map-frame.html');
const directive = (policy, name) => (policy.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `)) ?? '').split(/\s+/).slice(1);
const headerOf = (source, key) => vercel.headers.find((h) => h.source === source)?.headers.find((h) => h.key === key)?.value;

// (The Supabase library itself mentions the prefix "sb_secret_" in code that refuses such keys; only a real-looking key counts.)
// A key that could write to the database (a service-role key) must never be in a page. The public anon key is fine.
function secretsIn() {
  const found = [];
  for (const f of textFiles) {
    const text = read(f);
    if (/service_role|SERVICE_ROLE|sb_secret_[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{10,}|BEGIN (RSA |EC )?PRIVATE KEY/.test(text.replace(/"service_role"\s*:\s*false/g, ''))) found.push(f.replace(dist, 'dist'));
    for (const m of text.matchAll(/eyJ[\w-]{10,}\.([\w-]{10,})\.[\w-]{10,}/g)) {
      try { if (JSON.parse(Buffer.from(m[1], 'base64url').toString()).role === 'service_role') found.push(`${f.replace(dist, 'dist')} (a service-role key)`); } catch { /* not a token */ }
    }
  }
  return found;
}
const secrets = secretsIn();

const checks = [
  ['index.html loads the app from this site only', /<script src="\/_expo\/static\/js\/web\/[^"]+" defer><\/script>/.test(html) && !/<script(?![^>]*\ssrc=)/i.test(html) && !/<script[^>]*src="https?:/i.test(html)],
  ['no inline scripts or event handlers in index.html', !/<script(?![^>]*\ssrc=)/i.test(html) && !/\son[a-z]+\s*=\s*["']/i.test(html)],
  ['zoom is not locked', !/user-scalable\s*=\s*(no|0)|maximum-scale/i.test(html)],
  ['manifest linked and valid', !!manifest && html.includes('rel="manifest"') && manifest.display === 'standalone' && manifest.start_url === '/' && manifest.short_name === 'PawsPal'],
  ['manifest colours match the brand navy', manifest?.theme_color === tokens.color.brand.navy && manifest?.background_color === tokens.color.brand.navy && html.includes(`name="theme-color" content="${tokens.color.brand.navy}"`)],
  ['every manifest icon exists (192, 512, maskable)', !!manifest && manifest.icons.length >= 3 && manifest.icons.every((i) => existsSync(join(dist, i.src))) && manifest.icons.some((i) => i.purpose === 'maskable') && manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512')],
  ['apple-touch-icon and favicon shipped', existsSync(join(dist, 'icons/apple-touch-icon.png')) && existsSync(join(dist, 'favicon.ico')) && html.includes('apple-touch-icon')],
  ['iPhone start-up pictures shipped', [...html.matchAll(/apple-touch-startup-image" href="([^"]+)"/g)].length >= 8 && [...html.matchAll(/apple-touch-startup-image" href="([^"]+)"/g)].every((m) => existsSync(join(dist, m[1])))],
  ['service worker shipped, with its offline page', sw.includes("addEventListener('fetch'") && offline.includes('You are offline') && sw.includes('/offline.html')],
  ['service worker leaves other sites and non-GET requests alone', /url\.origin !== self\.location\.origin/.test(sw) && /request\.method !== 'GET'/.test(sw) && !/https?:\/\//.test(sw)],
  ['offline page makes no outside requests and has no "!"', !/(src|href|action)\s*=\s*["']?(https?:)?\/\//i.test(offline) && !/<script/i.test(offline) && !/[!！]/.test(offline.replace(/<!doctype[^>]*>/i, ''))],
  ['map frame shipped', existsSync(join(dist, 'map-frame.html')) && existsSync(join(dist, 'map-frame.js'))],
  ['no secret or service-role key anywhere in dist', secrets.length === 0],
  ['build is the SPA export with the vercel settings', vercel.buildCommand === 'npx expo export -p web' && vercel.outputDirectory === 'dist' && vercel.framework === null && vercel.rewrites?.[0]?.destination === '/index.html'],
  ['policy: only this site runs script, no eval', JSON.stringify(directive(csp, 'script-src')) === JSON.stringify(["'self'"]) && !/unsafe-eval/.test(csp) && JSON.stringify(directive(csp, 'default-src')) === JSON.stringify(["'self'"])],
  ['policy: frames, objects and base refused or limited', directive(csp, 'frame-ancestors')[0] === "'none'" && directive(csp, 'object-src')[0] === "'none'" && directive(csp, 'base-uri')[0] === "'self'" && directive(csp, 'frame-src').join() === "'self'"],
  ['policy: talks only to itself and Supabase', directive(csp, 'connect-src').every((v) => ["'self'", 'blob:', 'https://*.supabase.co', 'wss://*.supabase.co'].includes(v)) && directive(csp, 'connect-src').includes('https://*.supabase.co')],
  ['policy: the map frame has its own, and only it may load the map script', directive(frameCsp, 'script-src').includes('https://unpkg.com') && !csp.includes('unpkg') && directive(frameCsp, 'frame-ancestors')[0] === "'self'" && !new RegExp(`^${mainSource}$`).test('/map-frame.html')],
  ['security headers: nosniff, HSTS, referrer, permissions, frame denial', headerOf(mainSource, 'X-Content-Type-Options') === 'nosniff' && /max-age=\d{7,}/.test(headerOf(mainSource, 'Strict-Transport-Security') ?? '') && !!headerOf(mainSource, 'Referrer-Policy') && /camera=\(self\)/.test(headerOf(mainSource, 'Permissions-Policy') ?? '') && /geolocation=\(self\)/.test(headerOf(mainSource, 'Permissions-Policy') ?? '') && headerOf(mainSource, 'X-Frame-Options') === 'DENY'],
  ['caching: hashed files immutable, service worker and manifest never cached', headerOf('/_expo/static/(.*)', 'Cache-Control')?.includes('immutable') === true && /no-cache/.test(headerOf('/sw.js', 'Cache-Control') ?? '') && /no-cache/.test(headerOf('/manifest.webmanifest', 'Cache-Control') ?? '') && /manifest\+json/.test(headerOf('/manifest.webmanifest', 'Content-Type') ?? '')],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (secrets.length) console.error('Secrets found in: ' + secrets.join(', '));
if (failed.length) {
  console.error('Web smoke test failed:\n  - ' + failed.join('\n  - '));
  process.exit(1);
}
console.log('Web smoke test OK:\n  ' + checks.map(([name]) => name).join('\n  '));
