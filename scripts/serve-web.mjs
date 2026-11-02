// A tiny static server for apps/mobile/dist that applies the same rewrites and headers as apps/mobile/vercel.json,
// so the exported site can be tried (and checked in a browser) before it goes live.
//   node scripts/serve-web.mjs [port]      (run `npm run build:web` in apps/mobile first)
// It reads vercel.json, so what you see here is what the headers say. It is an emulation of Vercel, not Vercel itself.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const app = join(root, 'apps/mobile');
const dist = join(app, 'dist');
const config = JSON.parse(readFileSync(join(app, 'vercel.json'), 'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.css': 'text/css', '.map': 'application/json' };
const matches = (source, path) => new RegExp(`^${source}$`).test(path);

/** Headers for a path, the way Vercel applies them: every matching rule, later rules winning for the same header. */
export function headersFor(path, rules = config.headers) {
  const out = {};
  for (const rule of rules) if (matches(rule.source, path)) for (const h of rule.headers) out[h.key.toLowerCase()] = h.value;
  return out;
}

/** The file to serve for a path: a real file first, then the single-page rewrite. */
export function resolve(path, dir = dist, rewrites = config.rewrites) {
  const clean = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
  const file = join(dir, clean);
  if (file.startsWith(dir) && existsSync(file) && statSync(file).isFile()) return file;
  for (const r of rewrites) if (matches(r.source, path)) return join(dir, r.destination);
  return null;
}

export function start(port = 4173) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = resolve(path);
    const headers = headersFor(path);
    if (!file || !existsSync(file)) { res.writeHead(404, headers); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', ...headers });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 4173);
  await start(port);
  console.log(`Serving apps/mobile/dist on http://localhost:${port}`);
}
