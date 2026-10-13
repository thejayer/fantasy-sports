#!/bin/sh
# Fail if a vendored copy drifted from packages/sj-ui.
set -eu
root="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
src="$root/packages/sj-ui"
fail=0
for dest in \
  "$root/apps/web/src/sj-ui" \
  "$root/apps/www/src/sj-ui" \
  "$root/apps/vibe/src/sj-ui" \
  "$root/apps/fitness/src/sj-ui" \
  "$root/apps/fitness/public/sj-ui"
do
  for file in tokens.css components.css index.css; do
    if ! cmp -s "$src/$file" "$dest/$file"; then
      echo "drift: $dest/$file" >&2
      fail=1
    fi
  done
done
if [ "$fail" -ne 0 ]; then
  echo "Run packages/sj-ui/sync.sh" >&2
  exit 1
fi
echo "sj-ui copies match packages/sj-ui."
