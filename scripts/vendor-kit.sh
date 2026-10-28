#!/usr/bin/env bash
# Fetches and builds stellar-agent-services (provider-kit, verifier, payment client) at a pinned commit.
# The packages are not on npm yet, so this repo links them from vendor/. Safe to run again.
set -euo pipefail

KIT_REPO="${KIT_REPO:-https://github.com/AlgoriaLabs/stellar-agent-services.git}"
KIT_COMMIT="${KIT_COMMIT:-5f400b1f907d649d3576dc307b867e2c5f754881}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor/stellar-agent-services"

if [ ! -d "$DIR/.git" ]; then
  git init -q "$DIR"
  git -C "$DIR" remote add origin "$KIT_REPO"
fi

if [ "$(git -C "$DIR" rev-parse HEAD 2>/dev/null || true)" != "$KIT_COMMIT" ]; then
  echo "→ fetching stellar-agent-services @ ${KIT_COMMIT:0:7}"
  git -C "$DIR" fetch -q --depth 1 origin "$KIT_COMMIT"
  git -C "$DIR" checkout -q --force FETCH_HEAD
fi

PACK="$(dirname "$DIR")/pack"
if [ ! -f "$PACK/stellar-agent-services-provider-kit-0.0.0.tgz" ] || [ "${FORCE_BUILD:-0}" = "1" ]; then
  echo "→ installing and building the kit (one time, ~1 min)"
  (cd "$DIR" && npm ci --no-audit --no-fund --loglevel=error \
    && npx tsc -b packages/provider-kit packages/verifier packages/payment-client)
  # npm can't link a package out of another workspace, so the app installs these two as tarballs.
  mkdir -p "$PACK"
  (cd "$DIR" && npm pack --silent -w packages/protocol -w packages/provider-kit --pack-destination "$PACK" >/dev/null)
fi

echo "✓ provider-kit ready at vendor/stellar-agent-services"
