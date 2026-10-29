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
