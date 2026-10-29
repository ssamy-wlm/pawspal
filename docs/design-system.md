# PawsPal Dahab design system

One look across the app, the admin site and social media. Tokens live in `design/tokens.json`, and the app reads them through `apps/mobile/src/theme/tokens.ts`. Never hard-code a hex value in a screen.

## Brand

- **Logo:** paw print with orange toes (two tall inner, two tilted outer) around a teal house-shaped pad with an arched sand door. Files: `assets/logo/`. Approved by the founder; do not change the shapes.
- **Voice:** a warm neighbour who loves animals. Short sentences, friendly, never pushy. No exclamation marks in UI copy except celebrations ("Booking confirmed").

## Colour

| Token | Hex | Use |
|---|---|---|
| teal | `#1FA3A3` | Brand, illustrations, icons, large shapes. **Not** for text or button fills with white text (3.1:1 fails) |
| tealDeep | `#167E7E` | Primary buttons (white text 4.9:1), links, active tab, prices |
| orange | `#FF9F43` | Accent, toes, highlight chips with **navy** text, "days to go" circles |
| coral | `#FF6B6B` | Hearts, pin, pass button outline. Icons only; never text on it |
| sand | `#F6E7CB` | Borders on cream, chips outline, quiet panels |
| cream | `#FFF7EC` | Light background |
| navy | `#1F2D3D` | Text in light mode; **background in the navy theme** |
| textMuted | `#4A5664` | Secondary text (7.0:1 on cream) |
| danger | `#C93A3A` | Error text and destructive buttons in light mode |

Tints for background circles: teal `#D6EFEF`, orange `#FFE5C8`, sand `#F6E7CB`.

**White on orange** (as on the "Travelling soon?" and "Get PawsPal" posts) is only 2.0:1. It is allowed **only** for display headlines of 48 px and up on marketing surfaces (posts, splash art). It is never used for app UI text or buttons.

### The navy theme

The deep navy from the "Safe by design" posts is a full second theme, used in two ways:

1. **Dark mode:** follows the phone setting, with a manual override in Settings (System, Light, Navy).
2. **Trust surfaces:** these screens always use navy, in both modes, so safety feels distinct and serious:
   - Splash screen
   - Verification steps (phone, selfie, ID)
   - Safety Center (report, block, emergency, rules)
   - Community rules acceptance
   - Suspension and appeal screens
   - Admin dashboard sidebar

| Role | Navy theme |
|---|---|
| background | `#1F2D3D` |
| surface | `#26394C` |
| surfaceRaised | `#2E4459` |
| border | `#3A5068` |
| text | `#FFF7EC` |
| textMuted | `#C3CCD5` |
| primary (buttons) | `#3BC0C0` with **navy** text |
| accent | `#FF9F43` with navy text |
| danger | `#FF8A8A` |

Decorative circles in the navy theme use `#26394C` on `#1F2D3D`, as on the posts.

## Typography

- **Poppins** (400, 500, 600, 700, 800) for Latin script.
- **Cairo** (400, 600, 700) for Arabic. Poppins has no Arabic letters, so the font switches with the language.
- Scale (pt): caption 12, small 14, body 16, lead 18, title 22, headline 28, display 36, hero 48.
- Headlines: weight 800, letter spacing −1% (0 in Arabic). Body: 400, line height 1.4.
- Support Dynamic Type up to 200%: no fixed-height text containers.

## Shape and space

- Radii: chips and buttons fully rounded, inputs 16, cards 24, sheets 32.
- Spacing scale 4, 8, 12, 16, 24, 32, 48. Screen side padding 24.
- Card shadow: navy at 12%, blur 30, y 12 (light theme only; navy theme uses a raised surface colour instead).
- Touch targets at least 44 × 44.

## Components

| Component | Notes |
|---|---|
| `Button` | Variants: primary (tealDeep), secondary (outline tealDeep), accent (orange, navy text), danger. Pill shape, 56 high, press scale 0.96 |
| `Chip` | Outline sand; selected = tealDeep fill, white text |
| `BrowseCard` | Pet image area (illustration or photo) on a chosen background, "‹Pet› lives here" chip, sitter row, price, chips, availability line |
| `SwipeDeck` | Stack of `BrowseCard`s with gestures (see motion spec) |
| `ActionRow` | Pass (coral outline), Like (tealDeep filled heart), Message (outline) |
| `ChatBubble` | Incoming white with sand border; outgoing tealDeep with white text |
| `TermsCard` | Dates, pet, stay location, cost; Accept and Change buttons |
| `StepHeader` | Back button, "Step n of 6", segmented progress bar |
| `CheckRow` | Teal check circle, title, one-line description |
| `MapCard` | Approximate area circle, or the exact pin after a confirmed and paid booking |
| `Blob` | Decorative breathing circle |
| `EmptyState` | Logo or pet illustration, one line, one action |

## Illustrations

Shared files in `assets/illustrations/` (also used in the Instagram posts):
`dog-biscuit.svg`, `cat-mango.svg`, `cat-midnight.svg`, `husky-storm.svg`, `avatar-placeholder.svg`, `heart.svg`, `shield-paw.svg`, `map-pin.svg`, `check-badge.svg`.

They are placeholders: real pet photos replace them on live profiles. A sitter with no pet shows the illustration they pick, labelled "Pet-friendly home" rather than "‹name› lives here".

### Browse card backgrounds (user choice)

1. **Circles:** soft circles in teal, orange or sand tint.
2. **Pattern:** white background, light yellow paws (`tint.paw`) and pink hearts (`tint.heart`).
3. **Navy:** navy background with `#26394C` circles (new, from the navy posts).

## Right-to-left

Arabic uses RTL layout: use `start` and `end` rather than `left` and `right`, and mirror arrows and swipe hints. Illustrations do not mirror. Numbers stay in Western digits unless the founder decides otherwise.

## Accessibility

Contrast AA everywhere (checked values above), labels on icon buttons, screen-reader order follows the visual order, images have descriptions, and Reduce Motion is respected (see `docs/motion.md`).
