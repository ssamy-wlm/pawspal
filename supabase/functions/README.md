# Edge functions (built in phases 2–8)

| Function | Phase | Does | Secrets |
|---|---|---|---|
| `verify-identity` | 2 | Starts the KYC session, receives the result, calls `set_verification()`; stores no ID images; checks `banned_identifiers` | KYC key, service role |
| `process-upload` | 2 | Strips EXIF, resizes, runs a face check on selfies, moves files to their bucket | service role |
| `paymob-webhook` | 6 | Verifies HMAC, calls `confirm_booking_payment()`; handles refunds by Terms section 6 | Paymob HMAC, service role |
| `create-fee-payment` | 6 | Creates the payment for a `terms_agreed` booking; the price comes from server config, never the app | Paymob key |
| `handover-photo-url` | 7 | Gives the booking partner a short signed URL for the other side's handover photo | service role |
| `emergency` | 7 | Notifies the owner and opens a high-priority report | service role |
| `export-my-data`, `delete-my-account` | 9 | Privacy rights from the policy (section 8) | service role |

Every function: verify the user's JWT, validate input, rate-limit, and never log personal data.
