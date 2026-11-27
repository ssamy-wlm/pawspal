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
| **InstaPay and Vodafone Cash** | Where people pay you the membership (nothing to install) | Now |
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

## E5b. Interim: sending sign-up emails with Gmail (until you have a domain)

Until you own a domain, sign-up, confirmation and password-reset emails go out through the Gmail account **pawspal.app@gmail.com**. When you buy a domain, switch to Resend (E5).
1. In the Google account **pawspal.app@gmail.com** (2-step verification on), open https://myaccount.google.com/apppasswords, create an app password named `PawsPal mail`, and keep the 16 letters open.
2. Supabase > **Authentication > Emails > SMTP Settings** > **Enable custom SMTP**: **Sender email address** `pawspal.app@gmail.com`, **Sender name** `PawsPal` (this is the name people see in their inbox), **Host** `smtp.gmail.com`, **Port** `465`, **Username** `pawspal.app@gmail.com`, **Password** the 16 letters with no spaces. **Save changes**.
3. Supabase > **Authentication > Rate Limits**: keep emails per hour at `30` or lower. Gmail sends about 500 emails a day in total, so this is only for a small start.
4. Test: **Authentication > Users** > the admin row > **Send password recovery**. It should arrive in the inbox from **PawsPal**. Do not click the link.
5. If the log says `535 Username and Password not accepted`, the username and the app password belong to different Google accounts. Make the app password again in the account whose address you typed as the username.
6. **Membership reminder emails (7 days before a membership ends) through Gmail.** These come from the `membership-reminders` function, which has its own settings. Do these one at a time:
   1. In the Google account **pawspal.app@gmail.com**, open https://myaccount.google.com/apppasswords and create a **second** app password named `PawsPal reminders`. Keep the 16 letters open. Do not reuse the one from step 2.
   2. Supabase > **Edge Functions** > **Secrets** > **Add new secret**: name `EMAIL_PROVIDER`, value `smtp`. Save.
   3. Add secret `SMTP_USER`, value `pawspal.app@gmail.com`. Save.
   4. Add secret `SMTP_PASSWORD`, value the 16 letters of `PawsPal reminders`, no spaces. Save.
   5. Add secret `EMAIL_FROM`, value `PawsPal <pawspal.app@gmail.com>`. Save. (The address must be exactly the same as `SMTP_USER`.)
   6. Add secret `REMINDER_SECRET`, value a long random text of at least 24 characters (a password generator is fine). Keep a copy for the next step.
   7. Supabase > **Integrations** > **Cron** (turn it on if it asks) > **Create job**: name `membership-reminders`, schedule `53 7 * * *` (every day at 07:53 UTC), type **Supabase Edge Function**, function `membership-reminders`, method `POST`, add the header `x-reminder-secret` with the same value as `REMINDER_SECRET`. Save.
   8. Test. Create a test account in the app (a second email you own) and let it be approved, so it has a membership. Supabase > **SQL Editor** > **New query**. First look at the current values and write them down:
      ```sql
      select m.user_id, m.paid_until, m.reminded_for
      from public.memberships m join auth.users u on u.id = m.user_id
      where u.email = 'TEST-EMAIL-HERE';
      ```
      Then set the test account to end in 3 days (replace `TEST-EMAIL-HERE` with the test account's email) and click **Run**:
      ```sql
      update public.memberships
      set paid_until = (now() at time zone 'Africa/Cairo')::date + 3, reminded_for = null
      where user_id = (select id from auth.users where email = 'TEST-EMAIL-HERE');
      ```
   9. Supabase > **Integrations** > **Cron** > the job `membership-reminders` > **Run now**. The test email should arrive within a minute from **PawsPal**. If it does not, look in **Edge Functions** > `membership-reminders` > **Logs**: `503` means a secret is missing or wrong (check the five names and that `EMAIL_FROM` equals `SMTP_USER`); `{"sent":0,"failed":1}` means Gmail refused it (make the app password again, step 1).
   10. **Put it back afterwards.** Run this with the two values you wrote down in step 8 (use `null` if `reminded_for` was empty):
      ```sql
      update public.memberships
      set paid_until = 'OLD-PAID-UNTIL', reminded_for = OLD-REMINDED-FOR-or-null
      where user_id = (select id from auth.users where email = 'TEST-EMAIL-HERE');
      ```
      (For example `paid_until = '2027-05-20', reminded_for = null`; a date in `reminded_for` needs quotes too.) Or simply delete the test account in the app.
   11. Gmail sends about 500 emails a day in total, sign-up emails included, and only port 465 works. The Arabic and English reminder text is a **draft**: read both versions in the test email and tell me what to change before real members get it. When you buy a domain, switch `EMAIL_PROVIDER` back to `resend` (E5).
7. On the sign-up "Check your email" screen people see "Didn't get it? Check your spam folder." and a **Resend email** button (once a minute). Ask early testers to mark the first email **Not spam**, which helps Gmail trust the sender.

## E6. Photo clean-up (every night)

Photos that were uploaded but never saved (a pet photo you added and then left the screen, a sign-up photo that was never used) are removed by a small function, `cleanup-photos`, that runs once a night.

1. Supabase → **Edge Functions** → **Secrets**: add `CLEANUP_SECRET` with a long random value (at least 24 characters; a password generator is fine).
2. Supabase → **Integrations** → **Cron** (turn the Cron integration on if it asks) → **Create job**: name `cleanup-photos`, schedule `0 3 * * *` (3 am every day), type **Supabase Edge Function**, choose `cleanup-photos`, method `POST`, and add the header `x-cleanup-secret` with the same value as `CLEANUP_SECRET`.
3. Nothing else. A raw upload still in `incoming` after an hour, and a clean photo that no pet or profile uses after a day, are deleted. It never touches a photo that a pet or profile points to, and it looks only in the photo, ID and payment-screenshot folders. If the secret is not set, the function refuses to run.

## E8. Reviewing people and taking membership payments (by hand)

There is no payment company in the app. People pay you **registration (75 EGP)** and **renewal (25 EGP every 6 months)** by InstaPay or Vodafone Cash, then send you a reference number or a screenshot, and **you confirm it in the admin site**.

**One-time: give people your payment details** (admin site → **Settings**)
1. Open the admin site and sign in (E10). Click **Settings** in the left menu.
2. Under **InstaPay**, click **InstaPay address**, type your address (for example `yourname@instapay`, no spaces) and click **Save** next to it. If you have an InstaPay payment link, paste it into **InstaPay link (optional)** (it must start with `https://`) and click **Save**.
3. Under **Vodafone Cash**, click **Vodafone Cash number**, type your wallet number (for example `01012345678`, or `+201012345678`, no spaces) and click **Save**. If you have a Vodafone Cash payment link, paste it into **Vodafone Cash link (optional)** (it must start with `https://`) and click **Save**.
   Under **Note for people paying**, click **Payment note (optional)**, type a short line (for example "Write your email in the payment note") and click **Save**.
   You can fill in only one of InstaPay or Vodafone Cash. The app shows an option only when it is filled in, and a box you clear and save disappears from the app.
4. Under **Fees** you can change 75, 25, 6 months and the 7-day reminder. People see the new amounts for their next payment.
Until you fill these in, the app tells people "Payment details are coming soon".

**Every working day (aim to finish within 1 business day, as the app promises)**
- **Verification:** open it, look at each selfie and ID photo, tick "I checked that the person is 18 or older and that the photos match", then **Approve** or **Reject** (a rejection needs a reason the person will read). **The ID photo is deleted the moment you decide.**
- **Payments:** check your InstaPay or Vodafone Cash app for the payment, then open **Payments** and **Confirm** it (or **Reject** with a reason). The screenshot is deleted when you decide. A confirmed registration starts six months of membership; a renewal adds six months to the date they already have.
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

The dashboard is the website in `apps/admin` (Vercel). Admin power needs **three things at once**: a password, a **passkey** (Face ID, a fingerprint or Windows Hello on your phone or laptop), and a place in the admins list. The database checks the passkey on every request, so a stolen password alone opens nothing.

**One-time settings**
1. Supabase → **Authentication → Providers → Email**: **on**, with **Confirm email** on (this is also how normal people join, see E5). The admin account is an ordinary email account that you also invite and grant in the SQL Editor (below). Under **Authentication → Policies** (password strength): minimum length 12 with upper and lower case letters and digits. If your Supabase plan offers it, also set **Authentication → Sessions → inactivity timeout** (for example 1 hour): the site signs itself out after 30 minutes unused, but that is done in the browser.
2. Vercel → your admin project → **Settings → Environment Variables** (all environments): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the same public values as the app) and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (the same Cloudflare Turnstile site key as the app; add the admin site's address to that widget's allowed hostnames in Cloudflare). Supabase asks for the Turnstile check on every sign-in, so without the key the sign-in button stays off.
3. **Tell the passkey function your website address.** A passkey belongs to the website address it was made on, so the function must know yours. Supabase dashboard → **Edge Functions → Secrets** → **Add new secret**, three times (the name goes in the first box, the value in the second, then **Save**):
   - `ADMIN_RP_ID` = the host name of the admin site, without `https://` and without a slash. Today: `pawspal.vercel.app`
   - `ADMIN_ORIGIN` = the full address of the admin site. Today: `https://pawspal.vercel.app`
   - `ADMIN_RP_NAME` = the name your device shows when it asks to save the passkey, for example `PawsPal Admin`

   Until these are set, the admin site says that passkeys are not switched on yet.
