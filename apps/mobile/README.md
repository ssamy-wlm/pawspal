# PawsPal mobile app (Expo, React Native, TypeScript)

```bash
cp .env.example .env.local      # fill in the Supabase URL and anon key
npm install
npx expo install --fix          # aligns every package to the Expo SDK in use
npm start                       # runs scripts/sync-shared.mjs first, then Expo
npm run web                     # the same app in the browser
npm run build:web               # production web export into dist/ (the PWA)
npm run check:web               # smoke test of dist/ and the headers in vercel.json
```

- Web (PWA): `public/` holds the page template, manifest, service worker, offline page and icons; `vercel.json` the hosting headers. Icons are made with `node ../../scripts/make-web-icons.mjs`. `node ../../scripts/serve-web.mjs` serves `dist/` with the same headers; `node ../../scripts/web-browser-check.mjs` checks it in Chromium (by hand, needs Playwright). See `docs/ARCHITECTURE.md` section 10b.
- `app/` screens (Expo Router). `src/dev/Showcase.tsx` shows every animation from the intro video, for checking app motion against social media. Development only: `app/showcase.tsx` loads it only when `__DEV__` is true, so production builds (phone and web) redirect to the welcome screen and do not contain it (`npm run check:web` proves it for the web).
- `src/components/` shared UI: AnimatedLogo, Blob, Button, SwipeDeck, HeartBurst, CheckStamp, PinDrop, Illustration, LegalDocument.
- `src/theme/` light and navy themes from `design/tokens.json`.
- `src/motion/` the shared timing and easing from `docs/motion.md`.
- `src/illustrations/index.ts`, `src/legal/index.ts`, `src/theme/tokens.json` are **generated**. Edit `assets/`, `docs/legal/` or `design/` instead, then run `npm run sync`.

Type-checked on 27 Oct 2026 against Expo SDK 58, React Native 0.88, Reanimated 4.7, Gesture Handler 3.4 and react-native-svg 15.16.

## Optional environment variables

Set these in the build environment (EAS secrets, Vercel), never in a file in Git.

| Name | Used for |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Required. The public Supabase address and anon key. |
| `EXPO_PUBLIC_SENTRY_DSN` | Optional. Turns on crash reporting (Sentry) in **production phone builds only**. Without it nothing is sent. |

## Crash reporting (Sentry)

- `src/lib/monitoring.ts` starts Sentry only when `EXPO_PUBLIC_SENTRY_DSN` is set and `__DEV__` is false. No user, no IP, no request bodies, no breadcrumbs; every event passes `src/lib/scrub.ts` (emails, tokens, ids, phone numbers, coordinates, long opaque strings are removed). Release is `pawspal-dahab@<version>`, environment `production`.
- The web build does not report crashes (`monitoring.web.ts` is empty), because the page's content policy does not allow a Sentry address. To turn it on later: add `https://<your DSN host>` to `connect-src` in `vercel.json` and to the allowed list in `scripts/check-web-build.mjs`, then implement `monitoring.web.ts`.
- The Sentry config plugin is in `app.json`. Uploading source maps needs a Sentry account, organisation and project plus `SENTRY_AUTH_TOKEN` as an EAS secret; until those exist, builds still work and traces are not symbolicated.

## Notifications

Push notifications are phone-only and start only after the person switches them on in Settings > Notifications (`src/lib/notifications.ts`). Registering a push token needs the EAS project id (`extra.eas.projectId`, created by `eas init`). Adding `expo-notifications`, `expo-sharing`, `expo-file-system` and `@sentry/react-native` changes native code, so the next release needs an EAS store build, not only an over-the-air update.
