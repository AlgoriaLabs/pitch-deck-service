#!/usr/bin/env bash
# Runs on the VM (as root) for each `terraform apply` that changed something.
# Unpacks a new release, builds it, swaps the `current` symlink, restarts, and checks health.
# Keeps the last 3 releases, so a rollback is: ln -sfn releases/<old> current && systemctl restart.
set -euo pipefail

APP=/opt/pitch-deck-agent
RELEASE="$APP/releases/$(date -u +%Y%m%d%H%M%S)"
as_deck() { sudo -u deck -H env HOME=/var/lib/pitch-deck-agent "$@"; }

chmod 600 /tmp/pitch-deck-agent.env

echo "→ unpacking release $(basename "$RELEASE")"
mkdir -p "$RELEASE"
unzip -q /tmp/pitch-deck-agent.zip -d "$RELEASE"
chown -R deck:deck "$RELEASE"

echo "→ building"
cd "$RELEASE"
# The Provider Kit comes packed in vendor/*.tgz, so this is a plain install from the lockfile.
as_deck npm ci --no-audit --no-fund --loglevel=error
as_deck npm run build --silent
as_deck npm prune --omit=dev --no-audit --no-fund --loglevel=error

echo "→ checking the new config (the running release keeps serving if this fails)"
if ! DATA_DIR=/var/lib/pitch-deck-agent node --env-file=/tmp/pitch-deck-agent.env "$RELEASE/dist/cli/check-config.js"; then
  rm -rf "$RELEASE" /tmp/pitch-deck-agent.env
  echo "✗ deploy stopped: fix terraform.tfvars and apply again"
  exit 1
fi

echo "→ installing config"
install -m 0640 -o root -g deck /tmp/pitch-deck-agent.env /etc/pitch-deck-agent/env
install -m 0644 /tmp/Caddyfile /etc/caddy/Caddyfile
rm -f /tmp/pitch-deck-agent.env /tmp/pitch-deck-agent.zip

echo "→ switching and restarting"
ln -sfn "$RELEASE" "$APP/current"
systemctl daemon-reload
systemctl restart pitch-deck-agent
systemctl reload caddy || systemctl restart caddy

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1; then
    echo "✓ healthy: $(curl -fsS http://127.0.0.1:8787/healthz)"
    break
  fi
  if [ "$i" = 30 ]; then
    echo "✗ not healthy after 60s. Last log lines:"
    journalctl -u pitch-deck-agent -n 40 --no-pager
    exit 1
  fi
  sleep 2
done

# Keep the last 3 releases.
ls -1dt "$APP"/releases/* | tail -n +4 | xargs -r rm -rf
