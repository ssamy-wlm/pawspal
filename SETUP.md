# Setup: from this folder to a running app

Written for a non-developer. Do the steps in order. Anything in `code style` is something you type or copy. Budget an afternoon for parts A to D.

## A. Put the project on GitHub (private)

1. Create a free account at **github.com**, if you don't have one.
2. Click **+ → New repository**. Name it `pawspal-dahab`, choose **Private**, and leave "Add a README" **unticked**. Click **Create repository**.
3. Upload the files. The GitHub website uploader **skips hidden folders** (`.claude`, `.github`, `.gitignore`) and takes **at most 100 files at a time**, so it can leave parts of the project behind. Use one of these:
   - **Option 1, easiest:** upload the single file `pawspal-dahab.zip` to the repository (drag it onto *Add file → Upload files*), then ask Claude Code: "Unzip pawspal-dahab.zip into the repo root, merge with what's there, delete the zip, and tell me what changed."
   - **Option 2:** use **GitHub Desktop** (desktop.github.com). Clone the repository, copy everything inside the unzipped `pawspal-dahab` folder into it, including hidden items (Mac: `Cmd + Shift + .`; Windows: *View → Hidden items*), then **Commit** and **Push**.
4. Turn on protection in **Settings → Code security**:
   - **Dependabot alerts** and **Dependabot security updates**: on
   - **Secret scanning** and **Push protection**: on
5. Don't add a "require a pull request" rule: Claude Code pushes straight to `main` once the automatic checks pass (see CLAUDE.md).

## B. Accounts you will need

| Service | What for | When |
|---|---|---|
| **Claude** (Pro or Max) | Claude Code builds the app | Now |
| **Supabase** (supabase.com) | Database, sign-in, photos | Now |
| **Expo** (expo.dev) | Running and building the app | Now |
| **Twilio** (twilio.com) | SMS codes | Phase 2 |
| **KYC provider** (to choose) | ID and selfie checks | Phase 2 |
| **Google Cloud** | Maps | Phase 4–6 |
| **Paymob** or **Fawry** | Booking fee | Phase 6 |
| **Apple Developer** ($99/yr) and **Google Play** ($25) | Store release | Phase 9 |

## C. Install the tools (one time)

1. **Node.js LTS** from nodejs.org.
2. **Claude Code**: follow the instructions at docs.claude.com (Claude Code → Quickstart). Then open a terminal in your project folder and run `claude`.
3. **Supabase CLI**: follow supabase.com/docs (CLI → Getting started). Also install **Docker Desktop**, which the CLI needs for a local database, and the Postgres command-line client `psql`, which `scripts/test-db.sh` uses.
   If you use **Claude Code on the web**, it runs in its own cloud computer, so you don't need to install these yourself.
4. **Expo Go** on your phone (App Store or Google Play) to preview the app.

## D. Create the Supabase project

