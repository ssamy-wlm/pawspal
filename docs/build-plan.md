# Build plan (for Claude Code)

Run one phase at a time with `/phase N`. A phase is done only when every acceptance check passes. Commit at the end of each phase with a message like `phase 2: sign-up and verification`.

## Phase 0: project setup
- Create the Expo app inside `apps/mobile` **around the existing files**: keep `app/`, `src/`, `app.json`, `package.json` and `tsconfig.json`. Run `npm install`, then `npx expo install --fix`, and add any missing Expo peer packages (`react-native-worklets`, `react-native-safe-area-context`, `react-native-screens`, `expo-linking`, `expo-constants`, `expo-status-bar`, `expo-font`).
- `npm run sync` must generate `src/theme/tokens.json`, `src/illustrations/index.ts` and `src/legal/index.ts`.
- Set up ESLint and Jest (jest-expo). Add the CI workflow checks locally: typecheck, lint, tests.
- Supabase: `supabase init` (keep the existing `supabase/migrations`), `supabase start`, `supabase db reset`, then run `scripts/test-db.sh` (or the same SQL tests against the local stack).
- **Accept:** `npm start` opens the Welcome screen with the animated logo; "I need a sitter" opens Explore; the showcase shows every animation; legal docs open from the Welcome footer; typecheck, lint and DB tests are all green.

## Phase 1: design system and navigation
- Tab bar: Explore, Calendar (my bookings and availability), Chat, Profile.
- Components from `docs/design-system.md`: StepHeader, CheckRow, ChatBubble, TermsCard, MapCard, EmptyState, Toast.
- Navy theme applied to trust screens; theme switch in Settings.
- i18n: move all visible strings to `src/i18n/*.json`; RTL works after switching to Arabic (the app reloads).
- **Accept:** every screen works in Light, Navy, English and Arabic; no hard-coded colours (grep for `#` in `app/` returns only token imports); Reduce Motion turns off overshoot and loops.

## Phase 2: sign-up and verification
- Phone OTP with Supabase Auth (Twilio Verify), Egypt only; resend timer; rate limits.
- Selfie capture with a face guide; ID check through the chosen KYC provider in an Edge Function `verify-identity`, which calls `set_verification()` with the service role. Store **no** ID images.
- Pets (conditional for hosts), home photo, location pin (`set_my_location`), rules, Terms and Privacy acceptance (`legal_acceptances`).
- Strip EXIF from all uploads (Edge Function `process-upload`), and use private buckets with signed URLs.
- Pending-review screen while waiting for an admin.
- **Accept:** a new user cannot reach Explore until `status = 'active'`; a banned phone cannot sign up; uploads have no GPS EXIF.

## Phase 3: profiles and pets
- Host profile (mockup 03), pet profile, edit profile, card style picker (illustration and background), private vet details (`set_pet_care`).
- **Accept:** a locked pet (confirmed booking) cannot be edited; vet details are not visible to strangers.

## Phase 4: Explore (search, swipe, both) and availability
- Hook `explore.tsx` to real data (already calls `search_stays` and `browse_random`). Add the host profile route from result rows and the swipe "like" shortlist.
- Owners can post travel dates; hosts post availability (mockup 05).
- Map view toggle for results (approximate circles only).
- **Accept:** the search returns exact matches before close matches; blocked or inactive users never appear; the results list scrolls at 60 fps with 100 items.

## Phase 5: chat and bookings
- Conversations (`start_conversation`), realtime messages, masked-message hint ("Contact details unlock after booking").
- Booking request, TermsCard with `propose_terms` / `accept_terms`, accept ripple animation.
- **Accept:** a phone number sent before payment is shown as `•••`; the terms-change flow resets acceptance on both sides.

## Phase 6: payments, confirmation and location
- Paymob checkout for the booking fee; Edge Function `paymob-webhook` verifies the HMAC and calls `confirm_booking_payment` with the service role. Refunds follow Terms section 6.
- Booking-confirmed screen (mockup 17) with CheckStamp, PinDrop, the address from `get_booking_location` and a Google Maps directions link.
- **Accept:** a forged webhook is rejected; the pin is visible only to the two participants after payment.

## Phase 7: handover, reviews and Safety Center
- Handover photos (drop-off starts the stay; the owner completes it with `complete_booking`), reviews, report, block, emergency, appeals.
- **Accept:** a review is impossible before completion; emergency notifies the owner and creates a high-priority report.

## Phase 8: admin dashboard (`apps/admin`, Next.js)
- Login for admins only; pages from HANDOVER section 7; every action through `admin_take_action`.
- Scheduled job (pg_cron) to lift fixed-length suspensions when `ends_at` passes, with an audit entry.
- **Accept:** a non-admin gets nothing; every action appears in the audit log.

## Phase 9: hardening and launch prep
- Run the `docs/security.md` checklist, the Supabase Security Advisor, `npm audit` and an accessibility pass.
- Remove `app/showcase.tsx` from production builds.
- Account deletion and data export, notifications, Sentry.
- EAS builds, store listings, privacy labels (App Store) and data safety form (Google Play) matching the privacy policy.
- **Accept:** the security checklist is fully ticked and the legal review is done.
