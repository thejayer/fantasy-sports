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

# The sign-out-everywhere code is shared by copy (apps do not import each
# other): the chain module in all four apps, the confirm in www, hub and vibe,
# and the confirm's words in fitness's plain-JS chrome.
copies_match() {
  ref="$1"
  shift
  for f in "$@"; do
    if ! cmp -s "$ref" "$f"; then
      echo "drift: $f (differs from $ref)" >&2
      fail=1
    fi
  done
}
copies_match "$root/apps/www/src/lib/signout-chain.ts" \
  "$root/apps/web/src/lib/signout-chain.ts" \
  "$root/apps/fitness/src/lib/signout-chain.ts" \
  "$root/apps/vibe/src/lib/signout-chain.ts"
copies_match "$root/apps/www/src/lib/signout-chain.test.ts" \
  "$root/apps/web/src/lib/signout-chain.test.ts" \
  "$root/apps/fitness/src/lib/signout-chain.test.ts" \
  "$root/apps/vibe/src/lib/signout-chain.test.ts"
copies_match "$root/apps/www/src/components/SignOutDialog.tsx" \
  "$root/apps/web/src/components/SignOutDialog.tsx" \
  "$root/apps/vibe/src/components/SignOutDialog.tsx"
for words in "Sign out of all Strictly Jayers sites?" "You'll need to sign in with Google again."; do
  for f in "$root/apps/www/src/components/SignOutDialog.tsx" "$root/apps/fitness/public/sj-chrome.js"; do
    if ! grep -qF "$words" "$f"; then
      echo "drift: $f no longer says \"$words\"" >&2
      fail=1
    fi
  done
done
if [ "$fail" -ne 0 ]; then
  echo "Sign-out copies drifted; edit apps/www and copy it to the others." >&2
  exit 1
fi
echo "Sign-out copies match."
