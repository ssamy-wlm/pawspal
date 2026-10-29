#!/usr/bin/env bash
# Runs the migrations and the same security tests against the REAL local Supabase (Docker), not the stand-ins
# that scripts/test-db.sh uses. Needs Docker running and `supabase start` done first.
# Resets the local database first, so it never touches a hosted project.
set -euo pipefail
LOG=${LOG:-$(mktemp)}
bash scripts/local-supabase.sh db reset --local >/dev/null
PGPASSWORD=postgres psql -q -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "insert into private.local_switches values ('allow_test_numbers') on conflict do nothing"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -f supabase/tests/security_test.sql > "$LOG" 2>&1 || true
cat "$LOG"
python3 scripts/check-db-log.py "$LOG"
PGPASSWORD=postgres psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/assertions.sql
PGPASSWORD=postgres psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/signup_assertions.sql
PGPASSWORD=postgres psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/profile_assertions.sql
python3 scripts/check-legal-versions.py "env PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres"
