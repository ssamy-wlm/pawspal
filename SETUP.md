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
| **A domain name** (any registrar) | Sending email from your own address | Now |
| **Resend** (resend.com) | Sign-up, password-reset and reminder emails (see E5) | Now |
| **MapTiler** (maptiler.com), optional | Map tiles once many people use the map (see E12) | Before launch |
| **InstaPay and your bank** | Where people pay you the membership (nothing to install) | Now |
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
5. In **Authentication → Providers**: turn **Email** on and keep **Confirm email** on. PawsPal people join with an email and password (see E5). Leave **Phone** off.

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

## E3b. Put the app on the web (PWA)

The same app also runs in a browser, and people can add it to their home screen from there (Add to Home Screen). It is a second Vercel project, separate from the admin site. The code and settings are already in the repo (`apps/mobile/vercel.json`); you only click through the steps below.

**1. Create the Vercel project**
1. In Vercel, click **Add New, Project** and import the `pawspal-dahab` GitHub repository again.
2. **Project Name:** `pawspal-app`.
3. **Root Directory:** click **Edit**, choose `apps/mobile`, **Continue**. Leave **Framework Preset** as "Other". Vercel reads the build settings from `vercel.json` (build command `npx expo export -p web`, output folder `dist`). Node.js: 22.x.
4. Before you press Deploy, open **Environment Variables** and add these (names exactly as written; they are public settings, none is secret):
   - `EXPO_PUBLIC_SUPABASE_URL`: your Supabase project URL (Supabase, Project Settings, API).
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`: the **public** (anon / publishable) key from the same page. Never the service-role key.
   - `EXPO_PUBLIC_MAP_TILE_URL`: optional. Leave it out to use OpenStreetMap (see E12).
   - `EXPO_PUBLIC_MAP_ATTRIBUTION`: optional, the credit text your map provider asks for.
5. Click **Deploy**. When it finishes, open the address Vercel shows and check the welcome screen appears.
6. **Settings, Environments, Production, Branch Tracking:** set the production branch to **`production`**, like the admin site. The `deploy` workflow moves that branch only after the checks pass, so nothing else is needed in GitHub.

**2. Your own address (custom domain)**
1. **Settings, Domains, Add**, type your domain (for example `app.pawspal.example`), **Add**.
2. Vercel shows one DNS record. Add it where you bought the domain, wait a few minutes, and Vercel shows a green tick. HTTPS is automatic. (The camera and the install button only work on https.)

**3. Tell Supabase about the web address**
In Supabase: **Authentication, URL Configuration**.
1. **Site URL:** `https://YOUR-WEB-DOMAIN` (for example `https://app.pawspal.example`).
2. Under **Redirect URLs** click **Add URL** for each of these, then **Save**:
   - `https://YOUR-WEB-DOMAIN/auth/callback` (the sign-up confirmation link)
   - `https://YOUR-WEB-DOMAIN/auth/reset` (the password-reset link)
   - `pawspal://auth/callback` and `pawspal://auth/reset` (keep them: the phone apps use these)
   - Optional, only for trying the web app on your own computer: `http://localhost:8081/auth/callback` and `http://localhost:8081/auth/reset`.
3. If you also use the Vercel address (`https://pawspal-app.vercel.app`) before the domain is ready, add its two `/auth/...` links the same way.

**4. If you use your own Supabase domain**
The page may only talk to `*.supabase.co`. If you ever give Supabase a custom domain, ask Claude Code to add it to the policy in `apps/mobile/vercel.json` first.

**5. Try it on a phone**
- **iPhone:** open the web address in **Safari** (not Chrome). Tap the Share button, scroll, tap **Add to Home Screen**, tap **Add**. PawsPal now opens from the home screen without the browser bars. The welcome screen and Settings also have an **Install PawsPal** button that shows these steps.
- **Android:** open it in **Chrome**. Tap **Install** on the PawsPal card (or the browser menu, **Install app**). Confirm. It appears with the other apps.
- **Offline:** switch on airplane mode and open it: you should see a short "You are offline" page in English and Arabic.
- **Sign-up emails:** create a test account on the web address and check that the confirmation link opens the web app, not an error page.

