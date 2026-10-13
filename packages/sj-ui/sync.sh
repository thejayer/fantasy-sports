#!/bin/sh
# Copy the shared CSS into each Next app (and the fitness PWA public tree)
# so `next build` does not treat packages/ as outputFileTracingRoot.
# Standalone must stay at .next/standalone/server.js for Docker + html-budget.
set -eu
root="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
src="$root/packages/sj-ui"
for dest in \
  "$root/apps/web/src/sj-ui" \
  "$root/apps/www/src/sj-ui" \
  "$root/apps/vibe/src/sj-ui" \
  "$root/apps/fitness/src/sj-ui" \
  "$root/apps/fitness/public/sj-ui"
do
  mkdir -p "$dest"
  cp "$src/tokens.css" "$src/components.css" "$src/index.css" "$dest/"
done
echo "Copied sj-ui CSS into app trees."
