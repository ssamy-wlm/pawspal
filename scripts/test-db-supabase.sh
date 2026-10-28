#!/usr/bin/env bash
# Runs the migrations and the same security tests against the REAL local Supabase (Docker), not the stand-ins
# that scripts/test-db.sh uses. Needs Docker running and `supabase start` done first.
# Resets the local database first, so it never touches a hosted project.
set -euo pipefail
SUPABASE=${SUPABASE:-"npx --yes supabase@2.122.0"}
LOG=${LOG:-$(mktemp)}
$SUPABASE db reset --local >/dev/null
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -f supabase/tests/security_test.sql > "$LOG" 2>&1 || true
cat "$LOG"
python3 scripts/check-db-log.py "$LOG"
PGPASSWORD=postgres psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/assertions.sql