## E4. Dependency updates (automatic)

Dependabot opens update PRs every week. The `dependabot-automerge` workflow merges each one that passes CI, so you do nothing. Packages that Expo manages are never offered, because they must move together (`npx expo install --fix`). Updates to GitHub Actions files are the one exception: GitHub does not let the built-in token merge changes to `.github/workflows`, so those PRs wait for Claude Code to merge them.

## E5. Email service (sign-up emails and reminders)

People join with an email and password and must click a confirmation link. Supabase's built-in sender only works for a handful of emails an hour, so you connect a proper sending service. **My recommendation: Resend** (free for 3,000 emails a month and 100 a day, simple setup, works for both Supabase's sign-up emails and our reminder emails). Alternatives are Brevo (300 a day free) or Amazon SES (cheapest, more setup). You need a **domain name** you control (for example `pawspal.app`), because email from a free address like gmail is rejected as spam. If you have no domain yet, buy one first (about 10 to 15 USD a year).

**Part 1: Resend**
1. Go to **resend.com** and click **Sign up** (use the PawsPal email). Confirm your email.
2. In the left menu click **Domains**, then **Add Domain**. Type a sending address under your domain, for example `mail.pawspal.app`, choose the region nearest your users, and click **Add**.
3. Resend now shows a few **DNS records** (a table with Type, Name and Value). Open the website where you bought the domain, go to its **DNS settings**, and add each record exactly as shown (copy and paste the Name and Value). Go back to Resend and click **Verify DNS Records**. It can take a few minutes up to a few hours. Wait until the domain says **Verified**.
4. In the left menu click **API Keys**, then **Create API Key**. Name it `pawspal`, permission **Sending access**, pick your domain, and click **Add**. **Copy the key now** (it is shown only once) and keep it in your password manager. Do not paste it in a chat.

