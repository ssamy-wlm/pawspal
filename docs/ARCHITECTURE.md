# PawsPal Dahab: architecture v3 (the "direct" model)

This file replaces the parts of `HANDOVER.md` that it contradicts (accounts, sign-up, verification, fees, bookings, swaps, payments). Where the two disagree, **this file wins**. It is also the contract between the database (`supabase/migrations/0013_*.sql`), the edge functions, the mobile app and the admin site.

## 1. What changed from v2

| Topic | v2 | v3 |
|---|---|---|
| Account types | Owner, Host or Both | **Owner or Host** only, chosen at sign-up. No "both", no swaps. |
| Sign-up | Phone number + SMS code (Egypt only), Turnstile, SMS hook | **Email + password + confirmation link.** Any nationality. No phone, no SMS, no Cloudflare in the app. |
| Verification | Provider (fake or real) checks selfie and ID | **Selfie + ID photo uploaded by the user; the founder approves or rejects by hand** in the admin site within one business day. The ID photo is **deleted right after the decision**. |
| Money to PawsPal | Booking fee per stay (Paymob) | **Registration fee 75 EGP, then 25 EGP every 6 months**, paid **outside the app** (InstaPay or bank transfer). The user shows a reference number or screenshot; the founder confirms in the admin site. |
| Money between users | Handled by the booking fee flow | **Owners and hosts pay each other directly.** The app never touches that money. |
| Booking confirmation | Both accept terms, then pay the fee | **Both accept the terms: the booking is confirmed.** Contact details and the exact address unlock at that moment. |
| Search | Cards, swipe, list, area map | Same, plus a **map of host availability with the price per night on each pin** (MapLibre GL JS + OpenStreetMap, approximate areas only). |
| Disclaimer | none | Shown at sign-up and in the Terms (section 6). |

Unchanged: the safety design (RLS everywhere, server enforces every rule), handover photos, reviews, reports, blocks, emergency, appeals, the admin dashboard with audit log and second step (now a passkey, section 10c), the suspension ladder.

## 2. Accounts and roles

- `profiles.role` is `owner` or `sitter` (the database value `sitter` is the **Host**; screens say "Host"). `both` no longer exists.
- Role is chosen on the sign-up screen and sent as sign-up metadata (`options.data.role`). It is fixed once the profile is submitted (existing trigger `lock_role_after_submit`).
- An owner adds pets and posts travel dates. A host adds a home photo and posts availability. An owner can only request a stay from a host.

## 3. Sign-up and sign-in (email)

1. Sign-up screen: role (Owner / Host), email, password (min 12 characters, upper case, lower case, digit: enforced by Supabase Auth), the **disclaimer** (section 7) with a required checkbox, links to the Terms and Privacy Policy.
2. `supabase.auth.signUp({ email, password, options: { emailRedirectTo: 'pawspal://auth/callback', data: { role, terms_version, device_id } } })`.
3. Supabase emails a confirmation link (custom SMTP, see SETUP). The person cannot sign in until confirmed. The link verifies the email and redirects to `pawspal://auth/callback#access_token=...&refresh_token=...`; the app turns that into a session. If the link is opened on another device, the email is still confirmed and the person signs in with email + password.
4. The database trigger `handle_new_user` (migration 0013) **refuses** the sign-up unless: the role is `owner` or `sitter`; `terms_version` equals the current Terms version (this records the disclaimer acceptance server-side); the email (hashed) and the device (hashed) are not banned. It creates the profile, the membership row, and the `legal_acceptances` rows for `terms` and `privacy`.
5. Sign-in: email + password. "Forgot password": `resetPasswordForEmail(email, { redirectTo: 'pawspal://auth/reset' })`; the app shows a "choose a new password" screen on that deep link.
6. Admin accounts are normal email accounts that are also invited (`private.invite_admin`) and granted (`private.grant_admin`) in the SQL editor, and then sign in with a **passkey** as the second step (section 10c; it replaces the authenticator-app code of phase 8).

## 4. Profile completion, verification, membership

### 4.1 Account state machine (`profiles.status`)

`pending_verification` (signed up, not yet submitted) → `pending_review` (submitted, waiting for the founder) → `active` → `suspended` / `removed`. A **rejection** puts the person back to `pending_verification` with a note, and they upload again.

### 4.2 What the person must complete before submitting (`my_account_state().missing`)

`verification` (a pending or approved selfie + ID request exists), `name`, `pet` (owners), `home` (hosts), `location`, `legal` (the three documents accepted at the current versions; Terms and Privacy are already accepted at sign-up, Community Guidelines on the rules step). Then `submit_profile()` moves them to `pending_review`.

### 4.3 Verification

- Selfie: uploaded raw to `incoming/<uid>/`, then `process-upload` kind `face` (strips metadata) puts a clean copy in bucket `faces`.
- ID photo: same with kind `id` into the private bucket `ids`. **No app user can read the `ids` bucket, not even their own upload.** Only an admin session that passed the passkey step can.
- `submit_verification(p_face_path, p_id_path)` records a `verification_requests` row (`pending`).
- The founder opens **Verification** in the admin site: sees the selfie, the ID photo and the profile, ticks "I checked the person is 18 or older and the photos match", and presses Approve or Reject (a reason is required for Reject).
- `admin_decide_verification(...)` records the decision, sets `face_verified`, `id_verified`, `is_adult` on approval, moves the account to `active` (approval) or back to `pending_verification` (rejection), **clears `id_path`, and returns the ID file path so the admin site deletes the file at once** (`supabase.storage.from('ids').remove`). The nightly clean-up deletes any ID file that is no longer referenced by a pending request (a safety net).
- The selfie stays (it is the profile face photo). The ID photo never outlives the decision.
- Promise shown to users: "We review new accounts within 1 business day."

