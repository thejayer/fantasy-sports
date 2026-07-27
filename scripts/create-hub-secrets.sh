#!/usr/bin/env bash
# Create Strictly Jayers Secret Manager shells in GCP.
#
# Run in Cloud Shell (or any machine with gcloud authenticated):
#   ./scripts/create-hub-secrets.sh
#
# This creates the secret *names* with a REPLACE_ME placeholder version.
# You then add real values with:
#   ./scripts/add-hub-secret-version.sh sj-auth-google-id
# or the gcloud commands printed at the end / documented in HUB.md.

set -euo pipefail

PROJECT="${GCP_PROJECT:-fantasy-sports-analytics}"
REGION="${GCP_REGION:-us-central1}"

SECRETS=(
  sj-auth-secret
  sj-auth-google-id
  sj-auth-google-secret
  sj-allowed-emails
  sj-espn-s2
  sj-espn-swid
)

echo "Project: ${PROJECT}"
echo "Ensuring Secret Manager API is enabled..."
gcloud services enable secretmanager.googleapis.com --project="${PROJECT}"

created=0
existing=0
for name in "${SECRETS[@]}"; do
  if gcloud secrets describe "${name}" --project="${PROJECT}" >/dev/null 2>&1; then
    echo "exists: ${name}"
    existing=$((existing + 1))
    continue
  fi

  gcloud secrets create "${name}" \
    --project="${PROJECT}" \
    --replication-policy="user-managed" \
    --locations="${REGION}"

  # Secret Manager requires an initial version; overwrite later in Cloud Shell.
  printf 'REPLACE_ME' | gcloud secrets versions add "${name}" \
    --project="${PROJECT}" \
    --data-file=-

  echo "created: ${name}"
  created=$((created + 1))
done

echo
echo "Done. created=${created} already_existed=${existing}"
echo
echo "Next: populate real values in Cloud Shell, e.g.:"
echo "  ./scripts/add-hub-secret-version.sh sj-auth-secret"
echo "  ./scripts/add-hub-secret-version.sh sj-auth-google-id"
echo "  ./scripts/add-hub-secret-version.sh sj-auth-google-secret"
echo "  ./scripts/add-hub-secret-version.sh sj-allowed-emails"
echo "  ./scripts/add-hub-secret-version.sh sj-espn-s2"
echo "  ./scripts/add-hub-secret-version.sh sj-espn-swid"
echo
echo "Or generate AUTH_SECRET now:"
echo "  openssl rand -base64 32 | gcloud secrets versions add sj-auth-secret --project=${PROJECT} --data-file=-"