1. On supabase.com: **New project**, name it `pawspal-dahab`, set a strong database password (save it in a password manager), and pick a region. **Ask your lawyer first** whether data may be stored outside Egypt (see `docs/legal/README.md`). If you must start before the answer, use a development project with test data only.
2. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.
3. Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and paste both values in. This file is never uploaded (it's in `.gitignore`).
4. **Never** copy the `service_role` key into the app, a chat or GitHub. It goes only into Supabase Edge Function secrets (phase 2 and later).
5. In **Authentication → Providers**: turn **Phone** on. Twilio details come in phase 2. Phase 8 turns **Email** on too (see E10): it is only for the admin dashboard, and the database refuses any email sign-up that was not invited.

## E. Start building with Claude Code

In a terminal, in the project folder:

```
claude
```

Then type:

```
/phase 0
```

Claude Code reads `CLAUDE.md` and `HANDOVER.md`, sets up the app and database, runs the tests and reports what passed. Check the result on your phone: run `cd apps/mobile && npm start`, scan the QR code with Expo Go, and you should see the animated welcome screen. Then continue with `/phase 1`, `/phase 2` and so on, one at a time. After each phase, read the summary Claude Code gives you.

Claude Code pushes to `main` on its own once all the automatic checks pass (see CLAUDE.md). You do not review or test anything. The checks are the only gate, so they are strict.

## E2. Automatic deploys (no database secrets)

Database deploys use the **Supabase GitHub integration**, so no Supabase token or password is stored in GitHub.

1. In your Supabase project: **Project Settings, Integrations, GitHub**, connect the `pawspal-dahab` repository.
2. Set the **working directory** to `.` (the folder that holds `supabase/`), turn on **Deploy to production**, and set the **production branch** to `production`.
3. Why `production` and not `main`: the `deploy` workflow moves the `production` branch to a commit **only after the `ci` checks pass on it**. If the integration watched `main` directly, a migration would reach the live database before the checks finished. If you point it at `main` instead, that safety is lost.
4. Turn on **Daily backups** and **Point in time recovery** (paid Pro plan): **Database, Backups**.

The mobile app update step needs one GitHub secret, **`EXPO_TOKEN`** (expo.dev, avatar, Account settings, Access tokens, Create token), added at GitHub **Settings, Secrets and variables, Actions, New repository secret**. Until it exists, the step is skipped and the run summary says so. After creating your Expo account, link the project once: `cd apps/mobile && npx eas-cli init && npx eas-cli update:configure`, and commit the changed `app.json`. The first store build needs your Apple and Google accounts: run `npx eas-cli build --platform all --profile production` once yourself; after that `deploy` does it automatically when native code changes.

## E3. Admin site on Vercel

The admin dashboard (`apps/admin`, built in phase 8; for now a one-page placeholder) is deployed by Vercel.

1. In Vercel, import the `pawspal-dahab` GitHub repository as a project.
2. **Settings, General, Root Directory:** `apps/admin`. Framework: Next.js. Node.js: 22.x.
3. **Settings, Environments, Production, Branch Tracking:** set the production branch to **`production`** (not `main`). The `deploy` workflow moves `production` to a commit only after `ci` passes, so Vercel never publishes a commit that failed the checks.
4. Every other branch gets a preview deployment. Previews are protected by Vercel sign-in.

## E4. Dependency updates (automatic)

Dependabot opens update PRs every week. The `dependabot-automerge` workflow merges each one that passes CI, so you do nothing. Packages that Expo manages are never offered, because they must move together (`npx expo install --fix`). Updates to GitHub Actions files are the one exception: GitHub does not let the built-in token merge changes to `.github/workflows`, so those PRs wait for Claude Code to merge them.

## E5. Phone sign-up (phase 2)

Sign-up works today with **Supabase test phone numbers**, so no SMS company is needed yet. Nothing is sent; the code is fixed.

1. Supabase dashboard → Authentication → Providers → Phone: turn **Phone** on, and add test numbers under **Test Phone Numbers** (Egyptian numbers only, for example `201000000001=123456`). Local development already has four in `supabase/config.toml`.
2. When you choose a real provider (an Egyptian SMS company, WhatsApp, or Twilio later), tell Claude Code which one. It is added as one small file. Then in Supabase: Authentication → Hooks → **Send SMS** → choose HTTPS, enter the URL of the `send-sms` function, copy the secret it shows into the `SEND_SMS_HOOK_SECRET` secret, and set `SMS_PROVIDERS` and the provider's own keys. The hook is the only place the code is sent from.
3. ID and selfie checks use the setting `IDENTITY_PROVIDER`. Leave it empty on the live project until you choose a provider; the app then says "not available yet" and nobody can pass the check. For testing set `IDENTITY_PROVIDER=fake` (and, on a live project, also `ALLOW_FAKE_IDENTITY=true`). Never leave `fake` on once real people use the app.

4. **SMS code expiry, 300 seconds (do this once on the live project).** Supabase dashboard → your PawsPal project → **Authentication** → **Sign In / Providers** → **Phone** → set **SMS OTP Expiry** to `300` → **Save**. (I could not do this for you: the only Supabase project my tools can see is a different one, so I did not touch it.)
5. **Test phone numbers must be empty on the live project.** Same page (Authentication → Sign In / Providers → Phone): the **Test Phone Numbers and OTPs** list must have nothing in it. Three things protect you even if someone adds one by mistake: (a) test numbers are not in `supabase/config.toml` at all, only in `supabase/local/local-only.toml`, and CI (`scripts/check-config.py`) fails if they ever appear in `config.toml`; (b) the database refuses to create an account for a test-shaped number (`+20 10 0000 00xx` style) unless a developer's own local database has switched them on, which the live one never does (migration 0004); (c) local tests run through `scripts/local-supabase.sh`, which adds the test numbers only while the local stack starts.
6. **CAPTCHA (Cloudflare Turnstile, free).** Cloudflare dashboard → **Turnstile** → **Add widget**: name `PawsPal`, hostname `pawspal.vercel.app` (or whichever address you set in `EXPO_PUBLIC_TURNSTILE_ORIGIN`), mode **Managed** → create, then copy the **Site Key** (public) and **Secret Key** (private). Then:
   - Supabase → **Authentication** → **Attack Protection** → turn on **Enable CAPTCHA protection** → provider **Turnstile** → paste the Secret Key → Save. From then on Supabase itself refuses code requests without a valid token, even if someone skips our app.
   - Supabase → **Edge Functions** → **Secrets**: add `CAPTCHA_PROVIDER` = `turnstile` and `CAPTCHA_SECRET` = the same Secret Key (used after two wrong codes).
   - The app: set `EXPO_PUBLIC_TURNSTILE_SITE_KEY` to the Site Key (and `EXPO_PUBLIC_TURNSTILE_ORIGIN` if you did not use `pawspal.vercel.app`) wherever the app's public settings live (`apps/mobile/.env.local`, and as EAS environment variables for builds). Without a site key the app asks for no CAPTCHA, so do this together with turning Supabase's CAPTCHA on, or sign-up stops working. This adds a native module, so the next release is a store build, not only an over-the-air update.
7. Attestation (App Check, Play Integrity, App Attest) is still worth adding before a big launch; the CAPTCHA and the per-number limits already stop the cheap abuse.

Running the local stack: `bash scripts/local-supabase.sh start` (never plain `supabase start`, which would have no test numbers), and `bash scripts/test-db-supabase.sh` to run the security tests against it.

The full list of settings is in `supabase/functions/README.md`.

## E6. Photo clean-up (every night)

Photos that were uploaded but never saved (a pet photo you added and then left the screen, a sign-up photo that was never used) are removed by a small function, `cleanup-photos`, that runs once a night.

1. Supabase → **Edge Functions** → **Secrets**: add `CLEANUP_SECRET` with a long random value (at least 24 characters; a password generator is fine).
2. Supabase → **Integrations** → **Cron** (turn the Cron integration on if it asks) → **Create job**: name `cleanup-photos`, schedule `0 3 * * *` (3 am every day), type **Supabase Edge Function**, choose `cleanup-photos`, method `POST`, and add the header `x-cleanup-secret` with the same value as `CLEANUP_SECRET`.
3. Nothing else. A raw upload still in `incoming` after an hour, and a clean photo that no pet or profile uses after a day, are deleted. It never touches a photo that a pet or profile points to, and it only looks in the four photo folders. If the secret is not set, the function refuses to run.

## E8. Payments (Paymob, test mode first)

The booking fee is paid through Paymob. It works in **test mode** with a Paymob test account, so nobody is charged for real until you switch to live keys. Until these settings exist, the app says "Payment is not available yet" and nothing can be paid.

1. **Account.** Sign up at Paymob (Egypt) and open the dashboard. In the dashboard find **Developers → Getting Integration Credentials**. You need five things: the **Secret key** and **Public key** (test ones start `egy_sk_test_` and `egy_pk_test_`), the **Integration ID** of a test card integration (and a wallet one if you want wallets), and the **HMAC secret**.
2. **Settings.** Supabase → **Edge Functions** → **Secrets**, add:
   - `PAYMENT_PROVIDER` = `paymob`
   - `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET`
   - `PAYMOB_INTEGRATION_IDS` = the integration id(s), separated by commas
   - `PAYMOB_NOTIFICATION_URL` = `https://<your project ref>.supabase.co/functions/v1/paymob-webhook`
3. **Tell Paymob where to report.** In the Paymob dashboard, set the **Transaction processed callback** to that same address. Every payment result reaches the app only this way, and a callback without a valid signature is refused.
4. **Try it.** Make a booking with two test accounts, accept the terms on both, tap **Pay the booking fee**, and pay with one of Paymob's test cards (listed in their **Test credentials** page). The chat should jump to **Booking confirmed** by itself.
5. **Going live later.** Replace the three keys and the integration id(s) with the live ones. Nothing else changes.

**The fee.** It is **75 EGP**. To change it: Supabase → **Table Editor** → `app_settings` → the row `booking_fee_egp` → change `value` and save (whole pounds, 1 to 10000). The refund charge kept when an owner cancels early (Terms of Service section 6, "[X] EGP") is the row `refund_processing_charge_egp`; it is 0 until your lawyer confirms the number.

**Refunds.** When a booking is cancelled the database works out what comes back (Terms of Service section 6): the other person cancels, everything; the owner cancels more than 48 hours before the start, the fee minus the charge; within 48 hours, nothing. Refunds wait as "refund due" and are sent by the `process-refunds` function. Add a Supabase secret `REFUND_SECRET` (24+ random characters) and a **Cron** job (Integrations → Cron) that calls the `process-refunds` function every hour with the header `x-refund-secret`. No-shows and removals are decided by a person in the admin app (phase 8).

**Things I could not check without a Paymob account** (please confirm when you open it): the exact refund request Paymob expects (a refund that Paymob does not confirm stays "refund due" and is tried again, then waits for a person), whether Paymob insists on a real phone number on each checkout (we send a placeholder so we do not pass phone numbers on), and that the callback arrives with the fields listed in their documentation. Who pays the fee: **the person who sent the request** (the owner, or whoever proposed a swap), one fee per booking.

## E7. Chat

Chat is live (Supabase Realtime). Nothing to set up: new messages and booking changes reach both people at once. Phone numbers, emails, links and app names in messages are hidden until the two people have a confirmed, paid booking together.

## E9. Handover photos, reviews and the Safety Center (phase 7)
Nothing to set up: no new accounts or secrets. What to know:
- **Handover photos** are taken with the phone camera, cleaned by `process-upload` (no GPS or hidden data) and saved in the private `handovers` bucket. A person only ever sees the other side's photo through a link that works for 60 seconds (`handover-photo-url`). Photos that were taken but never saved are removed by the nightly clean-up (E6) after a day.
- **Emergency** alerts the other person inside the app (a red banner at the top of the Chat tab) and opens a **high-priority report** for the team (`reports.priority = 'high'`, `emergency = true`). It does **not** send a text message or a push notification yet: those need the SMS provider (E5) and the notifications work in phase 9. The emergency screen shows the vet's number first so the person can call straight away.
- **Reviews** are possible only after the owner marks the stay finished, once per person, for 14 days. Phone numbers and links in a review are hidden.
- **Reports** reach the admin dashboard (phase 8). Until it exists, you can read them in the Supabase table editor (`reports`, newest high-priority first).

## E10. Admin dashboard (phase 8)

The dashboard is the website in `apps/admin` (Vercel). Admin power needs **three things at once**: a password, a six digit code from an authenticator app, and a place in the admins list. The database checks the code on every request, so a stolen password alone opens nothing.

**One-time settings**
1. Supabase → **Authentication → Providers → Email**: switch it **on**. It is only for admins: the database refuses every email sign-up that was not invited first, and people still join with their phone only.
2. Same area: make sure **Multi-Factor (authenticator app / TOTP)** is enabled (it is by default).
3. Vercel → your admin project → **Settings → Environment Variables** (all environments): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the same public values as the app) and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (the same Cloudflare Turnstile site key as the app; add the admin site's address to that widget's allowed hostnames in Cloudflare). Supabase asks for the Turnstile check on every sign-in, so without the key the sign-in button stays off.

