#!/bin/sh
# Cloud Run entrypoint for Strictly Jayers Fitness.
set -eu

export PORT="${PORT:-8080}"
# Cloud Run injects HOSTNAME as the instance id; Next standalone binds on that
# var and dies with getaddrinfo EAI_AGAIN if left alone.
export HOSTNAME=0.0.0.0

echo "Starting sj-fitness on ${HOSTNAME}:${PORT} (SITE_URL=${SITE_URL:-unset})"
cd /app/apps/fitness
exec node server.js
