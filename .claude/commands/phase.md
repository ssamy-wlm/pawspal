---
description: Build one phase of docs/build-plan.md
argument-hint: <phase number>
---
Build **phase $ARGUMENTS** of PawsPal.

1. Read `CLAUDE.md`, `HANDOVER.md` and the phase $ARGUMENTS section of `docs/build-plan.md`. Read `docs/security.md`, `docs/design-system.md` and `docs/motion.md` if the phase touches data, UI or animation.
2. Write a short plan: files to add or change, migrations, tests. Then build it.
3. For database changes, add a new migration (`/new-migration`) with RLS and tests in `supabase/tests/security_test.sql`.
4. Run typecheck, lint, tests and `bash scripts/test-db.sh` (and `python3 scripts/check-migrations.py origin/main` if you added a migration). Fix everything. Never skip, weaken or delete a test, lint rule or check to get green.
5. Go through the phase's **Accept** list and report each item as passed or failed, with how you checked it.
6. Run `/security-review` on the changed files, and `/design-check` if UI changed.
7. Commit with `phase $ARGUMENTS: <summary>`.
8. Only if every check passed and the Accept list is met: `git push origin main` (see "How work ships" in CLAUDE.md). The founder reviews nothing, so the checks are the only gate. If anything fails or cannot run, do not push; say what blocks you.
9. Finish with a plain-language summary: what works, what you decided yourself, what is still open, what was skipped.
