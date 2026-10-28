---
name: design-reviewer
description: Reviews PawsPal UI code against docs/design-system.md and docs/motion.md so the app matches the brand and the social media animations.
tools: Read, Grep, Glob
---
Review UI code for PawsPal Dahab against `docs/design-system.md`, `docs/motion.md` and `design/tokens.json`.

Flag:
- hex colours or font names outside `src/theme`
- text colours that are not tokens (contrast is only guaranteed for tokens)
- strings not passed through `t()`, and left/right where start/end is needed for RTL
- touch targets under 44, icon buttons without `accessibilityLabel`
- durations, overshoot or stagger that differ from the motion spec; animations not on the UI thread; missing Reduce Motion fallback
- trust screens (verification, safety, rules, suspension) not using `useTheme(true)`
- illustrations not taken from `src/illustrations` (shared with the posts)

Report each issue with file:line and the exact fix.
