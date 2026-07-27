#!/usr/bin/env bash
# Grant the Cloud Run runtime service account access to hub secrets.
#
# Run once in Cloud Shell after create-hub-secrets.sh:
#   ./scripts/grant-hub-secret-access.sh
#
# Override the runtime SA if you use a custom one:
#   CLOUD_RUN_SA=sj-hub@fantasy-sports-analytics.iam.gserviceaccount.com \
#     ./scripts/grant-hub-secret-access.sh

set -euo pipefail

PROJECT="${GCP_PROJECT:-fantasy-sports-analytics}"
SECRETS=(
  sj-auth-secret
  sj-auth-google-id
  sj-auth-google-secret
  sj-allowed-emails
  sj-espn-s2
  sj-espn-swid
)

if [[ -n "${CLOUD_RUN_SA:-}" ]]; then
  SA="${CLOUD_RUN_SA}"
else
  PROJECT_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
  # Default Compute Engine SA used by Cloud Run unless you set a custom one.
  SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

echo "Project: ${PROJECT}"
echo "Runtime SA: ${SA}"

for name in "${SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "${name}" \
    --project="${PROJECT}" \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
  echo "granted accessor on ${name}"
done

echo "Done."
