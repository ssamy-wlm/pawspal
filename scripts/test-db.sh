#!/usr/bin/env bash
# Runs the migration and the security tests on a throwaway local Postgres database.
# Needs: psql and a local Postgres you can connect to (Supabase CLI users can run `supabase db reset` instead).
set -euo pipefail
DB=${DB:-pawspal_test}
dropdb --if-exists "$DB" && createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/local-stubs.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -d "$DB" -f supabase/tests/security_test.sql
