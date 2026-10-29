# CLAUDE.md: instructions for Claude Code

You are building **PawsPal Dahab**, a pet-sitting and pet-swapping app for Dahab, Egypt. Read `HANDOVER.md` first, then the doc for the area you are working on.

## Map of the repo
- `HANDOVER.md`: what to build (v2). `docs/build-plan.md`: phases and acceptance checks.
- `docs/design-system.md`, `docs/motion.md`, `design/tokens.json`: look and motion (shared with social media).
- `docs/security.md`: threat model and non-negotiable rules. `docs/legal/`: legal texts shown in the app.
- `apps/mobile`: Expo app. `apps/admin`: admin web app (phase 8). `supabase/`: migrations, tests, edge functions.
- `assets/`: logo, illustrations (shared with the posts), original mockups.

## Commands
- App: `cd apps/mobile && npm start` | `npm run typecheck` | `npm run lint` | `npm test`
- Shared files: `node scripts/sync-shared.mjs` (runs before every start)
- Database: `supabase db reset` (local), `bash scripts/test-db.sh` (security tests on plain Postgres, also what CI runs), `bash scripts/test-db-supabase.sh` (the same tests on the real local Supabase; run it whenever you change a migration)
- Slash commands: `/phase N`, `/security-review`, `/design-check`, `/new-migration <name>`

## Rules you must follow
1. **Security first.** Follow `docs/security.md`. The server enforces every rule. Never trust client values for status, price, fee, role or verification. Never read `private.*` from the app. Never put service-role or payment secrets in the app or in Git.
2. **New tables:** enable RLS and write policies in the same migration, and add tests to `supabase/tests/security_test.sql`. Never edit a migration that has been pushed; add a new numbered one.
3. **Design:** colours, fonts, radii and spacing come only from the theme (`useTheme()`). No hex values in screens. Trust screens use `useTheme(true)` (navy).
4. **Motion:** use `src/motion` helpers and the timings in `docs/motion.md`. Respect Reduce Motion. Animations run on the UI thread.
5. **Shared assets:** illustrations and legal text are generated from `assets/` and `docs/legal/`. Never edit `src/illustrations/index.ts`, `src/legal/index.ts` or `src/theme/tokens.json` by hand.
6. **Language:** every user-facing string goes through `t()` with English and Arabic entries. Use `start`/`end`, not `left`/`right`, for layout that must mirror.
7. **Accessibility:** 44 pt touch targets, labels on icon buttons, AA contrast (tokens are pre-checked).
8. **Copy:** warm, short and plain, as in the posts. No exclamation marks except "Booking confirmed".
9. **Privacy:** collect only what HANDOVER lists. Never log message text, codes, ID data or exact locations.
10. Before saying a phase is done: run typecheck, lint, tests and the DB security tests, and check the phase's acceptance list. Then follow "How work ships" below.

## When unsure
Check HANDOVER section 13 (open decisions). If something is still open, build the safest reasonable default behind a clearly named setting and note it in your summary. Do not invent legal terms, fees or provider names.

## How work ships (the founder does not review or test anything)
The automated checks are the only gate, so they stay strict. Everything that passes goes live on its own.
- **Work directly on `main`.** No pull requests.
- **After each task or phase run all four:** `npm run typecheck`, `npm run lint`, `npm test` (in `apps/mobile`) and `bash scripts/test-db.sh`. With a new migration, also run `python3 scripts/check-migrations.py origin/main`. With a changed dependency, also run `node ../../scripts/audit-gate.mjs` in `apps/mobile`.
- **All pass: commit and `git push origin main`.** The `ci` workflow repeats the checks. When it passes, `deploy` publishes the app (over-the-air update, or a store build if native code changed) and moves the `production` branch, which the Supabase GitHub integration deploys to the live database.
- **Anything fails: fix the cause first.** Never push failing code. Never skip, delete, loosen or comment out a test, lint rule or type check to get green. If the checks cannot run or cannot pass, do not push; tell the founder what is blocking.
- **Destructive migrations** (`DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA`, `TRUNCATE`, `DELETE` without `WHERE`) fail the check unless the file contains `-- destructive-approved`. Add that comment **only when the founder explicitly says so in chat**, for that migration. Once a migration has been pushed to `main`, never edit it; the check also fails on edits. The only exception is a line in `supabase/approved-migration-edits.txt` (file name plus the SHA-256 of its exact approved contents), added **only when the founder explicitly says so in chat**.
- **No secrets in Git, and no secret-based database deploys.** Database deploys use the Supabase GitHub integration. Steps that need a secret (Expo) skip themselves with a note until the secret exists.
- Force-push and branch deletion stay forbidden (`.claude/settings.json`). Still ask first before anything that costs money, deletes data, or changes a legal text, fee or provider.
- **Dependency audit:** a HIGH or CRITICAL advisory in a package that ships in the app always fails. Build-tool-only advisories pass only if listed in `apps/mobile/audit-allowlist.json` with a reason and an expiry. Add or renew entries **only when the founder says so in chat**; fix the dependency instead whenever a fix exists.
- **Dependency updates are automatic.** Dependabot opens PRs and `dependabot-automerge` merges the ones that pass CI, with no review. Dependabot ignores every package Expo manages (`expo`, `expo-*`, `react`, `react-dom`, `react-native`, `react-native-*` native modules, `jest-expo`, `eslint-config-expo`) and TypeScript, ESLint and Jest major versions. Those move only with `npx expo install --fix` and a full run of the checks. When Dependabot's ignore list needs a new package, edit `.github/dependabot.yml`.
- **Admin site (`apps/admin`):** Next.js on Vercel (root directory `apps/admin`, production branch `production`). Its logo and colours are generated by `scripts/sync-shared.mjs`; never edit `apps/admin/src/tokens.json` or `apps/admin/public/pawspal-logo.svg` by hand. CI builds it, typechecks it and runs its smoke test; Vercel deploys from `production`, which `deploy` moves only after CI passes.
