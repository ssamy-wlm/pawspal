# Admin dashboard (phase 8)

Next.js web app using the same Supabase project. Built in phase 8 of `docs/build-plan.md`; design from mockups 18 and 19 (navy sidebar).

**Today it is a placeholder**: one page with the PawsPal logo and "Admin dashboard coming soon", on the navy background. It shows no data and has no sign-in.

- Deployed by Vercel: root directory `apps/admin`, production branch `production` (see `SETUP.md`, section E3).
- `npm run build`, `npm run typecheck` and `npm test` (a smoke test of the built page) run in CI.
- The logo and colours are copied in by `node scripts/sync-shared.mjs`. Do not edit `src/tokens.json` or `public/pawspal-logo.svg` by hand.

Phase 8 plan:
- Sign-in: phone OTP, and the user must be in `public.admins`. Hide everything otherwise.
- All writes go through `admin_take_action()`, which records the audit log. No direct table writes.
- Pages: Overview, Reports, Users (case page), Approvals, Bookings, Photo review, Rules, Audit log.
