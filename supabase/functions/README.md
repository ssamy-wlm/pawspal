# Edge functions

| Function | Phase | Does | Secrets |
|---|---|---|---|
| `process-upload` | 2 | Takes a raw photo from `incoming/<uid>/`, strips all metadata (EXIF, GPS), saves the clean copy under a random name in `faces`, `ids`, `payments`, `pets`, `homes` or `handovers` (kinds `face`, `id`, `payment`, `pet`, `home`, `handover`), deletes the raw file. Only `home` is attached to the profile | service role |
| `cleanup-photos` | 5 | Nightly: deletes photo files nobody uses (raw uploads left in `incoming`; clean photos in `pets`, `homes`, `faces`, `handovers`, `ids` and `payments` that nothing points to). Called by Supabase Cron with the `x-cleanup-secret` header. Never logs file names | `CLEANUP_SECRET`, service role |
| `handover-photo-url` | 7 | Gives the booking partner a link (valid 60 seconds) to the other side's handover photo; the database checks they are in the booking | service role |
| `emergency` | 7 | Either person in a running booking can raise it: the other person gets an in-app alert and a high-priority report opens for the team. Text message or push alerts come later (phase 9) | service role |
| `membership-reminders` | v3 | Daily: asks the database who is due (`list_due_reminders`), sends one plain text email each (English or Arabic) through the email provider, and calls `mark_reminded` only after the email went out. Called by a timer with the `x-reminder-secret` header. Returns only `{sent, failed}`; never logs or returns emails or names | `REMINDER_SECRET`, email key, service role |
| `export-my-data`, `delete-my-account` | 9 | Privacy rights from the policy (section 8) | service role |

Every function: verify the user's JWT, validate input, rate-limit, and never log personal data.

## Settings

Everything is a setting, so a provider can be swapped without changing code. Put them in Supabase → Edge Functions → Secrets (hosted) or `supabase/functions/.env` (local; see `.env.example`).

| Setting | Meaning |
|---|---|
| `CLEANUP_SECRET` | Shared secret for `cleanup-photos` (24 characters or more). Too short or missing means the function refuses everyone. |
| `REMINDER_SECRET` | The same for `membership-reminders`. |
| `EMAIL_PROVIDER` | Which email company sends the reminders. Default `resend`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend key and the sender address, for example `PawsPal <hello@your-domain>`. Missing means `membership-reminders` answers 503 and sends nothing. |

To add an email provider, write one file in `_shared/email/`, register it on one line in `_shared/email/index.ts`, and add tests. Unit tests: `node --experimental-strip-types --test supabase/functions/_shared/*.test.ts`. Type check: `apps/mobile/node_modules/.bin/tsc -p supabase/functions/tsconfig.json`. Both run in CI.
