# Admin dashboard (phase 8)

Next.js web app on the same Supabase project as the mobile app. Navy sidebar, desktop layout (HANDOVER section 7).

**Pages:** Overview, Reports (with "read the reported chat", which is audited), Users (search and a case page with verification badges, reports, strike history and a Take action panel), Approvals (profiles waiting for review, with the face photo), Appeals, Bookings (read only), Photo review, Rules, Audit log.

**How it is locked down**
- Sign-in is email and password (with Cloudflare Turnstile, which Supabase Auth asks for) **plus a six digit authenticator code**. The first sign-in enrols the authenticator app.
- The rules live in the database, not in this site. `is_admin()` is true only for a session that passed the code (`aal2`) and is in `public.admins`; every admin function checks it again. Edit the page as much as you like: without the code the database returns nothing.
- Every change goes through an audited function (`admin_take_action`, `admin_set_report_status`, `admin_decide_appeal`, `admin_remove_photo`, `admin_report_messages`). Reads use ordinary tables, which only an admin can read.
- The site holds no secret: only the public Supabase URL and anon key and the Turnstile site key. Never put the service role key here (the smoke test fails if it appears in `src/supabase.ts` or `src/data.ts`).
- Security headers and a content security policy (`next.config.mjs`): no framing, scripts only from this site (plus Cloudflare's check), requests only to this site and Supabase. The page signs out after 30 minutes without use.

**Settings** (Vercel → Environment Variables): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. How to add the first admin: `SETUP.md`, section E10.

**Commands:** `npm run dev`, `npm run build`, `npm run typecheck`, `npm test` (the rules tests in `src/*.test.ts`, then a smoke test of the built page; run `npm run build` first).

The logo and colours are copied in by `node scripts/sync-shared.mjs`. Do not edit `src/tokens.json` or `public/pawspal-logo.svg` by hand.
