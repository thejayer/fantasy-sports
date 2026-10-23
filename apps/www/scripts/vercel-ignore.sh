#!/usr/bin/env bash
# Vercel Ignored Build Step for apps/www.
# Exit 0 = skip this build; exit 1 = proceed.
# Watches the portal app plus the CSS package it vendors.
set -euo pipefail

prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
curr="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$root" ]]; then
  echo "vercel-ignore: not a git checkout — building"
  exit 1
fi
cd "$root"

if [[ -z "$prev" ]]; then
  echo "vercel-ignore: no previous SHA — building"
  exit 1
fi

if ! git cat-file -e "${prev}^{commit}" 2>/dev/null; then
  echo "vercel-ignore: previous SHA not in this clone — building"
  exit 1
fi

if git diff --quiet "$prev" "$curr" -- apps/www packages/sj-ui; then
  echo "vercel-ignore: no changes in apps/www or packages/sj-ui — skipping"
  exit 0
fi

echo "vercel-ignore: apps/www or packages/sj-ui changed — building"
exit 1
