# Admin dashboard (phase 8)

Next.js web app on the same Supabase project as the mobile app. Navy sidebar, desktop layout (HANDOVER section 7).

**Pages:** Overview (with verification, payment, renewal and paused counts), Verification (selfie and ID photo side by side, adult check, approve or reject; the ID file is deleted the moment you decide), Payments (confirm or reject payment claims, screenshot deleted on decision, recently decided list), Reports (with "read the reported chat", which is audited), Users (search, membership filter and a case page with verification badges, paid-until, payment and verification history, reports, strike history and a Take action panel), Appeals, Bookings (read only), Photo review, Settings (fees, InstaPay and Vodafone Cash details, saved one field at a time), Rules, Audit log.

**How it is locked down**
- Sign-in is email and password (with Cloudflare Turnstile, which Supabase Auth asks for) **plus a passkey** (Face ID, a fingerprint or Windows Hello). The first sign-in creates the passkey with a one-time setup code and shows 10 single-use recovery codes. This replaces the old authenticator-app code screen (TOTP and the `aal2` check are gone). The passkey steps run through the Supabase Edge Function `admin-passkey` (`src/passkey-api.ts`, with `@simplewebauthn/browser`); the **Security** page lists, adds, renames and removes passkeys and makes new recovery codes.
- The rules live in the database, not in this site. `admin_status()` answers `not_admin`, `needs_setup`, `needs_passkey` or `admin`; `is_admin()` is true only for a session that passed the passkey step (or a recovery code) and is in `public.admins`, and every admin function checks it again. Edit the page as much as you like: without the passkey step the database returns nothing. An answer the page does not know (or a failed call) goes back to the sign-in, never to the dashboard.
- Every change goes through an audited function (`admin_take_action`, `admin_set_report_status`, `admin_decide_appeal`, `admin_remove_photo`, `admin_report_messages`, `admin_decide_verification`, `admin_confirm_payment`, `admin_set_setting`). Reads use ordinary tables, which only an admin can read.
- The site holds no secret: only the public Supabase URL and anon key and the Turnstile site key. Never put the service role key here (the smoke test fails if it appears in `src/supabase.ts` or `src/data.ts`).
- Security headers and a content security policy (`next.config.mjs`): no framing, scripts only from this site (plus Cloudflare's check), requests only to this site and Supabase. The page signs out after 30 minutes without use (it also ends the passkey session on the function). WebAuthn needs no extra policy entry; the function is called on the Supabase origin that `connect-src` already allows.
- Buttons: brand orange with navy text, outlined navy for quiet ones, red only for destructive ones. They all come from `src/ui.tsx` (`Btn`, `Toggle`), and a test checks that every pair passes AA contrast.

**Settings** (Vercel → Environment Variables): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. The function's own settings (`ADMIN_RP_ID`, `ADMIN_ORIGIN`, `ADMIN_RP_NAME`) are Supabase function secrets. A passkey belongs to the site address, so a new address needs new passkeys. How to add the first admin, a second device and what to do when devices are lost: `SETUP.md`, section E10.

**Commands:** `npm run dev`, `npm run build`, `npm run typecheck`, `npm test` (the rules, passkey and button tests in `src/*.test.ts`, then a smoke test of the built page; run `npm run build` first).

**Manual browser check** (not in CI): `NODE_PATH=$(npm root -g) node scripts/passkey-browser-check.mjs`. It builds the site against a small stand-in for Supabase that uses the real `@simplewebauthn/server` (a dev dependency used only by this script), and walks setup, recovery codes, sign out, passkey sign-in and recovery-code sign-in in Chromium with a virtual authenticator.

The logo and colours are copied in by `node scripts/sync-shared.mjs`. Do not edit `src/tokens.json` or `public/pawspal-logo.svg` by hand.
