# PawsPal Dahab: project handover (v2)

This is the single plan for building PawsPal with Claude Code. It replaces v1 (`docs/handover/HANDOVER-v1.md`, kept for reference). It combines the original planning chat with the branding, social media, motion and safety work done afterwards. Section 14 lists every error fixed from v1.

**Status key:** **Decided** means build it. **(suggested)** means a sensible default that can still change. **Open** items are in section 13.

## 1. What the app is

A mobile app for **Dahab, Egypt** that connects:

- **Pet owners** who need someone to host or look after their pet while they travel.
- **Hosts:** anyone in Dahab who will look after a pet. That includes dedicated sitters **and other pet owners** who are happy to host, or to **swap** care ("I'll host yours, you host mine").

The welcome screen offers two doors, **"I need a sitter"** and **"I want to sit"**. One account can do both (role `both` is the default).

Tone: cute, warm, trustworthy. Flat pet illustrations, soft circles, gentle bouncy motion, plus a deep-navy look for anything about safety.

## 2. Core features (Decided)

1. **Profiles:** face photo, first name, bio, area, pets, home photo (hosts), what they offer.
2. **Explore: three ways to find a host** (new in v2)
   - **Search (like booking on Airbnb):** choose dates on a calendar, pet type, a budget preset or a custom min–max per night, nice-to-haves (food provided, can stay at my place, swap, volunteer) and distance. Results show **Exact matches** first, then **Close matches** (dates partly fit, or the price is up to 20% over budget and the host marked it negotiable). The owner picks from the list.
   - **Swipe:** random browsing, card by card, as in the mockups and posts.
   - **Search + swipe:** set filters first, then swipe through only the matches.
3. **Availability posts:** hosts post date ranges, pets accepted, offers and price. Owners can also post their travel dates so hosts can find them.
4. **Terms picker:** Volunteer (free), Swap, Paid (price per night, optionally negotiable), Food provided, Stay at my place.
5. **In-app chat:** phone numbers, emails, links, social handles and payment apps are **masked automatically** until the pair has a confirmed, paid booking. This is enforced in the database.
6. **Booking flow:** request → agree terms in chat (either side can change them, which resets acceptance) → both accept → booking fee → **confirmed** → handover → completed.
7. **Exact location release:** the exact pin and address are shown only to the two people in a confirmed, paid booking, and only if the host allows it.
8. **Handover photos:** both sides photograph the pet at drop-off (this starts the stay) and at pick-up.
9. **Reviews and ratings:** only after a completed stay, once per side, within 14 days. New users show "New on PawsPal" rather than a fake rating.
10. **Pet profiles:** photos (1–8), name, type, size, age, vaccinated; vet and care notes are private and shared only with a confirmed booking partner. Pet details lock while a booking is confirmed.
11. **Safety Center** (navy screen): report, block, emergency (alerts the owner and PawsPal), rules, appeals.
12. **Admin dashboard** (web): reports, photo review, approvals, warnings, suspensions, removals, audit log.
13. **Legal inside the app:** Privacy Policy, Terms of Service and Community Guidelines, readable offline, versioned, with acceptance recorded.
14. **Two themes:** Light (cream) and **Navy** (from the "Safe by design" posts). They follow the phone setting, with a manual switch.
15. **Arabic and English**, with right-to-left layout for Arabic, built in from the start.
16. **Account deletion and data download** in Settings (required by the app stores and the privacy law).

### Browse card customization
The big picture on a card shows the host's own pet ("Biscuit lives here"). Hosts choose an illustration (dog, orange cat, black cat, husky) until they upload real photos, and a background: **circles** (teal, orange or sand), **pattern** (white with light yellow paws and pink hearts) or **navy**. Hosts without pets show their chosen illustration, labelled "Pet-friendly home".

## 3. Sign-up and verification (Decided, all mandatory)

Six steps, navy theme, progress bar:

1. **Phone:** SMS code, Egypt (+20) only, one number per account.
2. **Face selfie:** live, face guide, no filters, no pets or groups.
3. **ID check:** national ID or passport through a verification provider. **PawsPal never stores the ID image.** This also confirms the user is **18+**.
4. **Pets and home:** owners add at least one pet (photo and size required). Hosts add a home photo. A host with no pets skips the pet part. (v1 forced everyone through "Add your pet".)
5. **Location:** drop a pin; the public sees only an approximate area.
6. **Community rules, Terms and Privacy:** accept all three; acceptance and version are recorded.

