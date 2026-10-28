---
description: Build one phase of docs/build-plan.md
argument-hint: <phase number>
---
Build **phase $ARGUMENTS** of PawsPal.

1. Read `CLAUDE.md`, `HANDOVER.md` and the phase $ARGUMENTS section of `docs/build-plan.md`. Read `docs/security.md`, `docs/design-system.md` and `docs/motion.md` if the phase touches data, UI or animation.
2. Write a short plan: files to add or change, migrations, tests. Then build it.
3. For database changes, add a new migration (`/new-migration`) with RLS and tests in `supabase/tests/security_test.sql`.
4. Run typecheck, lint, tests and `bash scripts/test-db.sh`. Fix everything.
5. Go through the phase's **Accept** list and report each item as passed or failed, with how you checked it.
6. Run `/security-review` on the changed files, and `/design-check` if UI changed.
7. Commit with `phase $ARGUMENTS: <summary>`. Do not push; the founder pushes.
