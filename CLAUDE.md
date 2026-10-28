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
- Database: `supabase db reset` (local), `bash scripts/test-db.sh` (security tests)
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
10. Before saying a phase is done: run typecheck, lint, tests and the DB security tests, and check the phase's acceptance list.

## When unsure
Check HANDOVER section 13 (open decisions). If something is still open, build the safest reasonable default behind a clearly named setting and note it in your summary. Do not invent legal terms, fees or provider names.