4. **Turn on 2-step verification for your own Supabase and GitHub accounts** (each site: your profile picture → Account or Settings → Security → 2-step verification or two-factor authentication). The Supabase dashboard is your emergency door into the admin site (see "Lost both devices" below), so it must be as safe as the admin site itself.

**Make yourself the first admin** (Supabase → **SQL Editor**; only you, as project owner, can do this). Do steps 1 to 3 in order, then steps 4 to 6 straight away:
1. Run `select private.invite_admin('you@example.com');` (your real email).
2. **Authentication → Users → Add user → Create new user.** Same email, a long password from your password manager (at least 12 characters with upper and lower case letters and digits), and tick **Auto Confirm User**. **If it says the email is already registered, stop:** someone registered it before you. Run `select private.revoke_admin('you@example.com');`, delete the stray user in Authentication → Users, and start again from step 1.
3. Run `select private.grant_admin('you@example.com');`. It must answer `granted`. (`no_user`: step 2 was not done. `no_invite`: step 1 was not done. `not_confirmed`: tick Auto Confirm.)
4. **Get a one-time setup code.** In the SQL Editor run `select private.new_admin_setup_code('pawspal@gmail.com');` (use your admin email). The answer is a short code. It is shown **once** and works for **15 minutes**; copy it right away. If it runs out, run the line again to get a new one.
5. **On your phone**, open the admin site in the browser and sign in with your email and password. The page says **Set up your passkey**. Type the setup code, leave or change the device name (for example `My iPhone`), tap **Create passkey** and confirm with Face ID or your fingerprint. Your phone may offer to save the passkey in iCloud Keychain or Google Password Manager: say yes, so a new phone gets it too.
6. **Save your recovery codes.** The next page shows 10 codes. Each code works once. Tap **Download as text file** or **Copy** and keep them offline or in your password manager, **not** only on the phone. They are the way in if both of your devices are lost. Tick **I saved these codes somewhere safe**, then **Continue**.

