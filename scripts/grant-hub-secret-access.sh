#!/usr/bin/env bash
# Grant the Cloud Run runtime service account access to hub secrets.
#
# Run once in Cloud Shell after create-hub-secrets.sh:
#   ./scripts/grant-hub-secret-access.sh
#
# Override the runtime SA if you use a custom one:
#   CLOUD_RUN_SA=<HUB_RUNTIME_SA_EMAIL> \
#     ./scripts/grant-hub-secret-access.sh
# Real project id: GitHub repo secret GCP_PROJECT_ID (Austin).

set -euo pipefail

: "${GCP_PROJECT:?set GCP_PROJECT}"
PROJECT="${GCP_PROJECT}"
SECRETS=(
  sj-auth-secret
  sj-auth-google-id
  sj-auth-google-secret
  sj-allowed-emails
  sj-espn-s2
  sj-espn-swid
  # Weekly recap columnist (roadmap 7.15). Cheap default is gpt-5.6-luna.
  openai-api-key
  # Read by the ffa dashboard service, which shares the runtime SA by default.
  ffa-dashboard-password
  # Vibe Split (sj-vibe) GitHub OAuth + encrypted PAT key + cron bearer.
  sj-vibe-github-client-id
  sj-vibe-github-client-secret
  sj-vibe-token-key
  sj-vibe-cron-secret
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
