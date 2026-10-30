#!/usr/bin/env bash
# Updates the Provider Kit in vendor/ to a pinned stellar-agent-services commit.
#
# The kit isn't on npm yet, so this project depends on three packed packages in vendor/*.tgz, the same way
# `npm create stellar-service` sets a project up. They are committed, so a clone (and the server) installs with
# plain `npm ci`: nobody but the person updating the kit runs this script.
#
#   bash scripts/update-kit.sh              # the pinned commit below
#   KIT_COMMIT=<sha> bash scripts/update-kit.sh
#
# The clone stays in vendor/stellar-agent-services (git-ignored); `npm run verifier` runs from it.
set -euo pipefail

KIT_REPO="${KIT_REPO:-https://github.com/AlgoriaLabs/stellar-agent-services.git}"
KIT_COMMIT="${KIT_COMMIT:-afa5cd09966bd6c0977a6bad4de4a7b7fbcd422c}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/vendor/stellar-agent-services"

if [ ! -d "$DIR/.git" ]; then
  mkdir -p "$DIR"
  git init -q "$DIR"
  git -C "$DIR" remote add origin "$KIT_REPO"
fi

echo "→ stellar-agent-services @ ${KIT_COMMIT:0:7}"
git -C "$DIR" fetch -q --depth 1 origin "$KIT_COMMIT"
git -C "$DIR" checkout -q --force FETCH_HEAD

echo "→ building the kit and its wallet approval page (~1 min)"
(cd "$DIR" && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent)

echo "→ packing protocol, payment-client and provider-kit into vendor/"
rm -f "$ROOT"/vendor/*.tgz
(cd "$DIR" && npm pack --silent \
  -w packages/protocol -w packages/payment-client -w packages/provider-kit \
  --pack-destination "$ROOT/vendor" >/dev/null)
echo "$KIT_COMMIT" > "$ROOT/vendor/KIT_COMMIT"

echo "→ reinstalling (refreshes package-lock.json)"
(cd "$ROOT" && rm -rf node_modules/@stellar-agent-services && npm install --no-audit --no-fund --loglevel=error)

for file in "$ROOT"/vendor/*.tgz; do echo "vendor/$(basename "$file")"; done
echo "✓ kit updated. Commit vendor/ and package-lock.json."