**See who is an admin** (SQL Editor): `select * from private.list_admins();`

**Add your laptop as a second device.** A second device means a lost phone does not lock you out. Passkeys cannot be copied by hand, so there are two ways. Do either one. We recommend the second, because it needs no code from the SQL Editor:
- *With a fresh setup code.* In the SQL Editor run `select private.new_admin_setup_code('pawspal@gmail.com');` again. Open the admin site on the laptop and sign in with email and password. On **Use your passkey**, press the small link **I have a setup code**, type the new code, name the device (for example `My laptop`) and press **Create passkey**. The code works once and for 15 minutes. You get a new set of recovery codes: save them, because the old ones stop working.
- *With your phone (recommended).* On the laptop open the admin site and sign in with email and password. On **Use your passkey**, press the button. In the box that opens, choose **Use a phone or tablet** (the wording differs by browser and system); a QR code appears. Scan it with your phone and confirm with Face ID or your fingerprint. The laptop is now signed in. Open **Security** in the left menu, type a name such as `My laptop` under **Add a passkey on this device**, and press **Add a passkey**. The site asks **Touch your passkey to continue**: press **Touch your passkey** and confirm with Face ID or your fingerprint again (see the note below). From now on the laptop opens the site on its own.

**Lost one device?** Sign in on the other one, open **Security**, and remove the lost device's passkey (**Remove**, then **Yes, remove it**; the site asks you to touch your passkey once more). Add a new one when you have a new device.

**Why the site asks you to touch your passkey again.** Adding, renaming or removing a passkey, and making new recovery codes, need a fresh touch of a passkey from the last 5 minutes. A box says **Touch your passkey to continue**; press **Touch your passkey**, confirm on your device, and the action goes through by itself. If you press **Cancel**, nothing changes. Setting up with a setup code does not need it.

**If something locks you out** (for example after too many wrong tries, or the passkey function is down):
1. **Wait one hour.** Failed tries are counted per hour, and the lock lifts by itself.
2. **Or get a new setup code.** In the Supabase SQL Editor run `select private.new_admin_setup_code('you@example.com');` (your admin email). It also clears a lockout. Use it on **Use your passkey** with **I have a setup code**.
3. **If the passkey function cannot be reached** (for example a secret is wrong or the function is not deployed), open an emergency session:
   1. On the admin site sign in with email and password. The next screen shows a small line **Session code: XXXXXXXX**. Write the 8 characters down (it also shows on the recovery code and setup code screens).
   2. In the Supabase SQL Editor run `select * from private.list_admin_sessions('you@example.com');`. Find the row whose `short_id` matches your Session code, and whose IP address and browser (user agent) look like yours. If no row matches, stop: it is not your session.
   3. Run `select private.open_admin_session('you@example.com', 'XXXXXXXX', 30);` with your Session code in place of `XXXXXXXX`. This gives that one session 30 minutes.
   4. **Reload the admin page.** Use the 30 minutes to fix the function or its secrets (Supabase → **Edge Functions**) or to add a new passkey on **Security**, then press **Sign out**.