**Part 2: tell Supabase to use it** (Supabase → your PawsPal project)
5. **Authentication → Emails → SMTP Settings** (it may be named "SMTP Settings" or "Email Settings"). Switch **Enable custom SMTP** on and fill in: **Sender email** `no-reply@mail.pawspal.app` (your verified domain), **Sender name** `PawsPal`, **Host** `smtp.resend.com`, **Port** `465`, **Username** `resend`, **Password** the Resend API key. Click **Save**.
6. **Authentication → Rate Limits**: set **Rate limit for sending emails** to about `30` per hour at first (Resend's free plan allows 100 a day).
7. **Authentication → URL Configuration**: **Site URL** `https://pawspal.vercel.app`. Under **Redirect URLs** click **Add URL** and add both `pawspal://auth/callback` and `pawspal://auth/reset`, then **Save**. (These are how the confirmation and password-reset links open the app.)
8. **Authentication → Emails → Templates**: open **Confirm sign up** and set the subject to `Confirm your PawsPal email` and the message to a short text with the link `{{ .ConfirmationURL }}` (for example: "Welcome to PawsPal. Tap the link to confirm your email: {{ .ConfirmationURL }}"). Do the same for **Reset password** (subject `Reset your PawsPal password`). Add the Arabic lines under the English ones if you like (a native speaker should check them).
9. **Test it:** create an account in the app, check the confirmation email arrives (look in spam the first time), and tap the link.

**Part 3: renewal reminder emails** (the `membership-reminders` function, 7 days before a membership ends)
10. Supabase → **Edge Functions → Secrets**, add: `EMAIL_PROVIDER` = `resend`, `RESEND_API_KEY` = the same key, `EMAIL_FROM` = `PawsPal <no-reply@mail.pawspal.app>`, and `REMINDER_SECRET` = a long random value (at least 24 characters).
11. Supabase → **Integrations → Cron → Create job**: name `membership-reminders`, schedule `0 8 * * *` (every day at 8 am), type **Supabase Edge Function**, function `membership-reminders`, method `POST`, and an HTTP header `x-reminder-secret` with the same value as `REMINDER_SECRET`. Save.

Running things on your own computer: `bash scripts/local-supabase.sh start` starts Supabase locally; sign-up emails then go to a local inbox (open http://127.0.0.1:54324 once Mailpit is running; the helper script excludes it by default, remove `mailpit` from the exclude list to use it). `bash scripts/test-db-supabase.sh` runs the security tests against it. The full list of function settings is in `supabase/functions/README.md`.

## E6. Photo clean-up (every night)

Photos that were uploaded but never saved (a pet photo you added and then left the screen, a sign-up photo that was never used) are removed by a small function, `cleanup-photos`, that runs once a night.

1. Supabase → **Edge Functions** → **Secrets**: add `CLEANUP_SECRET` with a long random value (at least 24 characters; a password generator is fine).
2. Supabase → **Integrations** → **Cron** (turn the Cron integration on if it asks) → **Create job**: name `cleanup-photos`, schedule `0 3 * * *` (3 am every day), type **Supabase Edge Function**, choose `cleanup-photos`, method `POST`, and add the header `x-cleanup-secret` with the same value as `CLEANUP_SECRET`.
3. Nothing else. A raw upload still in `incoming` after an hour, and a clean photo that no pet or profile uses after a day, are deleted. It never touches a photo that a pet or profile points to, and it looks only in the photo, ID and payment-screenshot folders. If the secret is not set, the function refuses to run.

## E8. Reviewing people and taking membership payments (by hand)

There is no payment company in the app. People pay you **registration (75 EGP)** and **renewal (25 EGP every 6 months)** by InstaPay or bank transfer, then send you a reference number or a screenshot, and **you confirm it in the admin site**.

**One-time: give people your payment details** (admin site → **Settings**)
1. Open the admin site and sign in (E10). Click **Settings** in the left menu.
2. Under **InstaPay**: paste your **InstaPay payment link** (it must start with `https://`) and, if you have a QR code image online, its `https://` address. Click **Save** next to each box.
3. Under **Bank transfer**: fill **Bank name**, **Account name**, **Account number**, **IBAN**, and a **Payment note** (for example "Write your email in the transfer note"). Click **Save** next to each.
4. Under **Fees** you can change 75, 25, 6 months and the 7-day reminder. People see the new amounts for their next payment.
Until you fill these in, the app tells people "Payment details are coming soon".

**Every working day (aim to finish within 1 business day, as the app promises)**
- **Verification:** open it, look at each selfie and ID photo, tick "I checked that the person is 18 or older and that the photos match", then **Approve** or **Reject** (a rejection needs a reason the person will read). **The ID photo is deleted the moment you decide.**
- **Payments:** check your bank or InstaPay app for the payment, then open **Payments** and **Confirm** it (or **Reject** with a reason). The screenshot is deleted when you decide. A confirmed registration starts six months of membership; a renewal adds six months to the date they already have.
- If a renewal is not paid, the account **pauses by itself** on the day it ends (no searching, messaging or booking) until you confirm their payment.

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
1. Supabase → **Authentication → Providers → Email**: **on**, with **Confirm email** on (this is also how normal people join, see E5). The admin account is an ordinary email account that you also invite and grant in the SQL Editor (below). Under **Authentication → Policies** (password strength): minimum length 12 with upper and lower case letters and digits. If your Supabase plan offers it, also set **Authentication → Sessions → inactivity timeout** (for example 1 hour): the site signs itself out after 30 minutes unused, but that is done in the browser.
2. Same area: make sure **Multi-Factor (authenticator app / TOTP)** is enabled (it is by default).
3. Vercel → your admin project → **Settings → Environment Variables** (all environments): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the same public values as the app) and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (the same Cloudflare Turnstile site key as the app; add the admin site's address to that widget's allowed hostnames in Cloudflare). Supabase asks for the Turnstile check on every sign-in, so without the key the sign-in button stays off.

**Make yourself the first admin** (Supabase → **SQL Editor**; only you, as project owner, can do this):
1. Run `select private.invite_admin('you@example.com');` (your real email).
2. **Authentication → Users → Add user → Create new user.** Same email, a long password from your password manager (at least 12 characters with upper and lower case letters and digits), and tick **Auto Confirm User**. **If it says the email is already registered, stop:** someone registered it before you. Run `select private.revoke_admin('you@example.com');`, delete the stray user in Authentication → Users, and start again from step 1.
3. Run `select private.grant_admin('you@example.com');`. It must answer `granted`. (`no_user`: step 2 was not done. `no_invite`: step 1 was not done. `not_confirmed`: tick Auto Confirm.)
4. **Right away**, open the admin site and sign in with the email and password. The first time it shows a QR code: scan it with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password) and type the six digit code. Keep the app safe: that code is your second key. Until this first code is set up, the password alone could enrol someone else's app, so do steps 3 and 4 together.

