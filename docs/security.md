# Security and trust model

Goal: a fake person, a thief or a careless user cannot hurt a pet, steal a location or take money, even if they modify the app. **The server enforces every rule. The app only displays what the server allows.**

## Threats and how each is stopped

| Threat | Defence | Where |
|---|---|---|
| Fake or duplicate accounts | Phone OTP (one number per account); live selfie and ID check by the KYC provider; duplicate check on the phone hash, the ID result fingerprint and the device ID; human review of new profiles | Auth, `verify-identity` function, admin photo review |
| Banned user returns | Keep a one-way hash of phone, ID fingerprint and device for banned accounts; block sign-up on a match | `banned_identifiers` table |
| Exact address leaks | Exact coordinates live in the `private` schema, which the API never exposes. Public profiles get a rounded point plus a random offset (about 300 m). The exact pin is released only by `get_booking_location()` for a confirmed, paid booking, to its two participants, if the host allowed sharing | Migration `0001` |
| Contact details shared early (off-app deals) | A database trigger masks phone numbers, emails, links and payment words in messages until the pair has a confirmed, paid booking, and logs a flag | `mask_contact_info()` trigger |
| Tampered app sends fake data | Row-level security on every table; status changes happen only in security-definer functions; there are no client-side "is_admin" checks | Migration `0001` |
| Pet swapped after booking | Pet details and photos lock on confirmation (trigger); handover photos are taken in-app by both sides with a timestamp; they can only be saved through `add_handover_photo()` (own clean upload, right booking state) and are shown to the partner by a 60 second signed link | `lock_pet_on_confirm()`, `add_handover_photo()`, `handover-photo-url` |
| Fake reviews | A review needs a completed booking, the author must be a participant, and there is one review per side per booking | RLS policy plus a unique constraint |
| Payment fraud | Fees are confirmed only from the payment provider's **signed webhook** (HMAC checked) inside an edge function, never from the app | `paymob-webhook` function |
| SMS pumping (cost attack) | Egypt (+20) only; App Check / Play Integrity / App Attest; limit 3 codes per number per hour and 10 per device per day; Turnstile CAPTCHA on every code request (checked by Supabase Auth itself); a code is used up after 10 wrong guesses, and wrong guesses never block asking for a new code | Auth settings, `request-otp` function |
| Account takeover | Short OTP expiry (5 min); new-device sign-in alert; sign out all devices in Settings | Auth |
| Harassment | Block (hides both ways, stops messages), report, rate limits on messaging new people (20 per day for new accounts) | `blocks` table, policies |
| Admin abuse | Admins are listed in `admins`; every admin action runs through `admin_take_action()`, which writes the audit log; the audit log is insert-only | Migration `0001` |
| Leaked keys | Only the **anon** key ships in the app. The service-role key, the Paymob HMAC secret and the KYC keys live only in Supabase secrets. GitHub secret scanning and push protection are on | `.env.example`, `SETUP.md` |
| Photo abuse | Uploads go to private buckets; images are served by signed URL; EXIF (GPS) is stripped on upload; automatic face check plus human review before a photo is public | Storage policies, `process-upload` function |
| Data breach impact | Least data: no ID images stored, card data never touches our servers, exact location separated, backups encrypted | Architecture |

## Non-negotiable rules for anyone writing code (including Claude Code)

1. Never put the service-role key, a payment secret or a KYC secret in the mobile app or in Git.
2. Never select from `private.*` in client code. Read exact locations only through `get_booking_location()`.
3. Every new table: enable RLS in the same migration, with policies for select, insert, update and delete, or none.
4. Never trust a value from the client for: price, fee status, booking status, user status, role or verification flags.
5. Every admin mutation goes through a security-definer function that writes `audit_log`.
6. Validate input on the server: lengths, enums and dates (end after start, start not in the past, at most 60 nights).
7. Strip EXIF location from every uploaded photo.
8. Log security events (failed OTP, masked contact attempts, blocked sign-ups) without logging message contents or codes.
9. Dependencies: pin versions and enable Dependabot; CI fails on high-severity `npm audit` findings.

## Before launch: security checklist

- [ ] Supabase: RLS enabled on all tables (run the Security Advisor and fix every warning)
- [ ] Supabase: people sign up by phone only (the email provider is on for invited admins; the database refuses any other email sign-up); OTP expiry 300 s; rate limits set
- [ ] Storage buckets private; signed URL expiry 1 hour or less
- [ ] Google Maps keys restricted to app IDs and to the Maps and Places APIs only; budget alert set
- [x] Paymob webhook HMAC verified, and tested with a forged request (must be rejected): `supabase/functions/_shared/payments.test.ts`
- [ ] Test with a modified client: try to read another user's exact location, set your own status to active, review without a booking, and send a phone number in chat. All must fail
- [ ] Penetration test or an independent review of the RLS policies
- [ ] Backups and point-in-time recovery on (paid Supabase plan)
- [ ] Incident plan: who to call, how to revoke keys, how to notify users and the regulator
- [ ] Legal review done (see `docs/legal/README.md`)
