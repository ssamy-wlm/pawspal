# Edge functions (built in phases 2–8)

| Function | Phase | Does | Secrets |
|---|---|---|---|
| `request-otp` | 2 | Asks Supabase Auth to text a code. Per-device limit, hides banned numbers (same answer as for everyone else) | anon key, service role |
| `verify-otp` | 2 | Checks the code with Supabase Auth, counts wrong tries (CAPTCHA or 10 minute wait after two), returns the session | anon key, service role |
| `send-sms` | 2 | The Supabase **Send SMS hook**: Auth calls it with the code, it sends through the providers named in `SMS_PROVIDERS` (in order, with fallback) | hook secret, provider keys |
| `process-upload` | 2 | Takes a raw photo from `incoming/<uid>/`, strips all metadata (EXIF, GPS), saves the clean copy under a random name in `faces`, `pets` or `homes`, deletes the raw file | service role |
| `verify-identity` | 2 | Face and ID checks through the provider named in `IDENTITY_PROVIDER`; stores only the result and a hash of the document, never an ID image; calls `record_verification()` (service role only) | provider key, service role |
| `paymob-webhook` | 6 | Verifies HMAC, calls `confirm_booking_payment()`; handles refunds by Terms section 6 | Paymob HMAC, service role |
| `create-fee-payment` | 6 | Creates the payment for a `terms_agreed` booking; the price comes from server config, never the app | Paymob key |
| `handover-photo-url` | 7 | Gives the booking partner a short signed URL for the other side's handover photo | service role |
| `emergency` | 7 | Notifies the owner and opens a high-priority report | service role |
| `export-my-data`, `delete-my-account` | 9 | Privacy rights from the policy (section 8) | service role |

Every function: verify the user's JWT, validate input, rate-limit, and never log personal data.

## Phase 2 settings

Everything is a setting, so a provider can be swapped without changing code. Put them in Supabase → Edge Functions → Secrets (hosted) or `supabase/functions/.env` (local; see `.env.example`).

| Setting | Meaning |
|---|---|
| `SMS_PROVIDERS` | Comma list, tried in order: `whatsapp-cloud`, `generic-http`. Empty means the hook refuses to send (it never pretends). Test phone numbers need no provider. |
| `SMS_HTTP_URL`, `SMS_HTTP_METHOD`, `SMS_HTTP_HEADERS`, `SMS_HTTP_BODY`, `SMS_HTTP_FORMAT` | `generic-http`: describe any SMS company's HTTPS API with settings only (placeholders `{{to}}`, `{{to_digits}}`, `{{message}}`, `{{code}}`). |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` | `whatsapp-cloud`: sends the code as an approved WhatsApp template. |
| `SMS_MESSAGE` | Text with `{{code}}`. Default is Arabic and English. |
| `SEND_SMS_HOOK_SECRET` | The secret Supabase shows when you enable the Send SMS hook (`v1,whsec_...`). Requests with a wrong signature or an old timestamp are refused. |
| `IDENTITY_PROVIDER` | `fake` (testing only) or a real provider once chosen. Unset means the ID and selfie steps answer "not available yet". `fake` also needs `ALLOW_FAKE_IDENTITY=true` when `PAWSPAL_ENV=production`, so it cannot be switched on by accident. |
| `CAPTCHA_PROVIDER`, `CAPTCHA_SECRET` | Optional CAPTCHA after two wrong codes. Without it the person waits 10 minutes. |

To add a provider, write one file in `_shared/sms/` or `_shared/identity/`, register it on one line in that folder's `index.ts`, and add tests. Unit tests: `node --experimental-strip-types --test supabase/functions/_shared/*.test.ts`. Type check: `apps/mobile/node_modules/.bin/tsc -p supabase/functions/tsconfig.json`. Both run in CI.