### 4.4 Membership (registration and renewal)

- Settings (table `app_settings`, edited by the founder in the admin site, readable by every signed-in user): `registration_fee_egp` = 75, `renewal_fee_egp` = 25, `membership_months` = 6, `reminder_days` = 7, `instapay_link`, `instapay_qr_url`, `bank_name`, `bank_account_name`, `bank_account_number`, `bank_iban`, `payment_note` (the last seven are placeholders until the founder fills them in).
- `memberships(user_id, paid_until, reminded_for)`. A new person has `paid_until = null` (registration due). A confirmed payment sets `paid_until = greatest(today, paid_until) + membership_months`.
- **An account is usable only when `profiles.status = 'active'` AND `paid_until >= today`.** `public.is_active(uid)` encodes both, so every existing rule that needs an active person (search, messages, requests, bookings, profile cards) automatically stops working for a paused account. A paused account can still sign in, see its own bookings, pay and contact support.
- Membership state shown to the user (`my_account_state().membership.state`): `unpaid` (registration due), `active`, `due_soon` (7 days or fewer left), `paused` (renewal overdue).
- The user pays outside the app, then `submit_payment_claim(reference, screenshot_path)` (one pending claim at a time). The founder opens **Payments** in the admin site, sees the claim and screenshot, and Confirms or Rejects (`admin_confirm_payment`). The screenshot file is deleted right after the decision (path returned, same as IDs).
- 7 days before `paid_until`: an in-app banner (state `due_soon`) and an email from the `membership-reminders` edge function (daily, secret protected, sends through the email provider; marks `reminded_for`).

## 5. Bookings (no fee, no swaps)

- `request_booking(p_sitter, p_pet, p_starts, p_ends, p_location, p_cost, p_price, p_food)`; `p_cost` is `paid` or `volunteer` (`swap` is gone).
- `propose_terms(...)` resets both acceptances (unchanged). `accept_terms(p_booking, p_version)` returns the booking status; **when both people have accepted it returns `confirmed`**, sets `confirmed_at`, and locks the pet. Contact details and the exact address are then visible (`has_confirmed_booking`, `get_booking_location`).
- Statuses in use: `requested`, `confirmed`, `in_progress`, `completed`, `cancelled`, `disputed`. (`terms_agreed` stays in the database enum but nothing uses it.)
- `cancel_booking(p_booking, p_reason)`: no refunds, no money. The pet unlocks if nothing else holds it.
- Payment between the two people is their own business (InstaPay, cash, anything). The app says so in the booking terms card. Disputes: the founder can review the chat and handover photos (admin site, audited).

## 6. Map of host availability

- `map_availability(p_pet_type, p_limit)` returns one row per open availability post of an active, unblocked host: `availability_id, user_id, first_name, area, approx_lat, approx_lng` (already the rounded point with a fixed offset, about 300 m), `price_per_night` (null = free/volunteer), `offers`, `starts_on, ends_on, pets_accepted`.
- The app renders it with **MapLibre GL JS inside a `react-native-webview`** (no native module, so it ships over the air and works in Expo Go). Each pin is a pill with the price ("250 EGP" or "Free"); tapping a pin opens a small card that links to the host profile. Approximate areas only: no exact location is ever sent to the map.
- Tiles: OpenStreetMap raster tiles by default (`EXIF`-free, attribution "© OpenStreetMap contributors" shown on the map). The tile URL and attribution are configurable (`EXPO_PUBLIC_MAP_TILE_URL`, `EXPO_PUBLIC_MAP_ATTRIBUTION`). OSM's public tile servers are for light use only; before real traffic switch to a provider with a free tier (MapTiler, Stadia Maps) or self-host. SETUP explains how.

## 7. The disclaimer (word for word)

> PawsPal connects pet owners and hosts. PawsPal does not vet, employ or guarantee any host or owner, and arrangements and payments between users are their own responsibility. If a disagreement happens, PawsPal will help where it can, for example by reviewing the chat and handover photos.

It appears (a) on the sign-up screen with a required checkbox, (b) in the Terms of Service, section 6 "Your arrangements with other users". English and Arabic strings go through `t()` (the Arabic is a draft for a native speaker to review).

## 8. Privacy: what is collected now

Email address, password (hashed by Supabase Auth, never stored by us), first name, role, selfie, **ID photo (deleted right after the founder's decision)**, home photo (hosts), pets and their photos, approximate and exact location (exact only in the private schema), chat messages, handover photos, reviews, reports, payment reference and **payment screenshot (deleted right after the founder's decision)**, membership dates, device identifier (hashed, to stop banned people returning), **phase 9: push notification device tokens (up to 5 per person, deleted at sign-out, account deletion, or when the push service says the device is gone) and notification preferences**. No phone numbers, no ID numbers, no card data.

## 9. Database contract (migration 0013)

Everything is `security definer` with `search_path` set, revoked from `public`/`anon`, granted as stated. Names below are the contract; do not rename.

### Tables

| Table | Columns | Who reads | Who writes |
|---|---|---|---|
| `profiles` (changed) | `role user_role ('owner','sitter')`; `phone_verified` is **removed** | as before | as before |
| `memberships` | `user_id pk`, `paid_until date null`, `reminded_for date null`, `created_at` | owner of the row, admins | functions only |
| `verification_requests` | `id uuid`, `user_id`, `face_path`, `id_path null`, `status ('pending','approved','rejected')`, `note`, `submitted_at`, `decided_at`, `decided_by` | owner of the row, admins | functions only |
| `payment_claims` | `id uuid`, `user_id`, `kind ('registration','renewal')`, `amount_egp int`, `reference text null`, `screenshot_path text null`, `status ('pending','confirmed','rejected')`, `note`, `created_at`, `decided_at`, `decided_by` | owner of the row, admins | functions only |
| `app_settings` | `key text pk`, `value text`, `updated_at` | every signed-in user | `admin_set_setting` only |
| `bookings` (changed) | `fee_status`, `opened_by`, `swap_group` are **removed**; `cost_type` is `paid` or `volunteer` | participants, admins | functions only |
| removed | `booking_payments`, all OTP/phone tables and functions, `private.local_switches` | | |

