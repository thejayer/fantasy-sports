#!/usr/bin/env bash
# Add a new version to a Strictly Jayers hub secret (interactive).
#
# Usage:
#   ./scripts/add-hub-secret-version.sh sj-auth-google-id
#   ./scripts/add-hub-secret-version.sh sj-allowed-emails
#
# You will be prompted to paste the secret value (input is not echoed).

set -euo pipefail

PROJECT="${GCP_PROJECT:-fantasy-sports-analytics}"
NAME="${1:-}"

if [[ -z "${NAME}" ]]; then
  echo "Usage: $0 <secret-name>" >&2
  echo "Known secrets:" >&2
  echo "  sj-auth-secret" >&2
  echo "  sj-auth-google-id" >&2
  echo "  sj-auth-google-secret" >&2
  echo "  sj-allowed-emails" >&2
  echo "  sj-espn-s2" >&2
  echo "  sj-espn-swid" >&2
  echo "  openai-api-key" >&2
  echo "  ffa-dashboard-password" >&2
  exit 1
fi

if ! gcloud secrets describe "${NAME}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "Secret '${NAME}' does not exist in ${PROJECT}." >&2
  echo "Run ./scripts/create-hub-secrets.sh first." >&2
  exit 1
fi

echo "Adding a new version to ${NAME} in project ${PROJECT}."
echo "Paste the secret value, then press Enter:"
# -s hides input so cookies/tokens aren't echoed into shell history panes as clearly.
IFS= read -r -s VALUE
echo
if [[ -z "${VALUE}" ]]; then
  echo "Empty value; aborting." >&2
  exit 1
fi

printf '%s' "${VALUE}" | gcloud secrets versions add "${NAME}" \
  --project="${PROJECT}" \
  --data-file=-

echo "Added new version to ${NAME}."
