#!/usr/bin/env bash
# Create (or reuse) the GitHub Actions deployer service account and print a
# JSON key to paste into the GitHub secret GCP_SA_KEY.
#
# Run in Cloud Shell:
#   ./scripts/setup-github-deployer.sh
#
# Then:
#   GitHub → repo Settings → Secrets and variables → Actions
#   → New repository secret
#   Name:  GCP_SA_KEY
#   Value: full contents of the printed / downloaded key.json

set -euo pipefail

PROJECT="${GCP_PROJECT:-fantasy-sports-analytics}"
SA_NAME="${DEPLOYER_SA_NAME:-ffa-deployer}"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
OUT="${1:-key.json}"

echo "Project: ${PROJECT}"
echo "Service account: ${SA_EMAIL}"

gcloud config set project "${PROJECT}" >/dev/null

gcloud services enable \
  iam.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project="${PROJECT}"

if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_NAME}" \
    --project="${PROJECT}" \
    --display-name="GitHub Actions deployer (ffa + Strictly Jayers hub)"
  echo "created service account ${SA_EMAIL}"
else
  echo "service account already exists"
fi

# Roles needed to build/push images and deploy Cloud Run with --set-secrets.
for role in \
  run.admin \
  iam.serviceAccountUser \
  artifactregistry.admin \
  serviceusage.serviceUsageAdmin \
  secretmanager.secretAccessor
do
  gcloud projects add-iam-policy-binding "${PROJECT}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/${role}" \
    --condition=None \
    --quiet >/dev/null
  echo "ensured roles/${role}"
done

# Also allow this SA to bind the hub secrets onto Cloud Run (same accessor).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -x "${ROOT}/scripts/grant-hub-secret-access.sh" ]]; then
  CLOUD_RUN_SA="${SA_EMAIL}" "${ROOT}/scripts/grant-hub-secret-access.sh" || true
fi

echo
echo "Creating a new JSON key → ${OUT}"
gcloud iam service-accounts keys create "${OUT}" \
  --iam-account="${SA_EMAIL}" \
  --project="${PROJECT}"

echo
echo "================================================================"
echo "Add this as a GitHub Actions repository secret:"
echo
echo "  1. Open https://github.com/thejayer/fantasy-sports/settings/secrets/actions"
echo "  2. New repository secret"
echo "  3. Name:  GCP_SA_KEY"
echo "  4. Value: paste the ENTIRE contents of ${OUT}"
echo "  5. Delete ${OUT} from Cloud Shell afterward (rm ${OUT})"
echo
echo "Then re-run: Actions → deploy hub → Run workflow"
echo "================================================================"
echo
echo "Key file preview (first line only):"
head -n 1 "${OUT}"
echo "..."
