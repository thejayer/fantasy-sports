#!/usr/bin/env bash
# One-time infrastructure for durable Strictly Jayers data:
#   - a Cloud Storage bucket for league snapshots
#   - IAM so the sync job can write and the hub can read
#   - a Cloud Scheduler trigger for the sync Cloud Run Job
#
# Run in Cloud Shell:
#   ./scripts/setup-sync-infra.sh
#
# Deploy the job itself with the "deploy sync job" GitHub Action.

set -euo pipefail

PROJECT="${GCP_PROJECT:-fantasy-sports-analytics}"
REGION="${GCP_REGION:-us-central1}"
BUCKET="${SJ_BUCKET:-${PROJECT}-sj-data}"
JOB="${SJ_JOB:-sj-sync}"
SCHEDULE="${SJ_SCHEDULE:-*/30 * * * *}"
SCHEDULER_JOB="${SJ_SCHEDULER_JOB:-sj-sync-trigger}"

echo "Project:  ${PROJECT}"
echo "Region:   ${REGION}"
echo "Bucket:   gs://${BUCKET}"
echo "Schedule: ${SCHEDULE}"
echo

gcloud config set project "${PROJECT}" >/dev/null

gcloud services enable \
  run.googleapis.com \
  storage.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  --project="${PROJECT}"

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
RUNTIME_SA="${CLOUD_RUN_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

# --- Bucket -----------------------------------------------------------------
if gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "bucket already exists"
else
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="${PROJECT}" \
    --location="${REGION}" \
    --uniform-bucket-level-access
  echo "created gs://${BUCKET}"
fi

# The sync job writes snapshots; the hub service reads them through a volume mount.
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/storage.objectAdmin" \
  --quiet >/dev/null
echo "granted objectAdmin on the bucket to ${RUNTIME_SA}"

# --- Scheduler --------------------------------------------------------------
SCHEDULER_SA="${SCHEDULER_SA:-sj-scheduler@${PROJECT}.iam.gserviceaccount.com}"
if ! gcloud iam service-accounts describe "${SCHEDULER_SA}" --project="${PROJECT}" >/dev/null 2>&1; then
  gcloud iam service-accounts create sj-scheduler \
    --project="${PROJECT}" \
    --display-name="Strictly Jayers sync scheduler"
  echo "created ${SCHEDULER_SA}"
fi

gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${SCHEDULER_SA}" \
  --role="roles/run.invoker" \
  --condition=None \
  --quiet >/dev/null
echo "granted run.invoker to ${SCHEDULER_SA}"

RUN_JOB_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run"

if gcloud scheduler jobs describe "${SCHEDULER_JOB}" \
    --project="${PROJECT}" --location="${REGION}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${SCHEDULER_JOB}" \
    --project="${PROJECT}" \
    --location="${REGION}" \
    --schedule="${SCHEDULE}" \
    --uri="${RUN_JOB_URI}" \
    --http-method=POST \
    --oauth-service-account-email="${SCHEDULER_SA}"
  echo "updated scheduler ${SCHEDULER_JOB}"
else
  gcloud scheduler jobs create http "${SCHEDULER_JOB}" \
    --project="${PROJECT}" \
    --location="${REGION}" \
    --schedule="${SCHEDULE}" \
    --uri="${RUN_JOB_URI}" \
    --http-method=POST \
    --oauth-service-account-email="${SCHEDULER_SA}"
  echo "created scheduler ${SCHEDULER_JOB}"
fi

cat <<EOF

================================================================
Infrastructure ready.

Next:
  1. GitHub → Actions → "deploy sync job" → Run workflow
       bucket: ${BUCKET}
  2. GitHub → Actions → "deploy hub" → Run workflow
       (mounts gs://${BUCKET} read-only at /app/data/sj)
  3. One-time history backfill:
       gcloud run jobs execute ${JOB} --args=backfill \\
         --region=${REGION} --project=${PROJECT}

The scheduler runs "${SCHEDULE}". Change it with:
  gcloud scheduler jobs update http ${SCHEDULER_JOB} \\
    --location=${REGION} --schedule="0 * * * *"
================================================================
EOF
