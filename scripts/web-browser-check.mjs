// A by-hand check of the exported web app in a real browser (Chromium via Playwright). It is NOT part of CI because
// Playwright is not a dependency of the repo; run it after `npm run build:web` when you change the web build:
//   NODE_PATH=$(npm root -g) node scripts/web-browser-check.mjs
// It serves apps/mobile/dist with the vercel.json headers (scripts/serve-web.mjs) and checks: no content-policy errors on
// the welcome and sign-in screens, the manifest, the service worker, the offline page, the install steps on an iPhone,
// and Arabic right-to-left.
import { createRequire } from 'node:module';
import { start } from './serve-web.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const port = 4180;
const base = `http://localhost:${port}`;
const server = await start(port);
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const browser = await chromium.launch();
const shot = (page, name) => (process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }) : Promise.resolve());

async function watch(page) {
  const problems = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

try {
  // 1. Welcome and sign-in: no content-policy problems.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const problems = await watch(page);
    await page.goto(base + '/');
    await page.getByText('Create account').first().waitFor({ timeout: 20000 });
    check('welcome screen renders', true);
    await page.waitForTimeout(3500); // let the entrance animations finish
    await shot(page, 'welcome');
    await page.goto(base + '/signin');
    await page.getByText(/Sign in/).first().waitFor({ timeout: 20000 });
    check('sign-in screen renders', true);
    check('no content-policy errors or page errors', problems.length === 0, problems.join(' | '));

    // 2. Manifest.
    const res = await page.request.get(base + '/manifest.webmanifest');
    const manifest = await res.json();
    check('manifest has its content type', /manifest\+json/.test(res.headers()['content-type']));
    check('manifest is installable', manifest.display === 'standalone' && manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.purpose === 'maskable'));
    for (const icon of manifest.icons) check(`icon ${icon.src} loads`, (await page.request.get(base + icon.src)).ok());

    // 3. Service worker registers, then the offline page shows without a connection.
    //    (The registration only happens in a production build, which is what is being served here.)
    await page.goto(base + '/');
    const registered = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
    check('service worker registers and activates', registered);
    await page.reload(); // so the page is controlled by the worker
    await ctx.setOffline(true);
    await page.goto(base + '/signin').catch(() => {});
    const offlineText = await page.locator('body').innerText();
    check('offline page shows when there is no connection', /You are offline/.test(offlineText) && /غير متصل/.test(offlineText));
    await ctx.setOffline(false);
    await ctx.close();
  }

  // 4. iPhone: the install steps.
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const problems = await watch(page);
    await page.goto(base + '/');
    await page.getByText('Install PawsPal').first().waitFor({ timeout: 20000 });
    check('install card shows on an iPhone', true);
    await page.waitForTimeout(2500);
    await shot(page, 'welcome-iphone');
    await page.getByText('Show me how').first().click();
    await page.getByText('Add to Home Screen').first().waitFor({ timeout: 5000 });
    check('install steps show (Share, Add to Home Screen, Add)', (await page.getByText(/Share button/).count()) > 0 && (await page.getByText(/Tap Add\./).count()) > 0);
    await shot(page, 'install-steps');
    check('no "open in Safari" note in Safari', (await page.getByText(/Open this page in Safari/).count()) === 0);
    check('no content-policy errors on the iPhone page', problems.length === 0, problems.join(' | '));
    await ctx.close();
    const chrome = await browser.newContext({ ...devices['iPhone 13'], userAgent: devices['iPhone 13'].userAgent.replace(/Version\/[\d.]+ Mobile/, 'CriOS/120.0 Mobile') });
    const cp = await chrome.newPage();
    await cp.goto(base + '/');
    await cp.getByText('Show me how').first().click();
    await cp.getByText(/Open this page in Safari/).first().waitFor({ timeout: 5000 });
    check('Chrome on iPhone is told to open the page in Safari', true);
    await chrome.close();
  }

  // 5. Arabic: right to left.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('pawspal.locale', 'ar'));
    await page.goto(base + '/');
    await page.getByText('إنشاء حساب').first().waitFor({ timeout: 20000 });
    const dir = await page.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
    check('Arabic sets dir=rtl and lang=ar', dir[0] === 'rtl' && dir[1] === 'ar', dir.join(','));
    await page.waitForTimeout(3500);
    await shot(page, 'welcome-ar');
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} check(s) failed` : 'All browser checks passed');
process.exit(failed ? 1 : 0);