**Lost both devices?**
1. On the sign-in screen choose **Use a recovery code**, type one of your 10 codes and press **Use this code**. Each code works once, and the session it opens lasts 30 minutes. The site then asks you to **add a new passkey now** (open **Security**), and you can **Make new codes** there.
2. **Last resort**, if the recovery codes are gone too: in the Supabase SQL Editor (this needs your Supabase login, which is why it has 2-step verification) run `select private.reset_admin_passkeys('pawspal@gmail.com');`. This deletes all passkeys and codes for that admin and signs them out. Then get a new setup code (step 4 above) and start again at step 5.

**Adding or removing an admin:** repeat the three steps for a new person. To remove one: `select private.revoke_admin('their@email.com');` (it takes effect at once, even for a page they have open). Keep the list short: admins can read reports, photos and the chat a report points at (that is only possible through a function that writes the read to the audit log; admins cannot read other chats).

**If the admin site moves to a new address.** A passkey only works on the website address it was made on (today `pawspal.vercel.app`). If the admin site gets a new address (a custom domain, for example), the old passkeys stop working. Do this: (1) change `ADMIN_RP_ID` and `ADMIN_ORIGIN` in Supabase → **Edge Functions → Secrets** to the new host name and the new `https://` address; (2) in SQL Editor run `select private.reset_admin_passkeys('pawspal@gmail.com');` and then `select private.new_admin_setup_code('pawspal@gmail.com');`; (3) make new passkeys and new recovery codes on the new address, as in "Make yourself the first admin" step 5. Do the move on a day when you can sit down for ten minutes: until it is done nobody can open the admin site.

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

## E13. Account deletion, data download, notifications and crash reports (phase 9)

People can now delete their account and download their data from **Settings > Privacy**. Deleted accounts are closed at once and wiped for good by a nightly job. Notifications and crash reports stay off until you turn them on.

**Nightly clean-up of deleted accounts (do this once, or deleted accounts are never wiped):**
1. Supabase > **Edge Functions > Secrets > Add new secret**: name `PURGE_SECRET`, value a long random password (24 characters or more). Save.
2. Supabase > **Integrations > Cron > Create job**: name `purge-accounts`, schedule `30 3 * * *` (3:30 every night), type **Supabase Edge Function**, function `purge-accounts`, method `POST`, and add the header `x-purge-secret` with the same value as `PURGE_SECRET`. Save.

**Two numbers the lawyer must confirm before launch.** The admin site > **Settings > Notifications and data** shows **days before a deleted account is wiped** (starts at 30) and **months a conversation or booking is kept** (starts at 24). They match the placeholders in the privacy policy. The 24-month number is permanent: older messages and bookings really are deleted every night. Check both with your lawyer, then save them there.

**Notifications (phone app only):**
1. Supabase > **Edge Functions > Secrets**: add `NOTIFICATIONS_SECRET` (24 characters or more).
2. Supabase > **Integrations > Cron > Create job**: name `send-notifications`, schedule `* * * * *` (every minute), function `send-notifications`, method `POST`, header `x-notifications-secret` with the same value.
3. Notifications need a real phone build, not Expo Go. In the project folder run `eas init` once (Claude Code can do this with you) so the app gets its Expo project id, then make a store or test build.
4. When the build is installed and tested, admin site > **Settings > Notifications and data** > switch **Push notifications** on. Until you do, nothing is sent. Messages are always generic ("You have a new message"), with no names or message text.

**Crash reports (optional):**
1. Create a free account at sentry.io and a project for **React Native**. Copy its **DSN** (a web address that starts with https://).
2. In Expo (expo.dev) > your project > **Environment variables**, add `EXPO_PUBLIC_SENTRY_DSN` with the DSN. Then add a **secret** `SENTRY_AUTH_TOKEN` (Sentry > Settings > Auth Tokens). The auth token is never put in the app or in GitHub.
3. Crash reports contain no names, emails, locations or message text, and are off in the web app. Make a new store build to start them.

## G. Before launch

Work through `docs/security.md` (checklist), `docs/legal/README.md` (lawyer questions) and phase 9 of `docs/build-plan.md`.
