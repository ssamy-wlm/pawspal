# PawsPal Dahab: project handover

Handover from the design and planning chat to the Claude Code build. Everything below was discussed or designed with the founder. Items marked **(suggested)** were Claude's suggestions, not final decisions. Items under "Open decisions" still need an answer from the founder before building them.

## 1. What the app is

A mobile app for **Dahab, Egypt**, a small town with many residents who have dogs and cats. It connects:

- **Pet owners** who need someone to host or look after their pet while they travel
- **Sitters**: people with or without pets of their own who live in Dahab and can host or visit pets

Two ways to use the app: **"I need a sitter"** and **"I want to sit"**. People can also **swap** pet care with each other while traveling.

Working name: **PawsPal Dahab** (logo and screens already designed with this name).

Tone: cute, friendly, easy for everyone. Cat and dog illustrations and light animations. Dating-app style browsing of profiles.

## 2. Core features

1. **Profiles** with a face photo, bio, area, pets owned, home details and what the person offers
2. **Browse sitters** as large pet-photo cards, swipe or tap style, filtered by dates, pet type and price
3. **Availability posts:** sitters post the dates they can host; owners post travel dates
4. **Terms picker:** users agree what a stay involves. Options seen in the designs: Volunteer (free), Swap, Paid (price per night, negotiable), Food provided, Stay at my place
5. **In-app chat** so phone numbers and socials are not shared early
6. **Booking requests and confirmation**, with proposed terms (dates, pet, stay location, cost) that can be accepted or changed in chat
7. **Reviews and ratings** (4.9 rating and "stays" count appear in the designs)
8. **Pet profiles:** several photos, name, type (Dog / Cat / Other), size, age, vaccinated flag; vet contact is a suggested optional field
9. **Handover day:** both sides take a photo of the pet at handover
10. **Map location** for each user (see section 5)
11. **Admin dashboard** for reports, photo review, strikes, suspensions and removals (see section 7)

### Browse card customization
The big picture on the browse card shows the sitter's own pet (for example "Biscuit lives here"). Users can choose both the **animal illustration** and the **background**: soft colored circles, or a **white background with light yellow paws and pink hearts** (no circle). Real photos replace the illustrations in the live app.

## 3. Sign-up and verification (all mandatory)

Screens designed in this order, with a 6-step progress bar:

1. **Phone:** SMS code, one phone number per account
2. **Face selfie:** live selfie with a face guide; only face photos accepted as the profile icon; pet, group and gallery photos are rejected
3. **ID check:** national ID or passport, never shown to other users, handled by a verification partner
4. **Add your pet:** at least one photo and the size are required
5. **Location:** drop a pin (see section 5)
6. **Community rules:** accept before the profile goes live

A profile stays hidden until all of this is complete. Owners need face photo, verified phone and ID, and at least one pet with photos and size. Sitters need face photo, verified phone and ID, a home photo, and their offered terms.

### Preventing duplicate accounts, shared accounts and pet swaps **(suggested)**
- One phone number per account, ID tied to the account, block duplicate ID, device and photos
- Pet details lock once a booking is confirmed; handover photos taken by both sides
- A human review step for new profiles on top of automatic face detection
- Facial and ID data is sensitive under Egypt's personal data protection law. Use a verification provider, get clear consent, and have a lawyer check before launch.

## 4. Business model

Decided direction: **registration is free** (a small town needs both sides before it is useful). Ways to earn, all **(suggested)**, none finalized:

- **Flat booking fee** paid at confirmation (about 50 to 100 EGP), which unlocks exact pin and contact details. Works for free, volunteer and swap stays too.
- **Optional in-app payment** with a 10 to 15% fee, with money held until the stay, a small guarantee fund and dispute help
- Optional subscription (verified badge, priority listing) and local sponsors (vets, pet shops, dive centers)

Users may still pay each other directly in cash or InstaPay. The design accepts this: the flat fee is paid in the app, chat blocks phone numbers and payment details until the fee is paid, and repeated off-app deals can lead to a ban. Whether the app can take InstaPay payments directly was **not confirmed**; ask Paymob or Fawry which wallets and bank transfers they support.

## 5. Location and privacy

- Users drop a pin on a Google map in sign-up
- **Public view:** only an approximate area (shaded circle, rounded or shifted position)
- **Exact pin:** stored server-side only and sent to the matched person only after the booking is confirmed and the fee is paid. Never in the public profile.
- After confirmation, the booking screen shows "Exact pin unlocked", an address line, and a **Get directions in Google Maps** button
- A toggle "Share exact pin after booking" is shown and recommended on

## 6. Community rules and enforcement

Rules shown at sign-up (user must tick agree):

1. Care for every pet like your own
2. Use real photos only (your face and your own pets)
3. Keep chat and payments in the app until a booking is confirmed
4. Be honest and kind in messages and reviews
5. Report problems; every report is reviewed

Enforcement ladder: **Warning, then Suspension, then Removal**. Suspended users see which rule they broke, can fix it or appeal in the app, and can be reinstated by an admin.

## 7. Admin dashboard (web, desktop layout)

