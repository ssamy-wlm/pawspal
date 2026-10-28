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
5. In **Authentication → Providers**: turn **Phone** on and **Email** off. Twilio details come in phase 2.

## E. Start building with Claude Code

In a terminal, in the project folder:

```
claude
```

Then type:

```
/phase 0
```

Claude Code reads `CLAUDE.md` and `HANDOVER.md`, sets up the app and database, runs the tests and reports what passed. Check the result on your phone: run `cd apps/mobile && npm start`, scan the QR code with Expo Go, and you should see the animated welcome screen. Then continue with `/phase 1`, `/phase 2` and so on, one at a time. After each phase, review the summary and push in GitHub Desktop.

To link the hosted database (from phase 2), ask Claude Code: "link the Supabase project and push the migrations". It will ask for the project reference and run `supabase link` and `supabase db push`. You approve each step.

## F. Secrets checklist

| Secret | Where it lives | Never |
|---|---|---|
| Supabase URL and anon key | `apps/mobile/.env.local` (public values) | n/a |
| Supabase service_role key | Supabase → Edge Functions → Secrets | In the app or Git |
| Twilio auth token | Supabase Auth settings | In the app or Git |
| Paymob API key and HMAC secret | Supabase Edge Function secrets | In the app or Git |
| KYC API key | Supabase Edge Function secrets | In the app or Git |
| Google Maps keys | App config, **restricted** to your app IDs | Unrestricted |

If a secret ever leaks: rotate it straight away in the provider's dashboard, then tell Claude Code to update the secret.

## G. Before launch

Work through `docs/security.md` (checklist), `docs/legal/README.md` (lawyer questions) and phase 9 of `docs/build-plan.md`.
