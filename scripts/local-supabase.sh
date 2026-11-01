#!/usr/bin/env bash
# Runs a Supabase CLI command with the repo's own supabase/config.toml. Nothing is added or changed.
#   bash scripts/local-supabase.sh start -x studio
#   bash scripts/local-supabase.sh db reset --local
# Sign-up is email only, so there is nothing local-only to switch on. Confirmation emails appear in the local test
# inbox (http://127.0.0.1:54324).
set -euo pipefail
cd "$(dirname "$0")/.."
SUPABASE=${SUPABASE:-"npx --yes supabase@2.122.0"}
python3 scripts/check-config.py
exec $SUPABASE "$@"
