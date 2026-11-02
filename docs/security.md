# Security and trust model

Goal: a fake person, a thief or a careless user cannot hurt a pet, steal a location or take money, even if they modify the app. **The server enforces every rule. The app only displays what the server allows.**

## Threats and how each is stopped

| Threat | Defence | Where |
|---|---|---|
| Fake or duplicate accounts | Email confirmation link; a **person checks a live selfie and an ID photo by hand** before the account is active (`admin_decide_verification`); duplicate and banned checks on the email hash and the device hash; rate limits | `verification_requests`, `handle_new_user()` |
| Banned user returns | A one-way hash of the email and the device is kept for removed accounts; sign-up is refused on a match (limit: a new email gets through; the device hash is the second line) | `banned_identifiers`, `private.identity_hashes()` |
| Exact address leaks | Exact coordinates live in the `private` schema, which the API never exposes. Public profiles get a rounded point plus a random offset (about 300 m). The exact pin is released only by `get_booking_location()` for a confirmed, paid booking, to its two participants, if the host allowed sharing | Migration `0001` |
| Contact details shared early (off-app deals) | A database trigger masks phone numbers, emails, links and payment words in messages until the pair has a **confirmed booking** (both accepted the terms), and logs a flag | `mask_contact_info()` trigger, `has_confirmed_booking()` |
| Tampered app sends fake data | Row-level security on every table; status changes happen only in security-definer functions; there are no client-side "is_admin" checks | Migration `0001` |
| Pet swapped after booking | Pet details and photos lock on confirmation (trigger); handover photos are taken in-app by both sides with a timestamp; they can only be saved through `add_handover_photo()` (own clean upload, right booking state) and are shown to the partner by a 60 second signed link | `lock_pet_on_confirm()`, `add_handover_photo()`, `handover-photo-url` |
| Fake reviews | A review needs a completed booking, the author must be a participant, and there is one review per side per booking | RLS policy plus a unique constraint |
| Fake membership payment | Membership payments happen outside the app; **a person confirms each one by hand** in the admin site (audited); the app never changes a membership itself; payment screenshots are readable only by an admin session with the authenticator code and are deleted after the decision | `admin_confirm_payment()`, `payment_claims` |
| Email bombing and bot sign-ups | Supabase Auth email rate limits (set them after custom SMTP is on), password rules, email confirmation required before any access, a new account can do nothing until a person approves it. Open risk: no CAPTCHA on sign-up; add one if abuse appears | Auth settings |
| Account takeover | Strong password rules (12+ characters, upper, lower, digit), email confirmation, password reset by email link, sign out all devices in Settings | Auth |
| Harassment | Block (hides both ways, stops messages), report, rate limits on messaging new people (20 per day for new accounts) | `blocks` table, policies |
| Admin abuse | Admins are listed in `admins`; every admin action runs through `admin_take_action()`, which writes the audit log; the audit log is insert-only | Migration `0001` |
| Leaked keys | Only the **anon** key ships in the app. The service-role key, the email provider key and the reminder secret live only in Supabase secrets. GitHub secret scanning and push protection are on. | Secrets |
| Photo abuse | Uploads go to private buckets; images are served by signed URL; EXIF (GPS) is stripped on upload; automatic face check plus human review before a photo is public | Storage policies, `process-upload` function |
| Data breach impact | Least data: no ID images stored, card data never touches our servers, exact location separated, backups encrypted | Architecture |

## Non-negotiable rules for anyone writing code (including Claude Code)

1. Never put the service-role key, the email provider key or any other secret in the mobile app or in Git.
2. Never select from `private.*` in client code. Read exact locations only through `get_booking_location()`.
3. Every new table: enable RLS in the same migration, with policies for select, insert, update and delete, or none.
4. Never trust a value from the client for: price, booking status, user status, membership dates, verification flags or any admin decision.
5. Every admin mutation goes through a security-definer function that writes `audit_log`.
6. Validate input on the server: lengths, enums and dates (end after start, start not in the past, at most 60 nights).
7. Strip EXIF location from every uploaded photo.
8. Log security events (masked contact attempts, blocked sign-ups) without logging message contents or codes.
9. Dependencies: pin versions and enable Dependabot; CI fails on high-severity `npm audit` findings.

## Web session storage (the web app)

On a phone the sign-in session lives in the secure keychain. A browser has no keychain, so the web app keeps the session (and the language and theme choices) in `localStorage`. The trade-off: any script that runs on the page could read it, so a cross-site scripting (XSS) bug would be much more serious on the web. The defence is to make sure no foreign script can run:

- The strict Content Security Policy in `apps/mobile/vercel.json` is **required**: `script-src 'self'` (no inline script, no `unsafe-eval`, no third-party host), `connect-src` only this site and `*.supabase.co`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`. `scripts/check-web-build.mjs` and the jest tests fail if it is loosened.
- No third-party scripts, analytics or widgets on the app page. The map runs in a sandboxed iframe (`/map-frame.html`, scripts only, no storage or cookies, its own policy that alone allows the pinned MapLibre file with its integrity hash).
- If the browser refuses storage, the session is kept in memory for that tab only.
- Sign-in and reset links put tokens in the address; the app uses them once and removes them from the address bar. The service worker never caches pages or any cross-origin or non-GET request.
- Camera and location are allowed for this site only (`Permissions-Policy`).

## Before launch: security checklist

- [ ] Supabase: RLS enabled on all tables (run the Security Advisor and fix every warning)
- [ ] Supabase: email provider on with "Confirm email" on; custom SMTP set up (Resend); password policy 12+ with upper, lower, digit; the email sending rate limit set; redirect URLs `pawspal://auth/callback` and `pawspal://auth/reset` allowed
- [ ] Storage buckets private; signed URL expiry 1 hour or less
- [ ] Google Maps keys restricted to app IDs and to the Maps and Places APIs only; budget alert set
- [x] An ID photo or payment screenshot is deleted right after the decision, and nobody but an admin session with the authenticator code can read those buckets (tests in `supabase/tests/signup_assertions.sql`, `membership_assertions.sql`)
- [ ] Test with a modified client: try to read another user's exact location, set your own status to active, review without a booking, and send a phone number in chat before a booking is confirmed. All must fail
- [ ] Penetration test or an independent review of the RLS policies
- [ ] Backups and point-in-time recovery on (paid Supabase plan)
- [ ] Incident plan: who to call, how to revoke keys, how to notify users and the regulator
- [ ] Legal review done (see `docs/legal/README.md`)
