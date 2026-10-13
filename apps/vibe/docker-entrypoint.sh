#!/bin/sh
# Cloud Run entrypoint for Strictly Jayers Vibe Split.
set -eu

export PORT="${PORT:-8080}"
# Cloud Run injects HOSTNAME as the instance id; Next standalone binds on that
# var and dies with getaddrinfo EAI_AGAIN if left alone.
export HOSTNAME=0.0.0.0

echo "Starting sj-vibe on ${HOSTNAME}:${PORT} (SITE_URL=${SITE_URL:-unset} AUTH_URL=${AUTH_URL:-unset})"
cd /app/apps/vibe
exec node server.js