After step 6 the profile is `pending_review` until a person in the admin dashboard approves it. Only `active` profiles appear in Explore, can message or can book.

## 4. Business model

Decided: **registration is free**. **(suggested)** A flat **booking fee** (about 50–100 EGP) at confirmation, including volunteer and swap stays, which unlocks the exact pin and contacts. Optional later: in-app payment of the stay price with a 10–15% fee, held until the stay starts; a verified badge or priority listing; local sponsors (vets, pet shops, dive centres). Payment provider **(suggested):** Paymob, with Fawry as an alternative. Confirm which wallets they support.

## 5. Location and privacy (Decided)

- Exact pins are stored in a private database schema that the app cannot read.
- Public profiles get a rounded point with a fixed per-user offset (about 300 m), so the exact spot can't be worked out.
- The exact pin is released only by the `get_booking_location` function, for a confirmed and paid booking, to its two participants, if the host's "Share exact pin after booking" toggle is on (default on).
- The booking-confirmed screen shows the pin drop animation, the address and a **Get directions in Google Maps** button.

## 6. Community rules and enforcement (Decided)

Five rules (full text in `docs/legal/community-guidelines.md`): care for every pet like your own; real photos only; keep chat and payments in the app until confirmed; be honest and kind; report problems.

Ladder: **Reminder → Warning → Suspension (3 days, 7 days or until fixed) → Removal**, with in-app appeals reviewed by a person. Zero-tolerance list: animal harm, threats, fake identity, selling or breeding animals, fraud. Banned people's phone, ID and device fingerprints are kept to stop them returning.

## 7. Admin dashboard (Decided)

Web app, desktop layout, navy sidebar. Pages: **Overview** (active users, new this week, open reports, suspended; reports queue; photos to review; actions this month), **Reports**, **Users** (case page with verification badges, reports, strike history and a Take action panel), **Approvals** (new profiles waiting for review), **Bookings**, **Photo review**, **Rules**, **Audit log**. Every admin action goes through `admin_take_action()`, which writes the audit log. Admin rights live in the `admins` table, never in the app.

## 8. Branding, design and motion

- **Design system:** `docs/design-system.md`. Tokens: `design/tokens.json`, the single source for the app and the social kit.
- **Motion:** `docs/motion.md`. The app's animations use the same timings as the intro video and posts (logo entrance, breathing circles, swipe stack, heart burst, chat pops, accept ripple, check stamp, pin drop).
- **Illustrations:** `assets/illustrations/`, the same files used in the posts.
- **Logo:** `assets/logo/` (approved; do not change the shapes).
- **Social kit:** `docs/social-kit.md` links the Instagram posts and videos to the app.

## 9. Screens

Designed (mockups in `assets/mockups/`): welcome, browse (swipe), sitter profile, chat and terms, post your dates, browse card variants, six sign-up steps, booking confirmed, admin overview, admin user case.

Added in v2 (build from the design system):

- **Explore** with Search / Swipe / Search + swipe, the calendar range, budget and filters, and results with exact and close matches (built in `apps/mobile/app/explore.tsx`).
- Host profile and pet profile.
- Bookings list.
- Leave a review.
- Safety Center (navy): report, block, emergency, appeals.
- Settings: theme, language, notifications, privacy (download data, delete account), legal documents (built in `apps/mobile/app/legal/`), sign out of all devices.
- Notifications.
- Edit profile and card style picker (illustration and background).
- Suspended account screen (navy).
- Admin approvals queue.

## 10. Tech stack (Decided, so the build doesn't stall)

| Part | Choice | Why |
|---|---|---|
| Mobile app | **Expo (React Native) + TypeScript + Expo Router** | One codebase for iPhone and Android; easy store builds with EAS |
| Animation | **Reanimated 4 + Gesture Handler + react-native-svg** | Smooth 60 fps motion matching the video |
| Backend | **Supabase** (Postgres, Auth, Storage, Edge Functions) | Rules enforced in the database (row-level security); phone sign-in built in |
| SMS | Supabase Auth with **Twilio Verify** | Reliable OTP in Egypt; WhatsApp channel as a backup |
| Identity and liveness | A KYC provider **(Open: choose one)** | ID images never touch our servers |
| Maps | Google Maps SDK and Places | Pins, area circles, directions |
| Payments | Paymob **(suggested)** | Egyptian cards and wallets; signed webhooks |
| Admin | **Next.js** web app in `apps/admin` | Same Supabase backend |
| Monitoring | Sentry | Crash reports without personal data |