Storage buckets (all private): `faces`, `pets`, `homes`, `handovers`, `ids` (new, admin read only), `payments` (new, admin read only), `incoming` (raw uploads, service role only).

### Functions the app calls (role `authenticated`)

| Function | Returns | Notes |
|---|---|---|
| `my_account_state()` | `jsonb` (below) | replaces `my_signup_state()` |
| `submit_verification(p_face_path text, p_id_path text)` | `uuid` | paths come from `process-upload`; own folder, file must exist |
| `submit_profile()` | `account_status` | needs `missing` to be empty; moves to `pending_review` |
| `get_payment_settings()` | `jsonb` (all `app_settings` keys) | readable even when unpaid |
| `submit_payment_claim(p_reference text, p_screenshot_path text)` | `uuid` | reference or screenshot required; one pending at a time |
| `map_availability(p_pet_type pet_type default null, p_limit int default 200)` | table (section 6) | active callers only |
| `request_booking`, `propose_terms`, `accept_terms`, `cancel_booking`, `get_booking_location`, `get_pet_care` | as before without swap, fee, refund | `accept_terms` may now return `confirmed` |
| unchanged | `search_stays` (no swap offer), `browse_random`, `browse_travellers`, chat, reports, blocks, handover, reviews, shortlist, travel posts, availability | |
| removed | `request_swap`, `confirm_booking_payment`, `refund_preview`, `my_signup_state`, all `*_fee_*`, OTP functions | |

`my_account_state()` returns:

```json
{
  "status": "pending_verification|pending_review|active|suspended|removed",
  "role": "owner|sitter",
  "first_name": "text|null",
  "missing": ["verification","name","pet","home","location","legal"],
  "has_pet": true, "has_home_photo": true, "has_location": true, "legal_accepted": true,
  "verification": { "status": "none|pending|approved|rejected", "note": "text|null" },
  "membership": {
    "state": "unpaid|active|due_soon|paused",
    "kind": "registration|renewal",
    "paid_until": "date|null", "days_left": "int|null",
    "amount_egp": 75,
    "claim_status": "none|pending|rejected", "claim_note": "text|null"
  }
}
```

### Admin functions (role `authenticated`, require `is_admin()` = admin + a session that passed a passkey; all write the audit log)

| Function | Returns | Notes |
|---|---|---|
| `admin_decide_verification(p_user uuid, p_approve boolean, p_adult boolean, p_note text)` | `text` (ID file path to delete, or `''`) | approve needs `p_adult = true`; reject needs a note; the request must be pending and the profile `pending_review` |
| `admin_confirm_payment(p_claim uuid, p_confirm boolean, p_note text)` | `text` (screenshot path to delete, or `''`) | reject needs a note |
| `admin_set_setting(p_key text, p_value text)` | `void` | key must be one of the settings above; numbers validated |
| existing | `admin_take_action`, `admin_set_report_status`, `admin_report_messages`, `admin_decide_appeal`, `admin_remove_photo`, `admin_overview`, `admin_audit_log` | `admin_overview()` also returns `pending_verifications`, `pending_payments`, `expiring_soon`, `paused` |

### Service-role functions (called by edge functions only)

`list_due_reminders()` returns `user_id, email, first_name, locale, paid_until` for people whose `paid_until` is within `reminder_days` and not yet reminded for that date; `mark_reminded(p_user uuid, p_paid_until date)`; `list_unused_uploads(interval)` (now also lists unreferenced files in `ids` and `payments`); `attach_home_photo(p_user, p_path)` (unchanged).

### Edge functions (final list)

`process-upload` (kinds `face`, `id`, `payment`, `pet`, `home`, `handover`), `cleanup-photos`, `handover-photo-url`, `emergency`, `membership-reminders` (new), `admin-passkey` (migration 0014, section 10c). **Removed:** `request-otp`, `verify-otp`, `send-sms`, `verify-identity`, `create-fee-payment`, `paymob-webhook`, `process-refunds`.

### Banned people

Removal bans the **email hash** and **device hash** (kinds `email`, `device` in `banned_identifiers`); sign-up refuses banned ones. Reinstating a removed person lifts only bans that no other removed person still needs. (Limit: a person can sign up with a different email; the device hash is the second line.)

## 10. Admin site (apps/admin) additions

Pages: **Overview** (adds "waiting for verification", "payments to confirm", "renewals due in 7 days", "paused"), **Verification** (replaces Approvals), **Payments** (new), **Settings** (new: payment details and fees), Reports, Users (shows membership and paid-until), Appeals, Bookings, Photo review, Rules, Audit log. The founder is the reviewer (`pawspal@gmail.com`).

## 10b. Web / PWA

The Expo app also builds for the browser (`npm run build:web` in `apps/mobile`, which is `expo export -p web`, single-page output into `dist/`). It is installable (manifest, icons, iPhone start-up pictures, offline page) and hosted as its own Vercel project (`pawspal-app`, root `apps/mobile`, production branch `production`, settings in `apps/mobile/vercel.json`). The iOS and Android apps are unchanged.

