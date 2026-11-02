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

Unchanged: the safety design (RLS everywhere, server enforces every rule), handover photos, reviews, reports, blocks, emergency, appeals, the admin dashboard with audit log and second factor, the suspension ladder.

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
6. Admin accounts are normal email accounts that are also invited (`private.invite_admin`) and granted (`private.grant_admin`) in the SQL editor, and then need the authenticator code (unchanged from phase 8).

## 4. Profile completion, verification, membership

### 4.1 Account state machine (`profiles.status`)

`pending_verification` (signed up, not yet submitted) → `pending_review` (submitted, waiting for the founder) → `active` → `suspended` / `removed`. A **rejection** puts the person back to `pending_verification` with a note, and they upload again.

### 4.2 What the person must complete before submitting (`my_account_state().missing`)

`verification` (a pending or approved selfie + ID request exists), `name`, `pet` (owners), `home` (hosts), `location`, `legal` (the three documents accepted at the current versions; Terms and Privacy are already accepted at sign-up, Community Guidelines on the rules step). Then `submit_profile()` moves them to `pending_review`.

### 4.3 Verification

- Selfie: uploaded raw to `incoming/<uid>/`, then `process-upload` kind `face` (strips metadata) puts a clean copy in bucket `faces`.
- ID photo: same with kind `id` into the private bucket `ids`. **No app user can read the `ids` bucket, not even their own upload.** Only an admin session that passed the authenticator code can.
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

Email address, password (hashed by Supabase Auth, never stored by us), first name, role, selfie, **ID photo (deleted right after the founder's decision)**, home photo (hosts), pets and their photos, approximate and exact location (exact only in the private schema), chat messages, handover photos, reviews, reports, payment reference and **payment screenshot (deleted right after the founder's decision)**, membership dates, device identifier (hashed, to stop banned people returning). No phone numbers, no ID numbers, no card data.

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

### Admin functions (role `authenticated`, require `is_admin()` = admin + authenticator code; all write the audit log)

| Function | Returns | Notes |
|---|---|---|
| `admin_decide_verification(p_user uuid, p_approve boolean, p_adult boolean, p_note text)` | `text` (ID file path to delete, or `''`) | approve needs `p_adult = true`; reject needs a note; the request must be pending and the profile `pending_review` |
| `admin_confirm_payment(p_claim uuid, p_confirm boolean, p_note text)` | `text` (screenshot path to delete, or `''`) | reject needs a note |
| `admin_set_setting(p_key text, p_value text)` | `void` | key must be one of the settings above; numbers validated |
| existing | `admin_take_action`, `admin_set_report_status`, `admin_report_messages`, `admin_decide_appeal`, `admin_remove_photo`, `admin_overview`, `admin_audit_log` | `admin_overview()` also returns `pending_verifications`, `pending_payments`, `expiring_soon`, `paused` |

### Service-role functions (called by edge functions only)

`list_due_reminders()` returns `user_id, email, first_name, locale, paid_until` for people whose `paid_until` is within `reminder_days` and not yet reminded for that date; `mark_reminded(p_user uuid, p_paid_until date)`; `list_unused_uploads(interval)` (now also lists unreferenced files in `ids` and `payments`); `attach_home_photo(p_user, p_path)` (unchanged).

### Edge functions (final list)

`process-upload` (kinds `face`, `id`, `payment`, `pet`, `home`, `handover`), `cleanup-photos`, `handover-photo-url`, `emergency`, `membership-reminders` (new). **Removed:** `request-otp`, `verify-otp`, `send-sms`, `verify-identity`, `create-fee-payment`, `paymob-webhook`, `process-refunds`.

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

## 11. Rules every part must follow

CLAUDE.md applies in full: server enforces everything; no secrets in the app; theme tokens only; every string through `t()` in English and Arabic; no exclamation marks except "Booking confirmed"; never log message text, codes, ID data or exact locations; 44 pt touch targets; new tables get RLS and tests in the same migration.