- **Overview:** active users, new this week, open reports, suspended count; reports queue (user, issue, reported by, status, Open); photos waiting for review (pet and face) with approve or reject; actions this month (warnings, suspensions, removals)
- **User case page:** profile and verification badges, the reports against the user, strike history, and a **Take action** panel: Warning / Suspend / Remove, duration (3 days, 7 days, until fixed), checklist of what must be fixed, a message to the user, and a "Suspend until guidelines followed" button
- Every admin action goes into an audit log
- Sidebar sections: Overview, Reports, Users, Bookings, Photo review, Rules, Audit log

## 8. Branding and design system

**Logo:** a realistic paw print: orange toes (two tall inner, two tilted outer) around a teal rounded pad shaped like a house with an arched sand-colored door. SVG files in `assets/logo/`. The founder approved this logo; do not change the house or toe shapes.

**Palette** (teal and orange approved; purple was floated but not chosen):

| Role | Hex |
|---|---|
| Sea teal (primary) | `#1FA3A3` |
| Deep teal | `#13797A` |
| Sunny orange (accent, toes) | `#FF9F43` |
| Soft coral (hearts, alerts, danger) | `#FF6B6B` |
| Warm sand | `#F6E7CB` |
| Cream (screen background) | `#FFF8EC` |
| Deep navy (text) | `#1F2D3D` |
| Muted text | `#6B7785` |
| Teal tint | `#D6F0EF` |
| Orange tint | `#FFE6C7` |
| Border line | `#E9DCC3` |

**Typography:** Poppins (Regular 400, Medium 500, Bold 700).

**UI style:** mobile frame 390 by 844; large rounded corners (cards about 20 to 26 px, pill buttons fully rounded, chips fully rounded); soft decorative circles in tints behind content; tab bar with Explore, Calendar, Chat, Profile; primary buttons teal pill, secondary white with teal outline; heart glyphs optically centered in their circles and kept small.

**Illustrations:** flat cute dog (beagle style), cat (orange tabby), husky (erect ears, fluffy cheeks, blue eyes, dark mask) and black cat (green eyes), with ears attached to the head. These are placeholders for real user photos.

## 9. Screens designed

All images are in `assets/mockups/`; a combined PDF is `assets/PawsPal-all-mockups.pdf`.

| File | Screen |
|---|---|
| 01-welcome | Logo, "I need a sitter" and "I want to sit" |
| 02-browse-sitters | Swipe card with pet photo, sitter info, price, chips, pass / book / message buttons |
| 03-sitter-profile | Photo, stats, about, available days, terms, Message and Request booking |
| 04-chat-and-terms | Chat with privacy note and proposed terms card |
| 05-post-your-dates | Calendar range, pets hosted, terms, price, Post availability |
| 06 to 10 | Browse card variants: dog, cat, husky, black cat, pattern background |
| 11 to 16 | Sign-up flow: phone, selfie, ID, pet, location, rules |
| 17-booking-confirmed | Exact pin unlocked, directions button, handover reminder |
| 18-admin-dashboard, 19-admin-user-case | Admin web pages |

Not designed yet: pet profile page, bookings list, reviews screen, settings, notifications, edit profile, reports flow for users, and a screen to choose the browse background and animal.

## 10. Suggested tech **(suggested, not decided)**

- **Phone verification:** Firebase Phone Auth (Twilio Verify as alternative; consider a WhatsApp code as backup). Restrict SMS to Egypt (+20), enable App Check, limit code requests per number and device, and test on Vodafone, Orange, Etisalat and WE.
- **Maps:** Google Maps SDK (Android and iOS) plus Places for search. Needs a Google Cloud project with billing, an API key restricted to the app and to the enabled APIs, and a budget alert.
- **Identity checks:** a third-party KYC and liveness provider; do not store ID images yourself.
- **Payments:** Paymob or Fawry (confirm what they support)
- **Backend:** must hold exact coordinates privately and release them only on confirmed and paid bookings
- The founder works with no-code tools; Claude Code was chosen for the actual build. Pick the framework with the founder (for example a cross-platform mobile framework).

## 11. Data model sketch **(suggested)**

users (phone, verified flags, face photo, role, area, approximate location, private exact location, status), pets (owner, name, type, size, age, vaccinated, photos), listings or availability (user, date range, terms, price, pets accepted), bookings (owner, sitter, pet, dates, terms, fee paid, status), messages, reviews, reports, strikes and actions, audit log.

## 12. Open decisions for the founder

1. Final app name and whether the name and handles are available
2. Fee amounts and whether to use in-app payments from day one
3. Whether InstaPay or wallets can be taken through the chosen gateway
4. Verification provider and legal review for ID and face data
5. **Languages:** Arabic and English, and right-to-left layout (not discussed yet)
6. Teal and orange only, or a purple option
7. Real photos replace illustrations; how pets are shown when a sitter has none
8. Launch scope: Dahab only first; other towns later

## 13. Suggested build order **(suggested)**

1. Project setup, design tokens, logo and navigation
2. Phone sign-in, profile, face selfie, pet profiles
3. ID verification and approval status
4. Listings, browse and filters
5. Chat and booking request flow
6. Map pin and exact-location release after confirmation
7. Booking fee and payments
8. Reviews, reports and admin dashboard
9. Moderation tools, audit log, polish and testing with real Egyptian phone numbers
