# Admin dashboard (phase 8)

Next.js web app using the same Supabase project. Built in phase 8 of `docs/build-plan.md`; design from mockups 18 and 19 (navy sidebar).

- Sign-in: phone OTP, and the user must be in `public.admins`. Hide everything otherwise.
- All writes go through `admin_take_action()`, which records the audit log. No direct table writes.
- Pages: Overview, Reports, Users (case page), Approvals, Bookings, Photo review, Rules, Audit log.