- **Page and install files** are in `apps/mobile/public/` (copied as they are): `index.html` is the page template (Expo's `+html.tsx` is not used in single-page output), `manifest.webmanifest`, `sw.js`, `offline.html`, `map-frame.html` and `.js`, and icons made by `scripts/make-web-icons.mjs` from `assets/logo`.
- **Service worker** (`sw.js`): keeps the offline page and icons, hashed files cache-first, pages network-first with the offline page as fallback. It never touches another origin or a non-GET request, so Supabase, storage and map tiles are never cached.
- **Platform splits** (Metro picks `.web` files; the phone bundle never sees them): `src/lib/storage(.web).ts` (keychain on a phone, localStorage with an in-memory fallback on the web), `src/lib/webShell(.web).ts`, `src/components/FaceCapture(.web).tsx`, `MapSurface(.web).tsx`, `InstallPrompt(.web).tsx`.
- **Camera:** web selfie uses the browser camera on https, otherwise (or by choice) the device's camera app / file picker. ID and handover photos use the picker's file input. Uploads accept `blob:` and `data:` addresses. EXIF is still removed on the server.
- **Map:** the same MapLibre page (`src/lib/mapHtml.ts`) is sent into a sandboxed iframe (`/map-frame.html`, `sandbox="allow-scripts"`) by message. The frame has its own policy, so the map host (unpkg) is not allowed on the app page itself.
- **Email links** open the web origin (`<origin>/auth/callback`, `<origin>/auth/reset`); tokens are read from the fragment or query, used, then removed from the address bar. Phones keep `pawspal://`.
- **Language:** `dir` and `lang` on the page follow the saved language; switching reloads the page.
- **Install prompt:** Chrome/Edge/Android use `beforeinstallprompt`; iPhone/iPad show three steps. Hidden when installed; dismissal is remembered on the device.
- Vibration does nothing on the web. Nothing new is collected, so the privacy policy is unchanged (section 8).

## 10c. Admin sign-in: password then passkey (migrations 0014 and 0015)

**Migrations.** `0014_admin_passkeys.sql` is on main and is never edited; the second review (per-session lock-outs, `is_admin()` without an exception block, `list_admin_sessions` and the session-code version of `open_admin_session`, retention) is `0015_admin_passkeys_review2.sql`.

**Why our own.** Supabase's built-in passkey sign-in is experimental, and registering a passkey there needs only a normal session: a stolen password could enrol a rogue passkey, and the database could not tell which credential made a session. So the passkey is implemented here with WebAuthn (`@simplewebauthn/server`, exact version `14.1.0`, imported as `npm:@simplewebauthn/server@14.1.0` in `supabase/functions/admin-passkey/index.ts` and pinned in `supabase/functions/package.json`; a test fails if the two differ). The authenticator-app (TOTP, `aal2`) step is gone; the settings in `supabase/config.toml` are left as they were but nothing relies on them.

### Design

1. The admin signs in with email + password (Supabase Auth). The access token carries a `session_id` claim.
2. The admin site calls the edge function `admin-passkey` with that token. The function checks a passkey (or a recovery code) and asks the database to record "this Supabase session passed": a row in `private.admin_passkey_sessions` (8 hours for a passkey, 30 minutes for a recovery code).
3. `public.is_admin()` (no exception block; every claim is validated with `pg_input_is_valid`, PostgreSQL 16 or newer, the project runs 17) is true only if the caller is in `admins` **and** the JWT's `session_id` has a live, unexpired row for the same user **and** that Supabase session still exists in `auth.sessions` (signing out or revoking the session ends admin rights at once). A missing or malformed claim (or a garbage `sub`) is `false` (the function never raises). There is no `aal` check any more.
4. An expired or signed-out Supabase session makes its row useless; the row is also deleted on sign-out and when the passkey that opened it is removed. Everything else the admin site does (`admin_*` functions, the audit log, the `ids`/`payments` buckets) keeps calling `is_admin()`, so nothing else changed.

**Registering a passkey is never possible with a password alone.** It needs one of: a one-time **setup code** from the founder (first sign-in, or after everything was lost), a session already verified by a passkey (adding a device), or a **recovery** session (that is how lost-device recovery ends). The setup code is checked when the options are asked for and used up atomically with saving the passkey (a failed proof never burns it).

**Where this differs from the first design (found while building):**
- The user handle in the passkey is derived (`sha256("pawspal-admin-passkey:" + user id)`), so it is stable per user and holds no email or personal data.
- `pk_check_setup_code` was added (checks without using up) and `pk_add_credential` takes the setup code and uses it up in the same transaction.
- **Lock-outs.** Failures are counted in `private.admin_passkey_events` (keyed by the auth user id and the Supabase session id, so an admin without a profile row is counted too). 5 failures an hour of any kind from one session lock that session. Wrong recovery codes and wrong setup codes also count per user (100 an hour). **Passkey failures (`login_failed`, including a missing challenge) never count per user**, so someone with only the password cannot lock the other sessions out by spamming login. A session that is already verified is held back only by its own failures. The checks run under `pg_advisory_xact_lock` per admin, and once a session is locked further `login_failed` notes add no rows. Failed-login rows in `security_events` and `audit_log` are pruned after 30 days. **Manual unlock:** `private.new_admin_setup_code` and `private.reset_admin_passkeys` clear the admin's failures; or wait an hour.
- **Step-up for sensitive actions.** A stolen access token must not be enough to add or remove a passkey, rename one or make recovery codes. These need a fresh passkey proof on the session (`step_up_options` + `step_up_verify`, valid 5 minutes; a login or registration also counts as fresh). Without it the answer is `403 {"error":"step_up_required"}` (the only refusal with its own body). Exempt: registration with a founder setup code, and a recovery session registering a new passkey (it has no passkey proof to give; it still cannot rename, remove or make codes).
- `pk_use_recovery_code` uses the code and starts the 30 minute session in one transaction (a failure cannot lose a code), and does nothing on a session already verified by a passkey.
- `private.revoke_admin` (0010) now also deletes that user's passkeys, sessions, recovery codes, setup codes and failures.
- Removing a passkey also ends every session it opened (foreign key `on delete cascade`), so removing a stolen device cuts its access at once. Removing the passkey you are signed in with therefore signs you out of the admin area.
- A recovery login never replaces a live passkey session.
- The audit/security-event details are filtered to a few harmless keys (`name`, `via`, `reason`, `device_type`, `backed_up`, `count`), so no code or credential can end up there even by mistake.
- The edge function also refuses a request whose `Origin` header is not `ADMIN_ORIGIN` (defence in depth; a browser always sends it).

### Tables (schema `private`: RLS on, no policies, no grants to `anon` or `authenticated`)

| Table | Holds |
|---|---|
| `admin_passkeys` | `id`, `user_id`, `credential_id` (unique), `public_key` (base64url COSE), `counter bigint`, `transports`, `device_type`, `backed_up`, `name` (1 to 40 chars), `created_at`, `last_used_at`. At most 10 per admin. |
| `admin_passkey_challenges` | one live challenge per (user, session, purpose `register`/`login`/`stepup`), valid 5 minutes, consumed by `delete ... returning` (single use) |
| `admin_passkey_sessions` | `session_id` (primary key), `user_id`, `passkey_id` (null for recovery), `via` (`passkey`/`recovery`), `expires_at`, `step_up_until` |
| `admin_passkey_events` | failed attempts (`login_failed`, `recovery_failed`, `setup_code_failed`) with the auth user id and the Supabase session id, for the lock-outs |
| `admin_setup_codes` | one per admin: sha256 hash, 15 minutes, `used_at` |
| `admin_recovery_codes` | ten per admin: sha256 hashes, `used_at` |

Codes are 12 (setup) or 16 (recovery, shown as `XXXX-XXXX-XXXX-XXXX`, 80 bits) random characters from the 32-character alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0, O, 1, I). They are stored only as sha256 of the upper-cased letters and digits. Expired rows are pruned when new ones are made and nightly by `pg_cron` (`private.pk_prune`, job `prune-admin-passkeys`).

