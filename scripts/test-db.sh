#!/usr/bin/env bash
# Runs the migrations and the security tests on a throwaway local Postgres database,
# then fails if any test behaved unexpectedly (see scripts/check-db-log.py) or an assertion failed.
# Needs: psql and a local Postgres you can connect to (set PGHOST, PGUSER, PGPASSWORD if needed).
set -euo pipefail
DB=${DB:-pawspal_test}
LOG=${LOG:-$(mktemp)}
dropdb --if-exists "$DB" && createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/local-stubs.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -d "$DB" -f supabase/tests/security_test.sql > "$LOG" 2>&1 || true
cat "$LOG"
python3 scripts/check-db-log.py "$LOG"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/assertions.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/signup_assertions.sql
python3 scripts/check-legal-versions.py "psql -d $DB"