**Make yourself the first admin** (Supabase → **SQL Editor**; only you, as project owner, can do this):
1. Run `select private.invite_admin('you@example.com');` (your real email).
2. **Authentication → Users → Add user → Create new user.** Same email, a long password from your password manager, and tick **Auto Confirm User**.
3. Run `select private.grant_admin('you@example.com');`. It must answer `granted`. (`no_user`: step 2 was not done. `no_invite`: step 1 was not done. `not_confirmed`: tick Auto Confirm.)
4. Open the admin site, sign in with the email and password. The first time it shows a QR code: scan it with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password) and type the six digit code. Keep the app safe: that code is your second key.

**Lost your phone?** In the SQL Editor run `delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'you@example.com');`, then sign in again and scan a new QR code.

**Adding or removing an admin:** repeat the three steps for a new person. To remove one: `select private.revoke_admin('their@email.com');` (it takes effect at once, even for a page they have open). Keep the list short: admins can read reports, photos and reported chats (every chat read is written to the audit log).

**What admins can and cannot do:** every change goes through an audited database function (warn, suspend 3 or 7 days or until fixed, remove, reinstate, approve, decide appeals, resolve reports, remove a photo). Nobody can edit or delete the audit log, an admin cannot act on an admin (or on themselves), and a removed person's phone, ID and device are blocked. Fixed-length suspensions end by themselves (a job runs every 15 minutes; check with `select * from cron.job;`, it should list `lift-expired-suspensions`). The admin site signs itself out after 30 minutes without use.

