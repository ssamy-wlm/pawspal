// Run after `npm run build`: the built home page must show the logo and the message.
import { existsSync, readFileSync } from 'node:fs';

const page = '.next/server/app/index.html';
if (!existsSync(page)) {
  console.error(`Missing ${page}. Run "npm run build" first.`);
  process.exit(1);
}
const html = readFileSync(page, 'utf8');
const checks = [
  ['message', html.includes('Admin dashboard coming soon')],
  ['logo', html.includes('/pawspal-logo.svg') && html.includes('alt="PawsPal Dahab"')],
  ['not indexed', html.includes('noindex')],
  ['logo file shipped', existsSync('public/pawspal-logo.svg')],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error('Smoke test failed: ' + failed.join(', '));
  process.exit(1);
}
console.log('Smoke test OK: ' + checks.map(([name]) => name).join(', '));
