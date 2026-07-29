#!/bin/sh
# Cloud Run entrypoint for the Strictly Jayers hub.
#
# In production SJ_DATA_DIR is a read-only GCS mount (ESPN sync store) and
# SJ_HUB_DIR is a separate read-write GCS mount (golf / members). Startup sync
# stays available (SJ_SYNC_ON_START=1) for local runs without a bucket.
set -eu

DATA_DIR="${SJ_DATA_DIR:-/app/data/sj}"
HUB_DIR="${SJ_HUB_DIR:-/app/data/hub}"

# Production (SJ_SYNC_ON_START=0): do not mkdir/stat/test GCS FUSE mounts before
# listen. A slow/broken mount hangs the entrypoint and Cloud Run kills the
# revision for never binding PORT. Next reads both stores on request.
if [ "${SJ_SYNC_ON_START:-0}" != "1" ]; then
  echo "Starting hub (SJ_SYNC_ON_START=0); ESPN=$DATA_DIR hub=$HUB_DIR"
else
  mkdir -p "$DATA_DIR" "$HUB_DIR" 2>/dev/null || true

  writable=0
  # Cap FUSE/stat waits so a bad mount cannot block Node forever.
  if timeout 3 sh -c "test -w \"$DATA_DIR\"" 2>/dev/null; then
    writable=1
  fi

  if [ "$writable" = "1" ] && ! timeout 3 sh -c "test -f \"$DATA_DIR/index.json\"" 2>/dev/null \
      && [ -d /app/fixtures/sj ]; then
    cp -a /app/fixtures/sj/. "$DATA_DIR/" 2>/dev/null || true
  fi

  if timeout 3 sh -c "test -f \"$DATA_DIR/index.json\"" 2>/dev/null; then
    echo "Snapshots available at $DATA_DIR"
  else
    echo "No snapshots at $DATA_DIR; falling back to bundled fixtures" >&2
  fi

  if [ -n "${ESPN_S2:-}" ] && [ -n "${ESPN_SWID:-}" ]; then
    if [ "$writable" = "1" ]; then
      echo "Syncing ESPN leagues (current seasons)..."
      python -m sj.cli sync --current-only --store-dir "$DATA_DIR" \
        || echo "warning: ESPN sync failed; serving existing snapshots" >&2
    else
      echo "Skipping startup sync: $DATA_DIR is not writable (sj-sync job owns writes)"
    fi
  else
    echo "Skipping ESPN sync (cookies unset)"
  fi
fi

export PORT="${PORT:-8080}"
# Next.js standalone listens on process.env.HOSTNAME. Cloud Run sets HOSTNAME
# to the instance id (unresolvable → getaddrinfo EAI_AGAIN / port probe fail).
# Always bind all interfaces; public URL is AUTH_URL (see deploy-hub.yml).
export HOSTNAME=0.0.0.0
export SJ_DATA_DIR="$DATA_DIR"
export SJ_HUB_DIR="$HUB_DIR"
export AUTH_TRUST_HOST="${AUTH_TRUST_HOST:-true}"

if [ -z "${AUTH_URL:-}" ]; then
  echo "warning: AUTH_URL is unset; OAuth may redirect incorrectly" >&2
fi

cd /app/apps/web
exec node server.js