## F. Secrets checklist

| Secret | Where it lives | Never |
|---|---|---|
| Supabase URL and anon key | `apps/mobile/.env.local` (public values) | n/a |
| Supabase service_role key | Supabase → Edge Functions → Secrets | In the app or Git |
| SMS / WhatsApp provider key (whichever company you choose) | Supabase → Edge Functions → Secrets | In the app or Git |
| Photo clean-up secret (`CLEANUP_SECRET`) | Supabase → Edge Functions → Secrets, and the Cron job header | In the app or Git |
| Paymob keys and HMAC secret | Supabase → Edge Functions → Secrets | In the app or Git |
| Refund job secret (`REFUND_SECRET`) | Supabase → Edge Functions → Secrets, and the Cron job header | In the app or Git |
| Send SMS hook secret | Supabase → Edge Functions → Secrets (`SEND_SMS_HOOK_SECRET`) | In the app or Git |
| Paymob API key and HMAC secret | Supabase Edge Function secrets | In the app or Git |
| KYC API key | Supabase Edge Function secrets | In the app or Git |
| Google Maps keys | App config, **restricted** to your app IDs | Unrestricted |

If a secret ever leaks: rotate it straight away in the provider's dashboard, then tell Claude Code to update the secret.

## G. Before launch

Work through `docs/security.md` (checklist), `docs/legal/README.md` (lawyer questions) and phase 9 of `docs/build-plan.md`.