Type-checked on 27 Oct 2026 with Expo SDK 58, React Native 0.88 and Reanimated 4.7.

## 11. Data model (Decided, built)

`supabase/migrations/0001_init.sql` and `0002_search.sql`:

- **Tables:** profiles, private.locations, pets, private.pet_care, availability, bookings, conversations, messages, handover_photos, reviews, reports, enforcement_actions, appeals, audit_log, blocks, banned_identifiers, legal_acceptances, security_events, admins.
- **Functions:** set_my_location, request_booking, propose_terms, accept_terms, confirm_booking_payment (webhook only), cancel_booking, complete_booking, get_booking_location, get_pet_care, start_conversation, search_stays, browse_random, admin_take_action, set_verification (service only).

`supabase/tests/security_test.sql` holds the security and search tests, which pass against the migrations. Run them with `scripts/test-db.sh`.

## 12. Build plan

Phases 0–9 with acceptance tests: `docs/build-plan.md`. In Claude Code, run `/phase 0`, then `/phase 1`, and so on.

## 13. Open decisions for the founder

1. **Legal review, urgent.** Egypt's data protection law has a compliance deadline commentators put at **1 November 2026**. You may need a licence or permit, and possibly a data protection officer; data stored outside Egypt needs approval. See `docs/legal/README.md`.
2. Company legal name, address and support/privacy emails (placeholders in the legal docs).
3. Booking fee amount; whether in-app payment of the stay price launches on day one.
4. KYC provider; whether Paymob or Fawry can take wallets and InstaPay.
5. Hosting region (data location) after the legal answer.
6. Arabic copy: a native speaker must review every string and the legal translations.
7. Cancellation fee numbers in Terms section 6.
8. Launch scope: Dahab only (the map bounds are already set to Egypt; search distance defaults to 10 km).

## 14. What changed from v1 (errors fixed)

| # | v1 problem | Fix in v2 |
|---|---|---|
| 1 | Two identical copies of HANDOVER.md in the zip | One file; v1 kept in `docs/handover/` |
| 2 | Hosts without pets were forced through "Add your pet" | Step 4 is now conditional; hosts add a home photo |
| 3 | Muted text `#6B7785` on cream was 4.3:1 (fails AA) | `#4A5664` (7.0:1) |
| 4 | Primary buttons were white on `#1FA3A3` (3.1:1, fails AA) | Buttons use deep teal `#167E7E` (4.9:1); `#1FA3A3` stays for shapes and icons |
| 5 | Cream was `#FFF8EC` in v1 but `#FFF7EC` in the posts | Unified to `#FFF7EC` |
| 6 | Deep teal `#13797A` differed from the posts | Unified to `#167E7E` |
| 7 | No minimum age | 18+, confirmed by the ID check |
| 8 | Arabic and RTL "not discussed" | Built in from day one (Cairo font, RTL layout, i18n files) |
| 9 | Tech stack undecided, so the build could not start | Stack decided (section 10); still changeable |
| 10 | Phone-number blocking in chat had no mechanism | Database trigger masks contacts until a paid booking; tested |
| 11 | Reviews could be written by anyone | Only after a completed stay, once per side |
| 12 | No cancellation or no-show rules, though the admin mockup shows both | Terms section 6 and booking statuses |
| 13 | No pet emergency procedure | Safety Center emergency, private vet details, Terms section 7 |
| 14 | No account deletion, data download or blocking | Added (store and privacy law requirements) |
| 15 | Every card showed "4.9 · 32 stays" | Real ratings only; "New on PawsPal" otherwise |
| 16 | No legal documents | Privacy Policy, Terms and Community Guidelines drafted and bundled in the app |
| 17 | Browsing was swipe only | Search by dates, budget and filters, plus swipe, plus both combined |
| 18 | Data protection law described generally | Updated with the Executive Regulations (Decree 816/2025) and the compliance deadline |
