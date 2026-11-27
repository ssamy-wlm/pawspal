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
| Fake membership payment | Membership payments happen outside the app; **a person confirms each one by hand** in the admin site (audited); the app never changes a membership itself; payment screenshots are readable only by an admin session that passed the passkey step and are deleted after the decision | `admin_confirm_payment()`, `payment_claims` |
| Email bombing and bot sign-ups | Supabase Auth email rate limits (set them after custom SMTP is on), password rules, email confirmation required before any access, a new account can do nothing until a person approves it. Open risk: no CAPTCHA on sign-up; add one if abuse appears | Auth settings |
| Account takeover | Strong password rules (12+ characters, upper, lower, digit), email confirmation, password reset by email link, sign out all devices in Settings | Auth |
| Harassment | Block (hides both ways, stops messages), report, rate limits on messaging new people (20 per day for new accounts) | `blocks` table, policies |
| Admin abuse | Admins are listed in `admins`; every admin action runs through `admin_take_action()`, which writes the audit log; the audit log is insert-only | Migration `0001` |
| Admin password stolen | **Second step is a passkey** (Face ID, fingerprint, Windows Hello; user verification required). `is_admin()` is true only for a Supabase session with a live row in `private.admin_passkey_sessions`, which only the `admin-passkey` edge function can write after checking the WebAuthn proof. A password alone can neither read admin data nor enrol a passkey: that needs a founder setup code, an already verified session or a recovery session | `is_admin()`, `private.admin_passkey_*`, `admin-passkey`, ARCHITECTURE 10c |
| Admin loses a device | At least one passkey must remain; add a second device; ten one-time **recovery codes** (80 bits each, stored hashed, shown once, new codes replace all old ones) open a 30 minute recovery session that can only register a new passkey; removing a passkey ends the sessions it opened | `pk_use_recovery_code`, `pk_remove` |
| Guessing recovery or setup codes, cloned passkey | Failures are counted per Supabase session (5 an hour, any kind) and wrong recovery or setup codes also per user (100 an hour); passkey failures never lock other sessions, and a verified session is held back only by its own failures; checks run under an advisory lock per admin; a lock-out answers 429 and is cleared by the founder's new setup code or reset; the passkey counter must grow (clone detection); every failure is a security event and an audit row (failed-login rows are deleted after 30 days); challenges are single use, 5 minutes, bound to user, session and purpose | `pk_*` helpers, `admin-passkey` |
| Stolen access token | `is_admin()` also needs the Supabase session to exist (`auth.sessions`) and an 8 hour passkey session; enrolling, removing, renaming passkeys and making recovery codes need a **step-up** (a fresh passkey proof in the last 5 minutes, else `step_up_required`) | `is_admin()`, `admin-passkey` |
| Everything lost (both devices and all codes), or the edge function is down | **Break-glass for the founder, SQL editor only**: `private.new_admin_setup_code(email)`, `private.reset_admin_passkeys(email)` (audited, both clear the lock-out), `private.list_admin_sessions(email)` and `private.open_admin_session(email, short_id, minutes)` (sign in with the password first; the founder matches the 8-character session code shown on the site, then that one session becomes a recovery session for 1 to 30 minutes; refuses no or several matches; IP and browser audited), `private.list_admins()`; `private.revoke_admin` wipes passkey data; none granted to any role | Migration `0014` |
| Leaked keys | Only the **anon** key ships in the app. The service-role key, the email provider key and the reminder secret live only in Supabase secrets. GitHub secret scanning and push protection are on. | Secrets |
| Photo abuse | Uploads go to private buckets; images are served by signed URL; EXIF (GPS) is stripped on upload; automatic face check plus human review before a photo is public | Storage policies, `process-upload` function |
| Account deletion abused (a stolen session deletes the account) | `delete-account` checks the **password again** server side (separate non-persisting client, never logged), 5 wrong tries an hour per person are blocked first; admins and people with an open booking are refused; the account is closed at once (`close_account`, a closed profile can never be reactivated, even by an admin tool), sessions end, the sign-in is banned. Final purge after `deletion_grace_days`; ban hashes, payment records, audit log kept | `close_account`, `purge_deleted_accounts`, `guard_deleted_profile`, `delete-account`, `purge-accounts` |
| Data export leaks someone else's data | `export_user_data(p_user)` is service role only, takes the id from the verified token, contains only the caller's own data (other people as opaque ids, and a first name only where the app shows it), no admin notes, hashes or security events; photo links are signed for 1 hour and only for paths in the caller's own folder; 3 exports a day | `export_user_data`, `note_data_export`, `export-my-data` |
| Push notifications leak or spam | Tokens, preferences and the outbox have RLS and no grant (reachable only through four RPCs and the service role); content is generic (fixed sentences, opaque ids, never names, dates, prices or message text); nothing is queued or sent while `push_enabled` is `false`; `send-notifications` proves itself with `NOTIFICATIONS_SECRET` (constant time) and never logs tokens or bodies; one waiting notification per thing, 20 waiting per person, 5 devices per person | `push_tokens`, `notification_prefs`, `notification_outbox`, `send-notifications` |
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
9. Dependencies: pin versions and enable Dependabot; CI fails on high-severity `npm audit` findings (also in `supabase/functions`, where `@simplewebauthn/server` is pinned to one exact version in `package.json` and in the Deno import).
10. Admin passkeys: the user id and the session id used by `admin-passkey` come only from the verified JWT; never put a code, challenge, credential or token in a log, an audit row or a response other than the one that must show it once (setup code in the SQL editor, recovery codes in `recovery_generate`).

