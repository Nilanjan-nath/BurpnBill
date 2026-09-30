#!/usr/bin/env bash
# Deploy the latest master on the VM: pull, install, build, restart, health-check.
# If the health check fails, put the previous web build and commit back.
# Run as the burpnbill user:  cd /opt/burpnbill && ./deploy/deploy.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

SERVICE=burpnbill-api
HEALTH_URL="http://127.0.0.1:4000/health/ready"

PREV_COMMIT="$(git rev-parse HEAD)"
echo "==> Current commit: $PREV_COMMIT"

rm -rf web/dist.prev
[ -d web/dist ] && cp -a web/dist web/dist.prev

echo "==> Pulling"
git pull --ff-only

echo "==> Installing"
npm ci --prefix server --omit=dev
npm ci --prefix web

echo "==> Building web"
npm run build --prefix web

echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

healthy() {
  for _ in $(seq 1 20); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

if healthy; then
  echo "==> Healthy at $(git rev-parse --short HEAD)"
  rm -rf web/dist.prev
  exit 0
fi

echo "!! Health check failed; rolling back to $PREV_COMMIT" >&2
git reset --hard "$PREV_COMMIT"
if [ -d web/dist.prev ]; then rm -rf web/dist && mv web/dist.prev web/dist; fi
npm ci --prefix server --omit=dev
sudo systemctl restart "$SERVICE"
if healthy; then echo "!! Rolled back and healthy again" >&2; else echo "!! Still unhealthy after rollback: journalctl -u $SERVICE -n 100" >&2; fi
exit 1