### Functions

Public, for the signed-in person: `is_admin()`, `admin_status()` returning `not_admin` | `needs_setup` (admin with no passkey: ask the founder for a setup code) | `needs_passkey` (has one, this session has not used it) | `admin`. The browser never changes passkeys through SQL; it talks to the edge function.

Service-role only (revoked from `public`, `anon`, `authenticated`; the edge function passes the user and session from the verified JWT, never from the body): `pk_state`, `pk_new_challenge`, `pk_take_challenge`, `pk_check_setup_code(user, session, code)`, `pk_take_setup_code`, `pk_add_credential` (max 10, unique credential id, name check, optional setup code used up in the same transaction), `pk_credentials`, `pk_credential`, `pk_use_counter` (clone detection: the counter must grow when either side is non-zero; 0 to 0 is accepted for synced passkeys), `pk_start_session`, `pk_set_step_up`, `pk_end_session`, `pk_replace_recovery_codes` (exactly ten; replaces all older), `pk_use_recovery_code(user, session, hash)` (returns `{status: ok|bad|locked|already, expires_at}`; `ok` also starts the 30 minute recovery session), `pk_rename`, `pk_remove` (refuses the last passkey), `pk_note(user, kind, details, session)` (`login_failed` also counts against the lock-out; writes `security_events` and `audit_log` rows `admin_setup`, `admin_passkey_added`, `admin_passkey_removed`, `admin_passkey_renamed`, `admin_passkey_login`, `admin_recovery_used`, `admin_recovery_generated`, `admin_login_failed`).

**Founder break-glass** (Supabase SQL editor only, not granted to any role, not even `service_role`): `private.new_admin_setup_code(email)`, `private.reset_admin_passkeys(email)`, `private.list_admin_sessions(email)`, `private.open_admin_session(email, short_id, minutes)`, `private.list_admins()`. The statements are:

```sql
select * from private.list_admins();                           -- who is an admin, how many passkeys
select private.new_admin_setup_code('admin@example.com');     -- a 12-character code, shown once, valid 15 minutes
select private.reset_admin_passkeys('admin@example.com');     -- both devices AND all recovery codes lost: forget them all, then make a new setup code
select * from private.list_admin_sessions('admin@example.com');          -- sessions of the last 24 hours with short_id, ip, browser
select private.open_admin_session('admin@example.com', 'a1b2c3d4', 30);  -- the edge function is down / not deployed / secrets missing (see below)
```

**Edge function down or not set up yet.** (1) The founder signs in on the admin site with email and password; the "Use your passkey" screen shows the **8-character code** of that Supabase session (the first 8 characters of its id). (2) In the SQL editor: `select * from private.list_admin_sessions('admin@example.com');` shows the admin's sessions of the last 24 hours with `short_id`, IP address and browser: find the row with that code. (3) `select private.open_admin_session('admin@example.com', '<code>', 30);` marks exactly that session as a verified recovery session for 1 to 30 minutes (the usual recovery banner; it can do everything except rename, remove or make codes for passkeys). It refuses when the code matches no session or more than one, so a newer session of someone who only has the password is never picked by mistake. The IP address and browser of the chosen session are written to the audit log (`admin_session_opened`) and returned. (4) Reload the site.

**Manual unlock after a lock-out:** a new setup code (`new_admin_setup_code`) or a reset (`reset_admin_passkeys`) clears the admin's failed attempts at once; otherwise the lock ends an hour after the last failure.

### The edge function `admin-passkey`