**Lost your phone?** In the SQL Editor run `delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'you@example.com');`, then also run `delete from auth.sessions where user_id = (select id from auth.users where email = 'you@example.com');` so old sign-ins end, and sign in again at once to scan a new QR code.

**Adding or removing an admin:** repeat the three steps for a new person. To remove one: `select private.revoke_admin('their@email.com');` (it takes effect at once, even for a page they have open). Keep the list short: admins can read reports, photos and the chat a report points at (that is only possible through a function that writes the read to the audit log; admins cannot read other chats).

**What admins can and cannot do:** every change goes through an audited database function (warn, suspend 3 or 7 days or until fixed, remove, reinstate, approve, decide appeals, resolve reports, remove a photo). Nobody can edit or delete the audit log, an admin cannot act on an admin (or on themselves), and a removed person's phone, ID and device are blocked. Fixed-length suspensions end by themselves (a job runs every 15 minutes; check with `select * from cron.job;`, it should list `lift-expired-suspensions`). The admin site signs itself out after 30 minutes without use.

## E11. Check that the database got the migrations
After each deploy, in Supabase → **SQL Editor** run `select count(*) from information_schema.tables where table_schema = 'public';` (it should be well above 0) and `select max(version) from supabase_migrations.schema_migrations;` (it should end in the number of the newest file in `supabase/migrations`). If the first answer is 0, the GitHub integration is not deploying: Supabase → **Project Settings → Integrations → GitHub**: the repository must be `ssamy-wlm/pawspal`, the production branch `production` and the directory `supabase`, with **Deploy to production** on. Then push something to `production` (or ask Claude to).

## F. Secrets checklist

| Secret | Where it lives | Never |
|---|---|---|
| Supabase URL and anon key | `apps/mobile/.env.local` (public values) | n/a |
| Supabase service_role key | Supabase → Edge Functions → Secrets | In the app or Git |
| Email provider key (`RESEND_API_KEY`) | Supabase → Authentication → SMTP password, and Edge Functions → Secrets | In the app or Git |
| Photo clean-up secret (`CLEANUP_SECRET`) | Supabase → Edge Functions → Secrets, and the Cron job header | In the app or Git |
| Reminder job secret (`REMINDER_SECRET`) | Supabase → Edge Functions → Secrets, and the Cron job header (`x-reminder-secret`) | In the app or Git |
| Map tile key (only if you use a paid or keyed tile provider) | App public settings (`EXPO_PUBLIC_MAP_TILE_URL`); keyed providers let you restrict it to your app | Unrestricted |

If a secret ever leaks: rotate it straight away in the provider's dashboard, then tell Claude Code to update the secret.

## E12. Map tiles (the availability map)

The map uses free **OpenStreetMap** tiles by default, with the required credit "© OpenStreetMap contributors" shown on the map. OpenStreetMap's public servers are meant for **light use only**, so before many people use the app switch to a provider with a free plan, for example **MapTiler** (100,000 tile views a month free): sign up at maptiler.com, create a key, and set `EXPO_PUBLIC_MAP_TILE_URL` to the raster tile address they give you (it contains your key) and `EXPO_PUBLIC_MAP_ATTRIBUTION` to the credit text they require. These are public app settings (`apps/mobile/.env.local`, and the EAS environment variables for builds). Restrict the key to your app in the provider's dashboard.

## G. Before launch

Work through `docs/security.md` (checklist), `docs/legal/README.md` (lawyer questions) and phase 9 of `docs/build-plan.md`.
