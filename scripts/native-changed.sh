#!/usr/bin/env bash
# Decides between an over-the-air update and a new store build.
# Prints "native_changed=true|false" (and a reason) on stdout, one per line, safe to append to $GITHUB_OUTPUT.
# Compares the Expo fingerprint (native code, native dependencies, native config) of HEAD with the commit of the
# git tag "deployed-mobile" (moved by deploy.yml after each successful mobile deploy).
# No tag yet means no app has been released: a build is needed.
set -euo pipefail

FINGERPRINT="@expo/fingerprint@0.21.7"
root=$(git rev-parse --show-toplevel)
base=$(git rev-parse -q --verify "refs/tags/deployed-mobile^{commit}" || true)

if [ -z "$base" ]; then
  echo "native_changed=true"
  echo "reason=no previous mobile deploy found (first release needs a build)"
  exit 0
fi

fp() { # fp <directory with the repo checked out>
  (cd "$1/apps/mobile" && npm ci --silent --no-audit --no-fund >&2 && npx --yes "$FINGERPRINT" fingerprint:generate 2>/dev/null | jq -r .hash)
}

now=$(fp "$root")
tmp=$(mktemp -d)
trap 'git worktree remove --force "$tmp/base" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
git worktree add --detach "$tmp/base" "$base" >&2
before=$(fp "$tmp/base")

if [ "$now" = "$before" ]; then
  echo "native_changed=false"
  echo "reason=native fingerprint unchanged ($now)"
else
  echo "native_changed=true"
  echo "reason=native fingerprint changed ($before -> $now)"
fi