Settings (Supabase Edge Function secrets): `ADMIN_RP_ID` (the admin site's domain, for example `admin.pawspal.example`, no scheme), `ADMIN_ORIGIN` (its exact address, `https://admin.pawspal.example`: one origin, no path, https; `http://localhost` is allowed for local work; its host must be `ADMIN_RP_ID` or a subdomain), `ADMIN_RP_NAME` (the name the passkey prompt shows). Any missing or inconsistent value answers `503 {"error":"not_configured"}`. `verify_jwt = true` in `supabase/config.toml`.

**RP ID caveat:** a passkey is bound to the website address it was made for. Moving the admin site to a new domain makes every old passkey useless: change the three settings, then each admin gets a setup code from the founder and registers again.

**Request:** `POST` JSON `{"action": "...", ...}` with `Authorization: Bearer <the admin's access token>` (and the usual `apikey` header). CORS: `OPTIONS` is answered; `Access-Control-Allow-Origin` is sent **only** for `ADMIN_ORIGIN` (headers `authorization, content-type, apikey, x-client-info`; methods `POST, OPTIONS`; `Vary: Origin`). A request from another origin gets `403` and no CORS headers. Bodies over 16 KiB are refused. Nothing (tokens, codes, challenges, credential data) is logged.

**Answers.** Success is `200 {"ok": true, ...}`. Errors are `{"error": "<code>"}`:

| HTTP | `error` | When |
|---|---|---|
| 400 | `invalid_request` | bad JSON, bad field, unknown action (for an admin) |
| 400 | `passkey_limit` | ten passkeys already |
| 401 | `unauthorized` | no token, a bad token, or a token without a `session_id` |
| 403 | `not_allowed` | **every** refusal: not an admin, no gate, wrong code, failed WebAuthn proof, not verified via a passkey, other origin. One body, so nothing is revealed |
| 404 | `not_found` | `rename`/`remove`: no such passkey of yours |
| 409 | `last_passkey` | `remove` of the only passkey |
| 409 | `already_registered` | the same authenticator again |
| 403 | `step_up_required` | `register_options`/`register_verify` (without a setup code), `rename`, `remove`, `recovery_generate` from a passkey session that has not given a fresh passkey proof in the last 5 minutes: call `step_up_options` + `step_up_verify`, then retry. Never sent to a caller who is not verified (they get `not_allowed`) |
| 429 | `too_many_attempts` | 5 failures an hour from this session (failed passkey proofs, wrong recovery or setup codes), or 100 wrong recovery/setup codes for the user; a verified session is held back only by its own failures |
| 502 | `try_again_later` | the database or the library failed |
| 503 | `not_configured` | settings missing |

Every action first needs the caller to be in `admins` (otherwise `403 not_allowed`).

| `action` | Body (besides `action`) | Allowed when | Success body |
|---|---|---|---|
| `status` | none | any admin | `{ok, step_up: bool, status: "needs_setup"\|"needs_passkey"\|"admin", verified: bool, via: "passkey"\|"recovery"\|null, passkeys: [{id, name, created_at, last_used_at, device_type, backed_up}], recovery_codes_left: int}` |
| `register_options` | `name?` (1 to 40), `setup_code?` | a valid `setup_code`, **or** a verified session (a passkey session also needs a fresh step-up, else `step_up_required`; a recovery session does not) | `{ok, options}`: pass `options` to `startRegistration({optionsJSON: options})` of `@simplewebauthn/browser`. rp `{id, name}`, attestation `none`, `userVerification: required`, `residentKey: preferred`, existing passkeys excluded, challenge valid 5 minutes |
| `register_verify` | `response` (the browser's registration response), `name?`, `setup_code?` (the same one, when that was the gate) | as above | `{ok, passkey: {id, name}, session: {via: "passkey", expires_at}}`. The session is now verified for 8 hours. A setup code is used up here. Default name is `Passkey YYYY-MM-DD` |
| `step_up_options` | none | session verified **via passkey** | `{ok, options}`: like `login_options` (purpose `stepup`); pass to `startAuthentication({optionsJSON: options})` |
| `step_up_verify` | `response` (the browser's authentication response) | via passkey | `{ok, until}`: sensitive actions are allowed on this session until `until` (5 minutes). A login or a registration also gives a fresh step-up |
| `login_options` | none | at least one passkey | `{ok, options}`: pass to `startAuthentication({optionsJSON: options})`. `userVerification: required`, `allowCredentials` from the database |
| `login_verify` | `response` (the browser's authentication response) | at least one passkey | `{ok, session: {via: "passkey", expires_at}}` |
| `recovery_login` | `code` (any case, spaces or dashes allowed) | any admin; on a session already verified by a passkey it does nothing and uses no code | `{ok, session: {via: "recovery", expires_at}}` (30 minutes; the code and the session are one database step). A recovery session may read status, register a new passkey and sign out, nothing else of the passkey area |
| `recovery_generate` | none | session verified **via passkey** + fresh step-up | `{ok, codes: ["XXXX-XXXX-XXXX-XXXX", ... 10]}`: shown once, replaces every older code |
| `rename` | `id` (uuid), `name` (1 to 40) | via passkey + fresh step-up | `{ok}` |
| `remove` | `id` (uuid) | via passkey + fresh step-up | `{ok}`; the passkey's sessions end with it (call `status` again; the current session may be gone) |
| `sign_out` | none | any admin | `{ok}`; also call `supabase.auth.signOut()` |

A challenge is single use and tied to the user, the session and the purpose, so an answer cannot be replayed or moved to another session. A failed `login_verify` or `register_verify` writes a generic `admin_login_failed` audit row (with a short reason such as `verify`, `challenge`, `unknown_credential`, `counter`; never the library message).

### Login screen flow for the admin site
`signInWithPassword` → `admin_status()` (SQL) → `not_admin`: sign out. `needs_setup`: ask for the setup code, `register_options` + `register_verify`, then show recovery codes (`recovery_generate`) once. `needs_passkey`: `login_options` + `login_verify` (or `recovery_login`). `admin`: continue; refresh the token is not needed because the session id stays the same.

### Residual risks
Someone with **both** the password and an unused recovery code (or the founder's setup code) can enrol a passkey of their own: keep recovery codes offline, regenerate them after using one, and watch the audit log for `admin_passkey_added` and `admin_recovery_used`. Whoever controls the founder's Gmail or the Supabase account can reset passkeys and issue setup codes (break-glass runs in the SQL editor), so those two accounts need their own strong second factor. A password holder can make **unverified** sessions of an admin return 429 for up to an hour by failing on purpose (a lock-out, not a break-in: it cannot touch a session that is already verified, and the founder clears it with a new setup code or a reset). The admin site keeps the Supabase session in browser storage and its content-security policy needs `'unsafe-inline'` (a Next.js limit), so a cross-site-scripting bug there could steal an access token; step-up (a fresh passkey proof for enrolling, removing, renaming and recovery codes), the 8 hour passkey session and the `auth.sessions` check limit what a stolen token can do. Recommended on a Pro plan: Supabase session timebox and inactivity timeout (`[auth.sessions]` in `supabase/config.toml`, commented hints only).

## 11. Phase 9: account deletion, data export, push notifications (migrations 0017 and 0018)

### 11.1 Settings (`app_settings`, edited with `admin_set_setting`, validated server side)

| Key | Default | Meaning |
|---|---|---|
| `push_enabled` | `false` | The server switch. While `false` nothing is queued and nothing is sent. `true` or `false` only |
| `deletion_grace_days` | `30` | Days between "delete my account" and the final purge (1 to 365). **Placeholder** for the privacy policy's `[30]`: the founder and the lawyer confirm it |
| `shared_history_months` | `24` | Messages and bookings older than this are deleted for everyone by the nightly job (1 to 120). **Placeholder** for the policy's `[24]` months |

These three are not readable by the app (the `app_settings` read policy and `get_payment_settings()` leave them out); an admin session that passed the passkey step can read them. The admin site's Settings page lists settings from its own code (`apps/admin/src/rules.ts`), so it still needs fields for them; until then use the SQL editor.

### 11.2 Account deletion

**Decision: the deleted person becomes an anonymised stub.** The `profiles` row stays with the same opaque id: `first_name = 'Deleted user'`, no bio, area, location, photo or role-specific data, `status = 'removed'`, `deleted_at`, `purge_after`, later `purged_at`. Only the sign-in account (`auth.users`) is deleted, at the purge. *Why not a null or tombstone participant:* `bookings.owner_id/sitter_id`, `conversations.user_a/user_b`, `messages.sender_id`, `reviews`, `reports` and about thirty functions, views and policies assume a real participant; making each nullable would touch every one of them and every test. The stub keeps all of them working unchanged and is the smaller, safer change. What changed to allow it: `profiles.id` no longer has a foreign key to `auth.users` (a trigger `on_auth_user_deleted` deletes the profile of an ordinary auth user exactly as the old cascade did, and keeps a closed account's stub); `payment_claims.user_id` is nullable (`on delete set null`); `reviews.booking_id` is nullable (`on delete set null`, so reviews outlive a deleted booking); a trigger refuses any change of `status`, `deleted_at` or `purge_after` on a closed profile (so `admin_take_action` can never reinstate or approve it) another refuses messages to a closed account, and the stub is read only for the closed person's own old access token: the profile update policy needs `deleted_at is null`, the profile guard rejects any column change from a signed-in role, and `refuse_closed_account_write` (locations, pets, legal acceptances, appeals, blocks, read marks, vet details) plus the raw-upload storage policy refuse writes by or for a closed account.

**Step 1, immediately (`delete-account` edge function, then `close_account(p_user)`):** the password is checked again. The try is **reserved first** (`reserve_password_attempt`: under a lock per person and kind it counts and records the try in `security_events`, kinds `delete_attempt` and `export_attempt`, 5 an hour, so parallel requests cannot beat the limit); a right password gives its try back, a wrong one keeps it. Admins are refused; a person with a booking in `requested`, `confirmed`, `in_progress` or `disputed` is refused (`active_booking`: cancel or resolve first); a person with an unresolved report against them or an unresolved appeal is refused (`open_case`: the team must resolve it first, so evidence is never wiped by deleting). Sessions are ended and the ban set only after the database closed the account (a refused deletion never signs anyone out). Then in one transaction: the profile becomes the stub; availability and travel posts, shortlist (both ways), blocks (both ways), alerts to the person, read marks, handover photo rows, exact location, push tokens, notification preferences and outbox, verification requests (they hold selfie and ID paths) are deleted; a pending payment claim is rejected and every screenshot path cleared; pets in a kept booking become empty shells (`Pet`, no notes, no photo, `photo_paths = {'deleted'}`) and their vet details are deleted, other pets are deleted; an audit row `account_deleted` (opaque id and the grace days only) is written; a person who was ever sanctioned (removed, suspended now, any enforcement action or an open report) has their email and device ban hashes written to `banned_identifiers` (idempotent); a person with no sanction keeps nothing. Then the function ends every session, bans the Auth user for about 100 years (sign-in is refused, refresh fails) and deletes every photo file in the person's folders (`list_user_files`). The person disappears from search, the map, chat lists, profile cards and reviews lists because `is_active()` is false. The e-mail address stays reserved until the purge.

**Step 2, nightly (`purge-accounts` edge function, then `purge_deleted_accounts()`):** for accounts whose `purge_after` has passed (at most 50 per run): legal acceptances, membership, security events, device fingerprints, push data and verification requests are deleted; `payment_claims.user_id` is set to null (**kept: amount, date, reference**); `auth.users` is deleted (sessions, identities and tokens cascade); `account_purged` is audited. **Kept:** the ban hashes (`banned_identifiers`, which hold only hashes), `audit_log`, payment records, and everything shared (see below). Moderation records (reports, enforcement actions, appeals) stay attached to the opaque stub id.

**Shared history for the other person.** Their bookings, conversations, messages and reviews with the deleted person stay. `my_conversations()` still lists the conversation, now with the name "Deleted user" (read only: sending is refused). Bookings screens must show a missing profile card as "Deleted user". The same job deletes, for everybody, messages older than `shared_history_months`, empty conversations older than that, and bookings that ended longer ago than that (not `disputed` ones; their handover photo rows go with them, the files in the next clean-up; reviews stay with `booking_id` null). A conversation, its messages and a booking named by an unresolved report (or between the two people of one, or of a person with an unresolved appeal) are kept until the case is resolved (`private.case_protected`). The handover photo files of deleted bookings are returned by the purge and deleted by `purge-accounts`. A stub is deleted for good when nothing points to it any more (no booking, conversation, review, report, enforcement action or appeal).

**Not done yet (open):** the policy's `[36]` months for moderation and audit records is not enforced, so stubs with reports or actions stay; `audit_log` and `security_events` of other people are not pruned. The Arabic notification sentences are drafts for a native speaker.

### 11.3 Data export

`export_user_data(p_user)` (service role only) returns one json document: profile (no flags the person cannot see), exact location, pets with vet details, availability, travel posts, shortlist (opaque host ids), bookings (terms, dates, status, opaque other id), conversations with all messages (as stored, so contact details are masked exactly as in the app; the other person's first name only when the app would show it), reviews written and received, reports the person made (never reports against them), blocks they made, alerts received, own handover photo metadata, legal acceptances, membership dates, payment claims (reference and status; a note only when it was a refusal), verification requests (a note only when rejected), enforcement actions and appeals addressed to them, notification preferences, push devices (platform and dates, no tokens) and `files` (bucket and path of the person's own photos). Never: admin notes, hashes, security events, audit log, other people's private data. The `export-my-data` function removes `files` from `data` and returns signed links (1 hour) only for paths inside the caller's own folder. The caller must type the password again (same atomic 5-an-hour budget, kind `export_attempt`). Limit: 3 exports a day (`note_data_export`).

### 11.4 Push notifications

Tables `push_tokens` (unique token, at most 5 per person, oldest dropped; a device that signs in as someone else moves to them), `notification_prefs` (messages, bookings, membership, verification; all true by default) and `notification_outbox`: RLS on, no policy, no grant to the app. The app uses only the RPCs in section 11.5. Events queue a notification through `private.enqueue_notification`, which never raises and does nothing unless: the switch is on, the person is not suspended or removed (messages, bookings and reminders also need an active, paid-up account; verification and payment decisions reach people who are not active yet), the preference allows it, the person has a token, no notification for the same thing is already waiting (ten messages make one) and fewer than 20 are waiting. Events: a new message (to the other person; type `message`, id = conversation id), a booking request, changed terms, a confirmed or cancelled booking (to the other person, not the one who acted; type `booking`, id = booking id), a membership renewal reminder (piggybacks on `mark_reminded`, so the daily reminder job's list; type `membership`, id null), a verification decision (pref `verification`) and a payment decision (pref `membership`) (type `account`, id null). Content is title `PawsPal` and one of: "You have a new message", "There is news about your booking", "Your membership renews soon", "We have news about your account" (Arabic by `profiles.locale`). Never a name, date, price or text. `send-notifications` claims up to 100 rows (`claim_notifications`, retry after 2, 4, 8, 16 minutes, failed after 4 tries, expired after a day), sends one message per device (at most 5) in requests of 100, removes tokens answered `DeviceNotRegistered`, and marks rows done. Limit: Expo push *receipts* are not polled, so a token that only fails at receipt time is removed only when it has not been seen for 180 days.

### 11.5 Contract for the app

| Call | Arguments | Returns / errors |
|---|---|---|
| `rpc register_push_token` | `p_token text` (`ExponentPushToken[...]`), `p_platform` (`ios` or `android`) | void. Errors: not signed in, `not allowed` (suspended or removed), `invalid token`, `invalid platform`. Call at every launch (refreshes `last_seen_at`) |
| `rpc unregister_push_token` | `p_token text` | void. Call on sign-out |
| `rpc my_notification_prefs` | none | `{messages, bookings, membership, verification}` booleans |
| `rpc set_notification_prefs` | `p_prefs jsonb`, any subset of the four keys with true or false | the full prefs; error `invalid preferences` for unknown keys or non-booleans |
| `POST /functions/v1/delete-account` | bearer token, `{password}` | `200 {ok:true, purge_after}`; `400 invalid_request`, `401 unauthorized`, `401 wrong_password`, `403 admin_account`, `409 active_booking`, `409 open_case`, `429 too_many_attempts`, `502 try_again_later`. After 200 the session is dead: go to the goodbye screen and clear local data |
| `POST /functions/v1/export-my-data` | bearer token, `{password}` | `200 {ok:true, exported_at, data, files:[{kind, name, url}]}`; `400 invalid_request`, `401 wrong_password`, `429 too_many_attempts` (5 password tries an hour or 3 exports a day), `404 not_found`, `502 try_again_later` |

Notification tap data: `{type: 'message'|'booking'|'membership'|'account', id: uuid|null}`. A deleted person shows as first name "Deleted user" in `my_conversations()`; a booking whose other person is missing from `profile_cards` is "Deleted user" too.

## 12. Rules every part must follow

CLAUDE.md applies in full: server enforces everything; no secrets in the app; theme tokens only; every string through `t()` in English and Arabic; no exclamation marks except "Booking confirmed"; never log message text, codes, ID data or exact locations; 44 pt touch targets; new tables get RLS and tests in the same migration.
