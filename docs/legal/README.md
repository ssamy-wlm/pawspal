# Legal documents: read this first

These documents are **drafts**. They were written to match how PawsPal actually works, but they are not legal advice. An Egyptian lawyer must review them before the app goes live.

## Files

| File | Shown in the app | Must accept |
|---|---|---|
| `privacy-policy.md` | Sign-up, Settings › Legal | Yes, at sign-up (consent) |
| `terms-of-service.md` | Sign-up, Settings › Legal | Yes, at sign-up |
| `community-guidelines.md` | Sign-up step 6, Safety Center | Yes, at sign-up step 6 |

The app bundles these Markdown files (`scripts/sync-shared.mjs` copies them into `apps/mobile/src/legal/index.ts`). Each file starts with a `version` and `effective` date. When the version changes, the app asks every user to accept again and records it in `legal_acceptances`.

Fill in every `[SQUARE BRACKET]` placeholder before launch.

## Points for the lawyer

1. **Egypt's Personal Data Protection Law (No. 151 of 2020).** Its Executive Regulations (Ministerial Decree No. 816 of 2025) were issued on 1 November 2025. Commentators put the one-year compliance deadline at **1 November 2026**. Ask:
   - Whether PawsPal needs a licence or permit from the Personal Data Protection Center to collect and process data.
   - Whether a Data Protection Officer is required.
   - What records of processing must be kept.
2. **Sensitive data.** Face images, ID documents and precise location are processed. Confirm the consent wording and whether the verification provider is a processor or a separate controller.
3. **Data leaving Egypt.** The backend (Supabase), SMS, verification and maps providers may store data outside Egypt. Cross-border transfer needs a licence or permit and an adequate level of protection, so confirm what is needed, or choose hosting that keeps data in Egypt.
4. **Breach notification.** The regulations add mandatory breach notification. Confirm the deadlines and fill in section 11 of the privacy policy.
5. **Marketplace liability.** Confirm the limitation-of-liability clause is enforceable in Egypt, and whether consumer protection law (Law No. 181 of 2018) affects refunds and fees.
6. **Payments.** Confirm the fee and refund wording with the payment provider's terms (Paymob or Fawry).
7. **Animal welfare.** Confirm any local rules on pet boarding for money (licensing or veterinary requirements).
8. **Arabic version.** An official Arabic translation is needed; decide which language prevails if the two differ.
