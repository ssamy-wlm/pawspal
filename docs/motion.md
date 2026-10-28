# Motion spec: one set of animations for the app and social media

Every animation below appears in the PawsPal intro video and the Instagram posts, and the app must reproduce them with the same timing and feel. Values come from `design/tokens.json → motion`. The reference implementation for React Native is in `apps/mobile/src/motion/` (Reanimated 3+).

## Shared vocabulary

| Name | Curve | Notes |
|---|---|---|
| `easeOut` | cubic out, `1 − (1 − t)³` | Default for anything arriving |
| `easeIn` | cubic in, `t³` | Anything leaving (swipe out, pin falling) |
| `easeInOut` | cubic in-out | Cross-fades, label swaps |
| `backOut(k)` | overshoot, `1 + (k+1)(t−1)³ + k(t−1)²` | `k = 1.4` soft, `1.7` pop, `1.9` bouncy |
| `squash(a)` | scaleX `1+a·sin(πp)`, scaleY `1−a·sin(πp)`, decaying | The landing "boing" on the logo, check and pin |
| `breathe` | scale `1 ± 0.02` on a 3 s sine | Background circles; never stops |

Durations are in milliseconds. "Stagger" is the gap between siblings starting.

## 1. Logo entrance (splash, welcome, empty states, video opener)

1. Pad (teal house) grows from 0 → 1 with `backOut(1.7)` over **750 ms**, rising 60 px with `easeOut`.
2. On landing, `squash(0.08)` over **450 ms**.
3. Toes pop one by one, left to right: `backOut(1.9)`, **400 ms** each, stagger **120 ms**, transform origin at the base of each toe.
4. Idle: the whole mark sways `±1.6°` on a 3.3 s sine; after 1.6 s the toes wiggle `±4°`.
5. Wordmark "PawsPal" fades in from the right, then "Dahab" rises 30 px over **500 ms**.

## 2. Background circles

Soft tinted circles sit behind content on every screen (teal tint, orange tint, sand). They `breathe` and drift a few pixels. On screen entry they pop in with `backOut(1.4)` over 500 ms. They are decoration only: `accessible={false}` and no touch handling.

## 3. Browse deck (swipe stack)

- Stack shows 3 cards. Each lower card: offset **26 px** down, scale **−5%**, rotate **±5°** alternating.
- Cards enter from 300 px below with `backOut(1.5)`, **600 ms**, stagger **120 ms**.
- **Pass (✕ or swipe left):** a 200 ms anticipation nudge of 30 px right, then out to −1.4 × screen width with `easeIn`, **500 ms**, rotating to −32°. Opacity fades in the last 200 ms.
- **Like (♥ or swipe right):** mirror of pass.
- The next card is promoted with `easeOut`, **450 ms**, starting 150 ms after the swipe.
- Gesture: follow the finger 1:1, rotate `x / 20` degrees; release past 35% of width or with velocity > 800 px/s to commit, else spring back (damping 15, stiffness 180).
- Buttons: ✕ scales to 0.88 on press; ♥ scales 0.86 → 1.10 → 1 over 700 ms.

## 4. Heart burst (like, match, saved)

Nine small hearts (orange and coral alternating) rise from the ♥ button: each travels up 300–720 px and sideways ±450 px with `easeOut`, scales in with `backOut(1.8)` over the first 30%, and fades over the last 35%. Total **1250 ms**, random start offsets up to 250 ms (seeded so it looks the same every time).

## 5. Chat bubbles and terms card

- New bubble: rises 40 px, scales from 0 with `backOut(1.6)` over **450 ms**; opacity reaches 1 in the first 150 ms. Origin is the bubble's tail corner (bottom-left for incoming, bottom-right for outgoing).
- The proposed-terms card arrives the same way.
- **Accept terms:** press scales to 0.92 (220 ms), the label cross-fades "Accept terms" → "Accepted" (250 ms, `easeInOut`), the button turns orange, and an orange ring ripples from the button: scale 0.4 → 2 with `easeOut`, fading out, **450 ms**.

## 6. Booking confirmed

1. Teal check badge stamps in: `backOut(1.9)` over **400 ms**, then `squash(0.12)` over 300 ms.
2. The tick draws itself (stroke dash offset 1 → 0) over **400 ms**, starting at 350 ms.
3. The map card rises 60 px and fades in over 550 ms.
4. **Pin drop:** at 1000 ms the pin falls 320 px with `easeIn` over **450 ms**, lands with `squash(0.18)`, and a teal glow ring grows 0.3 → 1.2 while fading.
5. "Exact pin unlocked" chip slides down 20 px and fades in at 1700 ms.

## 7. Text

Headlines fade in from the right, word by word, stagger **80 ms**, 24 px travel, `easeOut`. Body text simply fades (300 ms).

## 8. Accessibility and performance (required)

- Respect **Reduce Motion** (`AccessibilityInfo.isReduceMotionEnabled` / `useReducedMotion`). When on: no overshoot, no squash, no idle loops, no hearts; elements fade in over 200 ms, and swipes still move but without rotation.
- Every animation runs on the UI thread (Reanimated worklets). No `setState` per frame.
- Never block input while an animation runs; a second tap cancels and completes the previous animation.
- Haptics: light impact on like/pass commit, success notification on booking confirmed (skip when the user has haptics off).

## 9. Keeping social and app in sync

- The illustrations in `assets/illustrations/` are the **same files** used in the posts. Change them once; regenerate both.
- The motion film for social (16:9, 4:5, 9:16) uses these exact timings. If a timing changes, update `design/tokens.json` first, then the app and the film.
