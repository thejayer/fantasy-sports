#!/bin/sh
# Cloud Run entrypoint for the Strictly Jayers community portal (apex).
set -eu

export PORT="${PORT:-8080}"
# Cloud Run injects HOSTNAME as the instance id; Next standalone binds on that
# var and dies with getaddrinfo EAI_AGAIN if left alone.
export HOSTNAME=0.0.0.0

echo "Starting sj-www on ${HOSTNAME}:${PORT} (SITE_URL=${SITE_URL:-unset})"
cd /app/apps/www
exec node server.js
