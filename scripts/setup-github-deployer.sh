#!/usr/bin/env bash
# Ensure the GitHub Actions deployer service account + project roles, and print
# the Workload Identity Federation binding commands (no JSON key).
#
# Run in Cloud Shell:
#   ./scripts/setup-github-deployer.sh
#
# One-time WIF (pool + provider + SA binding) is documented below. Deploy
# workflows authenticate via OIDC — do NOT create or store GCP_SA_KEY.

set -euo pipefail

PROJECT="${GCP_PROJECT:-fantasy-sports-analytics}"
SA_NAME="${DEPLOYER_SA_NAME:-ffa-deployer}"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
POOL="${WIF_POOL:-github}"
PROVIDER="${WIF_PROVIDER:-github}"
REPO="${GITHUB_REPO:-thejayer/fantasy-sports}"
REPO_OWNER="${REPO%%/*}"

echo "Project: ${PROJECT}"
echo "Service account: ${SA_EMAIL}"

gcloud config set project "${PROJECT}" >/dev/null

gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project="${PROJECT}"

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"

if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_NAME}" \
    --project="${PROJECT}" \
    --display-name="GitHub Actions deployer (ffa + Strictly Jayers hub)"
  echo "created service account ${SA_EMAIL}"
else
  echo "service account already exists"
fi

# Roles needed to build/push images and deploy Cloud Run with --set-secrets.
#
# Deliberately narrow:
#   artifactregistry.writer  -- push images; does not need to delete repos or
#                               edit registry IAM the way admin does.
#   secretmanager.viewer     -- resolve secret *names* referenced by
#                               --set-secrets. It cannot read secret values;
#                               only the Cloud Run runtime SA needs that, which
#                               grant-hub-secret-access.sh handles.
for role in \
  run.admin \
  iam.serviceAccountUser \
  artifactregistry.writer \
  serviceusage.serviceUsageAdmin \
  secretmanager.viewer
do
  gcloud projects add-iam-policy-binding "${PROJECT}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/${role}" \
    --condition=None \
    --quiet >/dev/null
  echo "ensured roles/${role}"
done

cat <<NOTE

Note: this account is intentionally NOT granted secretAccessor. If you ran an
earlier version of this script, remove the leftover grants:

  gcloud projects remove-iam-policy-binding ${PROJECT} \\
    --member=serviceAccount:${SA_EMAIL} --role=roles/secretmanager.secretAccessor
  gcloud projects remove-iam-policy-binding ${PROJECT} \\
    --member=serviceAccount:${SA_EMAIL} --role=roles/artifactregistry.admin

and drop the per-secret accessor bindings it added for this SA:

  gcloud secrets remove-iam-policy-binding SECRET_NAME \\
    --member=serviceAccount:${SA_EMAIL} --role=roles/secretmanager.secretAccessor

================================================================
Workload Identity Federation (preferred — no JSON key)

# 1. Pool
gcloud iam workload-identity-pools create ${POOL} \\
  --project=${PROJECT} --location=global --display-name="GitHub Actions"

# 2. GitHub OIDC provider
gcloud iam workload-identity-pools providers create-oidc ${PROVIDER} \\
  --project=${PROJECT} --location=global --workload-identity-pool=${POOL} \\
  --display-name="GitHub" \\
  --issuer-uri="https://token.actions.githubusercontent.com" \\
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \\
  --attribute-condition="assertion.repository_owner == '${REPO_OWNER}'"

# 3. Let this repo impersonate the deployer SA
gcloud iam service-accounts add-iam-policy-binding ${SA_EMAIL} \\
  --project=${PROJECT} \\
  --role="roles/iam.workloadIdentityUser" \\
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}"

Provider resource name (already hardcoded in deploy workflows):
  projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}

After WIF works, delete any old JSON keys and the GitHub secret GCP_SA_KEY:

  gcloud iam service-accounts keys list --iam-account=${SA_EMAIL} --project=${PROJECT}
  gcloud iam service-accounts keys delete KEY_ID --iam-account=${SA_EMAIL} --project=${PROJECT}
  # GitHub → Settings → Secrets → Actions → delete GCP_SA_KEY
================================================================
NOTE
