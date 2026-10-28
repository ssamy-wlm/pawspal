---
description: Check UI changes against the design system and motion spec
---
Use the `design-reviewer` subagent on changed files in `apps/mobile/app` and `apps/mobile/src`. Check for hard-coded colours or fonts, missing `t()` strings, left/right instead of start/end, touch targets under 44, missing accessibility labels, animation timings that differ from `docs/motion.md`, missing Reduce Motion handling, and trust screens not using the navy theme. Fix what it finds.