## Web session storage (the web app)

On a phone the sign-in session lives in the secure keychain. A browser has no keychain, so the web app keeps the session (and the language and theme choices) in `localStorage`. The trade-off: any script that runs on the page could read it, so a cross-site scripting (XSS) bug would be much more serious on the web. The defence is to make sure no foreign script can run:

- The strict Content Security Policy in `apps/mobile/vercel.json` is **required**: `script-src 'self'` (no inline script, no `unsafe-eval`, no third-party host), `connect-src` only this site and `*.supabase.co`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`. `scripts/check-web-build.mjs` and the jest tests fail if it is loosened.
- No third-party scripts, analytics or widgets on the app page. The map runs in a sandboxed iframe (`/map-frame.html`, scripts only, no storage or cookies, its own policy that alone allows the pinned MapLibre file with its integrity hash).
- If the browser refuses storage, the session is kept in memory for that tab only.
- Sign-in and reset links put tokens in the address; the app uses them once and removes them from the address bar. The service worker never caches pages or any cross-origin or non-GET request.
- Camera and location are allowed for this site only (`Permissions-Policy`).

## Admin passkeys: residual risks

- Someone with **both** the password and an unused recovery code (or a founder setup code before it is used) can enrol their own passkey. Recovery codes live offline; generate new ones after using one; watch `admin_passkey_added` and `admin_recovery_used` in the audit log.
- Whoever controls the founder's Gmail or the Supabase account can reset passkeys and issue setup codes. Both need their own strong second factor.
- A password holder can lock **their own** sessions out by failing on purpose, and can burn the shared budget of 100 wrong recovery or setup codes an hour to block code entry for the admin (denial, not access); passkey failures never lock other sessions, already verified sessions are unaffected, and the founder clears it with a new setup code or `reset_admin_passkeys`.
- The admin site keeps the session token in browser storage and its content-security policy needs `'unsafe-inline'` (a Next.js limit; no nonce yet). A cross-site-scripting bug there could steal a token. Mitigations: step-up for sensitive actions, 8 hour passkey sessions, the `auth.sessions` check, and the Supabase session timebox and inactivity timeout (a Pro-plan setting, hints in `supabase/config.toml` `[auth.sessions]`, not enabled here).
- Passkeys are bound to the admin site's address (`ADMIN_RP_ID`); a domain change means everyone re-enrols with a setup code.
- Syncing passkeys (iCloud Keychain, Google Password Manager) widens the attack surface to those accounts; the counter check cannot see a synced clone (they report 0).

## Before launch: security checklist

- [ ] Admin site: `ADMIN_RP_ID`, `ADMIN_ORIGIN`, `ADMIN_RP_NAME` set as Edge Function secrets; every admin has two passkeys and offline recovery codes; one founder setup code tested
- [ ] Supabase: RLS enabled on all tables (run the Security Advisor and fix every warning)
- [ ] Supabase: email provider on with "Confirm email" on; custom SMTP set up (Resend); password policy 12+ with upper, lower, digit; the email sending rate limit set; redirect URLs `pawspal://auth/callback` and `pawspal://auth/reset` allowed
- [ ] Storage buckets private; signed URL expiry 1 hour or less
- [ ] Google Maps keys restricted to app IDs and to the Maps and Places APIs only; budget alert set
- [x] An ID photo or payment screenshot is deleted right after the decision, and nobody but an admin session that passed the passkey step can read those buckets (tests in `supabase/tests/signup_assertions.sql`, `membership_assertions.sql`)
- [ ] Test with a modified client: try to read another user's exact location, set your own status to active, review without a booking, and send a phone number in chat before a booking is confirmed. All must fail
- [ ] Penetration test or an independent review of the RLS policies
- [ ] Backups and point-in-time recovery on (paid Supabase plan)
- [ ] Incident plan: who to call, how to revoke keys, how to notify users and the regulator
- [ ] Legal review done (see `docs/legal/README.md`)
