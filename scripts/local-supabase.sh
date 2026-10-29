#!/usr/bin/env bash
# Runs a Supabase CLI command with the local-only settings (test phone numbers, local SMS hook) added to
# supabase/config.toml for the duration of the command, then puts config.toml back exactly as it was.
#   bash scripts/local-supabase.sh start -x studio,mailpit
#   bash scripts/local-supabase.sh db reset --local
# After "start" it also switches on the database row that lets test numbers create accounts (the live database
# never has it, so a test number can never become an account there; see migration 0004).
set -euo pipefail
cd "$(dirname "$0")/.."
SUPABASE=${SUPABASE:-"npx --yes supabase@2.122.0"}
CONFIG=supabase/config.toml
BACKUP=$(mktemp)
cp "$CONFIG" "$BACKUP"
trap 'cp "$BACKUP" "$CONFIG"; rm -f "$BACKUP"' EXIT
export SEND_SMS_HOOK_SECRET=${SEND_SMS_HOOK_SECRET:-"v1,whsec_$(head -c 24 /dev/urandom | base64)"}
export SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN=${SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN:-local-placeholder}
# LOCAL_NO_CAPTCHA=1 leaves the CAPTCHA out (only for a sandbox that cannot reach Cloudflare from inside Docker).
SKIP=(); [ -n "${LOCAL_NO_CAPTCHA:-}" ] && SKIP=(auth.captcha)
python3 scripts/check-config.py --apply-local "$CONFIG" supabase/local/local-only.toml "${SKIP[@]}"
$SUPABASE "$@"
if [ "${1:-}" = "start" ]; then
  PGPASSWORD=postgres psql -q -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -c "insert into private.local_switches values ('allow_test_numbers') on conflict do nothing"
fi
