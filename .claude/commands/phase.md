---
description: Build one phase from docs/build-plan.md, check it strictly, and ship it to main
argument-hint: <phase number>
---

Build **phase $ARGUMENTS** from `docs/build-plan.md`. Read `HANDOVER.md` and the docs for the area first.

## How a phase ships (the founder does not review or test anything)

The automated checks are the only gate. Work directly on `main`.

1. Build the phase. Commit in small steps while you work; do not push yet.
2. Run all four checks, from a clean state:
   - `cd apps/mobile && npm run typecheck`
   - `cd apps/mobile && npm run lint`
   - `cd apps/mobile && npm test`
   - `bash scripts/test-db.sh` (this also fails on any unexpected result in the security tests)
   - and, if you added a migration: `python3 scripts/check-migrations.py origin/main`
3. If anything fails, fix the cause and run everything again. Never push failing code. Never skip, delete, loosen or comment out a test or lint rule to get green. Never add `-- destructive-approved` to a migration unless the founder said so in chat.
4. Check every line of the phase's **Accept** list. New tables need RLS and tests in `supabase/tests/security_test.sql`.
5. When everything passes: `git push origin main`. The `ci` workflow repeats the checks and `deploy` then ships the database and the app automatically.
6. Finish with a short plain-language summary for the founder: what now works, what you decided on your own, anything left open, and anything that was skipped. If the checks cannot all pass, say so, do not push, and explain what is blocking.
