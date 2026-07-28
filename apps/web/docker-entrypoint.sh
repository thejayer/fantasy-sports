#!/bin/sh
# Cloud Run entrypoint for the Strictly Jayers hub.
#
# In production the snapshot directory is a read-only Cloud Storage mount kept
# fresh by the sj-sync Cloud Run Job, so this script normally just starts the
# server. Startup sync stays available (SJ_SYNC_ON_START=1) for local runs and
# for deployments without a bucket.
set -eu

DATA_DIR="${SJ_DATA_DIR:-/app/data/sj}"

mkdir -p "$DATA_DIR" 2>/dev/null || true

writable=0
if [ -w "$DATA_DIR" ]; then
  writable=1
fi

if [ "$writable" = "1" ] && [ ! -f "$DATA_DIR/index.json" ] && [ -d /app/fixtures/sj ]; then
  # Seed sample data so the UI renders before the first successful sync.
  cp -a /app/fixtures/sj/. "$DATA_DIR/" 2>/dev/null || true
fi

if [ -f "$DATA_DIR/index.json" ]; then
  echo "Snapshots available at $DATA_DIR"
else
  echo "No snapshots at $DATA_DIR; falling back to bundled fixtures" >&2
fi

if [ "${SJ_SYNC_ON_START:-0}" = "1" ] && [ -n "${ESPN_S2:-}" ] && [ -n "${ESPN_SWID:-}" ]; then
  if [ "$writable" = "1" ]; then
    echo "Syncing ESPN leagues (current seasons)..."
    python -m sj.cli sync --current-only --store-dir "$DATA_DIR" \
      || echo "warning: ESPN sync failed; serving existing snapshots" >&2
  else
    echo "Skipping startup sync: $DATA_DIR is read-only (sj-sync job owns writes)"
  fi
fi

export PORT="${PORT:-8080}"
# Next.js standalone binds on HOSTNAME. Auth.js must NOT use this as the public
# site URL — set AUTH_URL to the Cloud Run https URL (see deploy-hub.yml).
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export SJ_DATA_DIR="$DATA_DIR"
export AUTH_TRUST_HOST="${AUTH_TRUST_HOST:-true}"

if [ -z "${AUTH_URL:-}" ]; then
  echo "warning: AUTH_URL is unset; OAuth may redirect to ${HOSTNAME}:${PORT}" >&2
fi

cd /app/apps/web
exec node server.js
