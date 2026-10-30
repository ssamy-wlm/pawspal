// Run after `npm run build`: the built home page must show only the sign-in shell (no data), the logo and "noindex",
// and the site must carry its security headers.
import { existsSync, readFileSync } from 'node:fs';

const page = '.next/server/app/index.html';
if (!existsSync(page)) {
  console.error(`Missing ${page}. Run "npm run build" first.`);
  process.exit(1);
}
const html = readFileSync(page, 'utf8');
const config = readFileSync('next.config.mjs', 'utf8');
const checks = [
  ['sign-in shell', html.includes('One moment') && html.includes('Admin')],
  ['logo', html.includes('/pawspal-logo.svg') && html.includes('alt="PawsPal Dahab"')],
  ['no data in the page', !/Open reports|Active users|Audit log/.test(html.split('<script')[0].replace(/<nav[\s\S]*?<\/nav>/, ''))],
  ['not indexed', html.includes('noindex')],
  ['logo file shipped', existsSync('public/pawspal-logo.svg')],
  ['frames refused', config.includes("frame-ancestors 'none'") && config.includes('X-Frame-Options')],
  ['scripts only from this site', config.includes("script-src 'self'") && !/script-src[^`"]*https?:\/\/(?!challenges\.cloudflare\.com)/.test(config)],
  ['no service key in the site', !/service_role|SERVICE_ROLE/i.test(readFileSync('src/supabase.ts', 'utf8') + readFileSync('src/data.ts', 'utf8'))],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error('Smoke test failed: ' + failed.join(', '));
  process.exit(1);
}
console.log('Smoke test OK: ' + checks.map(([name]) => name).join(', '));
