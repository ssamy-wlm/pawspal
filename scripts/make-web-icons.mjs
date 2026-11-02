// Draws the PWA icons and the iPhone start-up pictures from the logo files in assets/logo.
// Run by hand when the logo changes:  node scripts/make-web-icons.mjs   (needs `npm ci` in apps/mobile first)
// The PNGs it writes into apps/mobile/public are committed, so the web build itself needs no image tools.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const require = createRequire(join(root, 'apps/mobile/package.json'));
const { Resvg } = require('@resvg/resvg-js');

const pack = join(root, 'assets/logo/pack');
const out = join(root, 'apps/mobile/public');
const NAVY = '#1F2D3D';
mkdirSync(join(out, 'icons'), { recursive: true });
mkdirSync(join(out, 'splash'), { recursive: true });

const read = (p) => readFileSync(join(pack, p), 'utf8');
const png = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
const sizeOf = (svg) => { const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/); return { w: +m[1], h: +m[2] }; };
const inner = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

const appIcon = read('app-icon/pawspal-app-icon-navy.svg');          // square, navy, mark about 64% wide
const mark = read('transparent-for-dark-backgrounds/pawspal-icon-transparent-on-dark.svg');
const stacked = read('navy-background/pawspal-logo-stacked-navy-background.svg');

// "any" icons and the Apple icon: the finished square (the phone rounds the corners itself).
for (const s of [192, 512]) writeFileSync(join(out, 'icons', `icon-${s}.png`), png(appIcon, s));
writeFileSync(join(out, 'icons', 'apple-touch-icon.png'), png(appIcon, 180));
writeFileSync(join(out, 'favicon.png'), png(appIcon, 48));
writeFileSync(join(out, 'icons', 'favicon-32.png'), png(appIcon, 32));
writeFileSync(join(out, 'favicon.svg'), appIcon);

// Maskable: the mark sits inside the middle 60% so any shape the phone cuts still shows all of it.
{
  const { w, h } = sizeOf(mark); const size = 512; const target = size * 0.6; const k = target / Math.max(w, h);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${NAVY}"/><g transform="translate(${(size - w * k) / 2} ${(size - h * k) / 2}) scale(${k})">${inner(mark)}</g></svg>`;
  writeFileSync(join(out, 'icons', 'maskable-512.png'), png(svg, size));
}

// iPhone start-up pictures: navy with the stacked logo in the middle. [css width, css height, pixel ratio]
const PHONES = [[440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3], [375, 812, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2]];
const { w: lw, h: lh } = sizeOf(stacked);
for (const [cw, ch, r] of PHONES) {
  const W = cw * r, H = ch * r; const k = (W * 0.46) / lw;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${NAVY}"/><g transform="translate(${(W - lw * k) / 2} ${(H - lh * k) / 2}) scale(${k})">${inner(stacked)}</g></svg>`;
  writeFileSync(join(out, 'splash', `iphone-${W}x${H}.png`), png(svg, W));
}
// The list the page header uses, kept next to the pictures so the two cannot drift apart.
writeFileSync(join(out, 'splash', 'sizes.json'), JSON.stringify(PHONES.map(([cw, ch, r]) => ({ file: `iphone-${cw * r}x${ch * r}.png`, width: cw, height: ch, ratio: r })), null, 2) + '\n');
console.log('wrote icons and', PHONES.length, 'start-up pictures to apps/mobile/public');
