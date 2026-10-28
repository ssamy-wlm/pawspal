# Setup

The original SETUP.md was not in the repository, so this file was written fresh. It covers local setup, the hosted accounts and the automatic deploy.

## 1. On your computer
Install Git, Node.js (LTS), Docker Desktop, the Supabase CLI and a Postgres client (`psql`). On Windows run the shell scripts in WSL or Git Bash.

```bash
cd apps/mobile && npm install
```

Local database: `supabase start` (needs Docker running), then `bash scripts/test-db.sh` for the security tests.

## 2. GitHub branch rules (Settings, Branches or Rules)
Work happens directly on `main`, and the automated checks are the gate. Use these rules on `main`:
- **Block force pushes**: on.
- **Restrict deletions**: on.
- **Require a pull request before merging**: **off** (removed on purpose).
- **Require status checks**: leave **off**. GitHub cannot check a commit before a direct push, so requiring it would block every push. The gate works another way: `deploy` runs only after `ci` passes on the pushed commit.
- Turn on **secret scanning** and **push protection** (Settings, Code security).
- Turn on **Dependabot** alerts and security updates.

## 3. GitHub secrets for the automatic deploy
Add each at: your repository on GitHub, **Settings, Secrets and variables, Actions, New repository secret**. Until a secret exists, its deploy step is skipped and the run summary says so.

| Secret | Where to find the value | Used for |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com, your avatar, **Account preferences, Access Tokens, Generate new token** | Lets the deploy log in to Supabase |
| `SUPABASE_DB_PASSWORD` | The database password you chose when creating the project. If lost: project, **Project Settings, Database, Reset database password** | Lets the deploy change the database |
| `SUPABASE_PROJECT_REF` | Project, **Project Settings, General, Reference ID** (also the code in the dashboard URL) | Says which project to deploy to |
| `EXPO_TOKEN` | expo.dev, your avatar, **Account settings, Access tokens, Create token** (a robot or "robot user" token is best) | Lets the deploy publish app updates and builds |

These are secrets. Never paste them into chat, a file or an issue.

## 4. One-time Expo link (before the first app deploy)
The deploy skips the app step until the Expo project is linked.
1. Create an account at expo.dev.
2. On a computer: `cd apps/mobile && npx eas-cli login && npx eas-cli init && npx eas-cli update:configure`.
3. Commit the changed `app.json` (it now holds the project id and update address).
4. In the Expo dashboard, project, **Environment variables**, add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Supabase, **Project Settings, API**). The anon key is public by design; never add the service-role key.
5. The **first store build** needs your Apple and Google developer accounts and signing credentials. Run `npx eas-cli build --platform all --profile production` once yourself so EAS can ask for them. After that, `deploy` can build and submit on its own.

## 5. Supabase settings to turn on
- **Daily backups:** included in the paid Pro plan (the free plan has none). Check at **Database, Backups, Scheduled backups**.
- **Point-in-time recovery:** **Database, Backups, Point in time**, turn it on (paid add-on; needs Pro and a compute size that supports it).
- Phone sign-in only, email sign-up off, OTP expiry 300 s, rate limits (see `docs/security.md`).

## 6. Vercel (admin dashboard, phase 8)
Create the project from the GitHub repo with root directory `apps/admin`, production branch `main`. Auto-deploy on push is Vercel's default. Note that Vercel deploys on every push to `main` and does not wait for `ci`.
