# PawsPal mobile app (Expo, React Native, TypeScript)

```bash
cp .env.example .env.local      # fill in the Supabase URL and anon key
npm install
npx expo install --fix          # aligns every package to the Expo SDK in use
npm start                       # runs scripts/sync-shared.mjs first, then Expo
```

- `app/` screens (Expo Router). `app/showcase.tsx` shows every animation from the intro video, for checking app motion against social media. Dev only.
- `src/components/` shared UI: AnimatedLogo, Blob, Button, SwipeDeck, HeartBurst, CheckStamp, PinDrop, Illustration, LegalDocument.
- `src/theme/` light and navy themes from `design/tokens.json`.
- `src/motion/` the shared timing and easing from `docs/motion.md`.
- `src/illustrations/index.ts`, `src/legal/index.ts`, `src/theme/tokens.json` are **generated**. Edit `assets/`, `docs/legal/` or `design/` instead, then run `npm run sync`.

Type-checked on 27 Oct 2026 against Expo SDK 58, React Native 0.88, Reanimated 4.7, Gesture Handler 3.4 and react-native-svg 15.16.
