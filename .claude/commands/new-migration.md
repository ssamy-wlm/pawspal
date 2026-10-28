---
description: Create a new numbered Supabase migration with RLS
argument-hint: <short_name>
---
Create `supabase/migrations/NNNN_$ARGUMENTS.sql` with the next number (never edit an existing migration). Every new table: `enable row level security` plus explicit policies, `revoke` direct writes where a function should be used, and `grant execute ... to service_role` for service-only functions. Add matching tests (including "expect ERROR" cases) to `supabase/tests/security_test.sql` and run `bash scripts/test-db.sh`.
