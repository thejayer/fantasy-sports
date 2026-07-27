#!/bin/sh
# Cloud Run entrypoint for the Strictly Jayers hub.
# Syncs current ESPN seasons when cookies are present, then starts Next.js.
set -eu

mkdir -p "${SJ_DATA_DIR:-/app/data/sj}"

# Seed from fixtures so the UI always has something if sync fails.
if [ ! -f "${SJ_DATA_DIR:-/app/data/sj}/index.json" ] && [ -d /app/fixtures/sj ]; then
  cp -a /app/fixtures/sj/. "${SJ_DATA_DIR:-/app/data/sj}/"
fi

if [ "${SJ_SYNC_ON_START:-1}" = "1" ] && [ -n "${ESPN_S2:-}" ] && [ -n "${ESPN_SWID:-}" ]; then
  echo "Syncing ESPN leagues (current seasons)..."
  sj sync --current-only --store-dir "${SJ_DATA_DIR:-/app/data/sj}" \
    || echo "warning: ESPN sync failed; serving existing/fixture snapshots" >&2
else
  echo "Skipping ESPN sync (SJ_SYNC_ON_START=${SJ_SYNC_ON_START:-1}; cookies set=$([ -n "${ESPN_S2:-}" ] && echo yes || echo no))"
fi

export PORT="${PORT:-8080}"
# Next.js standalone binds on HOSTNAME. Auth.js must NOT use this as the public
# site URL — set AUTH_URL to the Cloud Run https URL (see deploy-hub.yml).
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export SJ_DATA_DIR="${SJ_DATA_DIR:-/app/data/sj}"
export AUTH_TRUST_HOST="${AUTH_TRUST_HOST:-true}"

if [ -z "${AUTH_URL:-}" ]; then
  echo "warning: AUTH_URL is unset; OAuth may redirect to ${HOSTNAME}:${PORT}" >&2
fi

cd /app/apps/web
exec node server.js
