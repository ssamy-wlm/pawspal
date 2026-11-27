# Edge functions

| Function | Phase | Does | Secrets |
|---|---|---|---|
| `process-upload` | 2 | Takes a raw photo from `incoming/<uid>/`, strips all metadata (EXIF, GPS), saves the clean copy under a random name in `faces`, `ids`, `payments`, `pets`, `homes` or `handovers` (kinds `face`, `id`, `payment`, `pet`, `home`, `handover`), deletes the raw file. Only `home` is attached to the profile | service role |
| `cleanup-photos` | 5 | Nightly: deletes photo files nobody uses (raw uploads left in `incoming`; clean photos in `pets`, `homes`, `faces`, `handovers`, `ids` and `payments` that nothing points to). Called by Supabase Cron with the `x-cleanup-secret` header. Never logs file names | `CLEANUP_SECRET`, service role |
| `handover-photo-url` | 7 | Gives the booking partner a link (valid 60 seconds) to the other side's handover photo; the database checks they are in the booking | service role |
| `emergency` | 7 | Either person in a running booking can raise it: the other person gets an in-app alert and a high-priority report opens for the team. Text message or push alerts come later (phase 9) | service role |
| `membership-reminders` | v3 | Daily: asks the database who is due (`list_due_reminders`), sends one plain text email each (English or Arabic) through the email provider, and calls `mark_reminded` only after the email went out. Called by a timer with the `x-reminder-secret` header. Returns only `{sent, failed}`; never logs or returns emails or names | `REMINDER_SECRET`, email key, service role |
| `admin-passkey` | v3+ | Admin sign-in step two: passkeys (WebAuthn) and recovery codes, by `@simplewebauthn/server`. Records in the database that this Supabase session passed; `is_admin()` depends on it. Enrolling, removing, renaming passkeys and making recovery codes need a fresh passkey proof (`step_up_options` / `step_up_verify`, else `403 step_up_required`). If it is down, the founder lists the sessions with `private.list_admin_sessions` and opens the one whose 8-character code the admin site shows with `private.open_admin_session(email, code)` in the SQL editor. Contract: `docs/ARCHITECTURE.md` section 10c | `ADMIN_RP_ID`, `ADMIN_ORIGIN`, `ADMIN_RP_NAME`, service role |
| `delete-account` | 9 | POST `{password}` with the person's token. Checks the password again (5 wrong tries an hour per person), refuses admins (`403 admin_account`), people with a requested, confirmed, running or disputed booking (`409 active_booking`) and people with an unresolved report against them or an unresolved appeal (`409 open_case`), then closes the account in the database (`close_account`), ends every session, bans the sign-in account for good and deletes the photo files. Answers `{ok, purge_after}`; other errors `401 wrong_password`, `429 too_many_attempts`, `502 try_again_later`. Safe to repeat after a `502` | service role, anon key |
| `export-my-data` | 9 | POST `{password}` with the person's token (the password is checked again; 5 tries an hour, shared with deletion; `401 wrong_password`): `{ok, exported_at, data, files:[{kind, name, url}]}`; the links are valid 1 hour and only for the person's own photos. 3 exports a day (`429 too_many_attempts`) | service role |
| `purge-accounts` | 9 | Nightly: `purge_deleted_accounts()` finishes the deletion of accounts whose grace period (`deletion_grace_days`) ended (deletes the sign-in account, keeps ban hashes, payment records, audit log and shared history), deletes messages and bookings older than `shared_history_months`, then deletes leftover photo files. Header `x-purge-secret`. Also deletes the handover photo files of bookings removed by the retention. Unresolved reports, appeals and disputed bookings keep their conversation and booking. Returns counts only | `PURGE_SECRET`, service role |
| `send-notifications` | 9 | Every minute: sends the queued push notifications through the Expo push service, 100 at a time, deletes device tokens the service reports as `DeviceNotRegistered`. Sends nothing unless the founder turned on `push_enabled`. Header `x-notifications-secret`. Content is generic (title "PawsPal", one of four fixed sentences, data `{type, id}`) | `NOTIFICATIONS_SECRET`, optional `EXPO_ACCESS_TOKEN`, service role |

Every function: verify the user's JWT, validate input, rate-limit, and never log personal data.

## Settings

Everything is a setting, so a provider can be swapped without changing code. Put them in Supabase → Edge Functions → Secrets (hosted) or `supabase/functions/.env` (local; see `.env.example`).

| Setting | Meaning |
|---|---|
| `CLEANUP_SECRET` | Shared secret for `cleanup-photos` (24 characters or more). Too short or missing means the function refuses everyone. |
| `PURGE_SECRET` | The same for `purge-accounts` (header `x-purge-secret`). Its own value: do not reuse another secret. |
| `REMINDER_SECRET` | The same for `membership-reminders`. |
| `NOTIFICATIONS_SECRET` | The same for `send-notifications` (header `x-notifications-secret`). |
| `EXPO_ACCESS_TOKEN` | Optional. Only if "enhanced push security" is on in the Expo account. |
| `SUPABASE_ANON_KEY` | Provided by Supabase to every function. `delete-account` uses it to check a password in a separate client that keeps no session. |
| `ADMIN_RP_ID`, `ADMIN_ORIGIN`, `ADMIN_RP_NAME` | The admin site's domain, its exact `https://` address (one origin) and the name shown in the passkey prompt, for `admin-passkey`. Any missing means it answers 503. A new domain means every admin registers again with a setup code. |
| `EMAIL_PROVIDER` | Which email company sends the reminders. Default `resend`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend key and the sender address, for example `PawsPal <hello@your-domain>`. Missing means `membership-reminders` answers 503 and sends nothing. |

To add an email provider, write one file in `_shared/email/`, register it on one line in `_shared/email/index.ts`, and add tests. Unit tests (run `npm ci` in `supabase/functions` first: the passkey round-trip test uses the real `@simplewebauthn/server`): `node --experimental-strip-types --test supabase/functions/_shared/*.test.ts`. Type check: `apps/mobile/node_modules/.bin/tsc -p supabase/functions/tsconfig.json`. Both run in CI.

## Founder steps for phase 9 (push notifications and account deletion)

1. **Push.** Supabase, Edge Functions, Secrets: add `NOTIFICATIONS_SECRET` (a long random value, 24 characters or more). Deploy `send-notifications` (the GitHub integration does it). Supabase, Integrations, Cron, Create job: name `send-notifications`, schedule `* * * * *` (every minute), type Supabase Edge Function, function `send-notifications`, method `POST`, header `x-notifications-secret` = the same value. Nothing is queued or sent until you turn it on: set `push_enabled` to `true` (admin site, Settings, once the field exists there; until then the SQL editor: `update public.app_settings set value = 'true' where key = 'push_enabled';`). Turn it off the same way. Expo needs a development or production build with the push entitlement (EAS); Expo Go on Android SDK 53+ cannot receive remote push.
2. **Purge.** Add a second Cron job: name `purge-accounts`, schedule `30 3 * * *`, function `purge-accounts`, method `POST`, header `x-purge-secret` = the value of a new secret `PURGE_SECRET` (24 characters or more; add it under Edge Functions, Secrets first). Without this job deleted accounts stay as closed stubs and are never purged.
3. **Numbers to confirm with the lawyer.** `deletion_grace_days` (30) and `shared_history_months` (24) are placeholders from the privacy policy (`[30]` days, `[24]` months). Change them with `admin_set_setting` (admin site) or in the SQL editor; they apply to accounts closed after the change (grace) and to the next purge run (months).
