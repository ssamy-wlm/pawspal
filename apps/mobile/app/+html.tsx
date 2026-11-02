import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';
import tokens from '../src/theme/tokens.json';
import splash from '../public/splash/sizes.json';

// The page every web visit starts from (web build only). It holds the install details (manifest, icons, iPhone start-up
// pictures) and a plain navy start-up screen that shows until the app can draw. No script lives in this file: the page's
// content policy only allows our own script files. Colours come from the shared tokens.
const navy = tokens.color.brand.navy;

const css = `
html{background-color:${navy}}
body{margin:0}
#pp-splash{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background-color:${navy};transition:opacity .3s ease-out}
#pp-splash[data-hidden="true"]{opacity:0;pointer-events:none}
#pp-splash img{width:120px;height:120px;border-radius:28px;animation:pp-breathe 3s ease-in-out infinite}
@keyframes pp-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
@media (prefers-reduced-motion:reduce){#pp-splash img{animation:none}#pp-splash{transition:none}}
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* Zoom stays allowed: people who need bigger text can pinch. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="description" content="Pet sitting in Dahab, from people who live here." />
        <meta name="theme-color" content={navy} />
        <meta name="format-detection" content="telephone=no" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="PawsPal" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        {splash.map((s) => (
          <link
            key={s.file}
            rel="apple-touch-startup-image"
            href={`/splash/${s.file}`}
            media={`(device-width: ${s.width}px) and (device-height: ${s.height}px) and (-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: portrait)`}
          />
        ))}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        {children}
        <div id="pp-splash" aria-hidden="true">
          <img src="/icons/icon-192.png" alt="" width={120} height={120} />
        </div>
        <noscript>PawsPal needs JavaScript to run. Please turn it on in your browser. / يحتاج PawsPal إلى تشغيل JavaScript في المتصفح.</noscript>
      </body>
    </html>
  );
}
