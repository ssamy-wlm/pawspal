# Social kit ↔ app

The Instagram posts, the intro animation and the app share one look and one motion language.

| Social piece | Where it lives | App equivalent |
|---|---|---|
| Intro animation 16:9 | Claude artifact "PawsPal Dahab – Intro" (Export → MP4) | Welcome (logo entrance), Explore (swipe and heart burst), chat terms (accept ripple), booking confirmed (check stamp and pin drop) |
| Intro animation 4:5 | Claude artifact "PawsPal Dahab – Instagram Post" | Same |
| Weeks 1–3 posts, 4:5 and 1:1 | Claude artifact "PawsPal Dahab – Weeks 1–3 Posts" (two pages) | Illustrations in `assets/illustrations/`; navy "Safe by design" look = navy theme |
| Launch plan | Claude Doc "PawsPal Dahab – Instagram Launch Plan" | n/a |

## Rules that keep them identical
- Colours, fonts and motion timings come from `design/tokens.json`. Change it there first.
- Illustrations: edit the SVG in `assets/illustrations/`, run `node scripts/sync-shared.mjs`, and update the posts with the same file.
- App store screenshots should reuse the post layouts (same headlines, same backgrounds).
- Post copy and app copy share the same phrases: "A trusted home for every paw while you travel", "Safe by design", "Two ways to join", "Post your dates".

## Claims the posts make that the app must keep true
- Phone, face and ID verified (sign-up steps 1–3)
- "Your number stays private": chat masking until a paid booking (tested)
- "Your exact pin, only after booking": `get_booking_location` (tested)
- "Pay, volunteer or swap": cost types in bookings and search
- "Now live in Dahab": only post this once the store links are live
