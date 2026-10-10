#!/usr/bin/env bash
# One-time infrastructure for the Trent / Steve bet tracker (roadmap P.11):
#   - sj-bets-reader service account (share the Google Sheet with this email)
#   - Sheets API
#   - objectUser on the hub/ESPN bucket so the job can write bets/bets.json
#   - Cloud Run job sj-bets (same image as sj-sync) + Scheduler at :32
#
# Run in Cloud Shell after (or before) "deploy sync job":
#   ./scripts/setup-bets-infra.sh
#
# Then Austin shares
#   Trent & Steve Bet Tracker — 2026 Football Season
#   (id 1_F9HCU7uOPH5uo8cgXkxwKrvREolPid_ZoviVVcX3HU)
# with sj-bets-reader@PROJECT.iam.gserviceaccount.com as Viewer.

set -euo pipefail
# shellcheck disable=SC2016

PROJECT="${GCP_PROJECT:-fantasy-sports-analytics}"
REGION="${GCP_REGION:-us-central1}"
BUCKET="${SJ_BUCKET:-${PROJECT}-sj-data}"
BETS_JOB="${SJ_BETS_JOB:-sj-bets}"
BETS_SA_NAME="${SJ_BETS_SA:-sj-bets-reader}"
BETS_SA="${BETS_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
# Gamba updates :17 every 2h from 9:17 AM–11:17 PM CT. Read 15 minutes later.
SCHEDULE="${SJ_BETS_SCHEDULE:-32 9-23/2 * * *}"
TIME_ZONE="${SJ_TIMEZONE:-America/Chicago}"
SCHEDULER_JOB="${SJ_BETS_SCHEDULER_JOB:-sj-bets-trigger}"
SHEET_ID="${SJ_BETS_SHEET_ID:-1_F9HCU7uOPH5uo8cgXkxwKrvREolPid_ZoviVVcX3HU}"

echo "Project:     ${PROJECT}"
echo "Region:      ${REGION}"
echo "Bucket:      gs://${BUCKET}"
echo "Job:         ${BETS_JOB}"
echo "Reader SA:   ${BETS_SA}"
echo "Schedule:    ${SCHEDULE} (${TIME_ZONE})"
echo

gcloud config set project "${PROJECT}" >/dev/null

gcloud services enable \
  run.googleapis.com \
  sheets.googleapis.com \
  storage.googleapis.com \
  cloudscheduler.googleapis.com \
  --project="${PROJECT}"

if ! gcloud iam service-accounts describe "${BETS_SA}" --project="${PROJECT}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${BETS_SA_NAME}" \
    --project="${PROJECT}" \
    --display-name="Strictly Jayers bets sheet reader"
  echo "created ${BETS_SA}"
else
  echo "service account ${BETS_SA} already exists"
fi

gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${BETS_SA}" \
  --role="roles/storage.objectUser" \
  --quiet >/dev/null
echo "granted objectUser on gs://${BUCKET} to ${BETS_SA}"

# Job image is owned by deploy-sync-job.yml. Create a placeholder job if
# missing so the scheduler has a target; the next image deploy fills it in.
if gcloud run jobs describe "${BETS_JOB}" \
    --project="${PROJECT}" --region="${REGION}" >/dev/null 2>&1; then
  gcloud run jobs update "${BETS_JOB}" \
    --project="${PROJECT}" \
    --region="${REGION}" \
    --service-account="${BETS_SA}" \
    --set-env-vars "SJ_BETS_SHEET_ID=${SHEET_ID}"
  echo "updated ${BETS_JOB} to run as ${BETS_SA}"
else
  echo "Cloud Run job ${BETS_JOB} does not exist yet."
  echo "Run GitHub Action \"deploy sync job\" then re-run this script."
fi

SCHEDULER_SA="${SCHEDULER_SA:-sj-scheduler@${PROJECT}.iam.gserviceaccount.com}"
if ! gcloud iam service-accounts describe "${SCHEDULER_SA}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "Scheduler SA ${SCHEDULER_SA} missing — run ./scripts/setup-sync-infra.sh first."
  exit 1
fi

RUN_JOB_V2_URI="https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${BETS_JOB}:run"
if gcloud scheduler jobs describe "${SCHEDULER_JOB}" \
    --project="${PROJECT}" --location="${REGION}" >/dev/null 2>&1; then
  VERB=update
else
  VERB=create
fi
gcloud scheduler jobs "${VERB}" http "${SCHEDULER_JOB}" \
  --project="${PROJECT}" \
  --location="${REGION}" \
  --schedule="${SCHEDULE}" \
  --time-zone="${TIME_ZONE}" \
  --uri="${RUN_JOB_V2_URI}" \
  --http-method=POST \
  --oauth-service-account-email="${SCHEDULER_SA}"
echo "${VERB}d scheduler ${SCHEDULER_JOB} (${SCHEDULE} ${TIME_ZONE})"

cat <<EOF

================================================================
Bet tracker infra ready.

Austin still needs to:

  1. Share the Google Sheet with ${BETS_SA} as Viewer
       Sheet: Trent & Steve Bet Tracker — 2026 Football Season
       id:    ${SHEET_ID}
  2. Add Google OAuth on the existing hub client:
       Authorized JavaScript origin:  https://strictlyjayers.com
       Authorized redirect URI:       https://strictlyjayers.com/api/auth/callback/google
  3. Deploy portal (push CD or workflow_dispatch) so sj-www gets
       AUTH_SECRET / AUTH_GOOGLE_* / ALLOWED_EMAILS and the RO GCS mount.
  4. One-time pull:
       gcloud run jobs execute ${BETS_JOB} --region=${REGION} --project=${PROJECT}

Skip the reader job with SJ_BETS_SYNC=0 on the job env.
================================================================
EOF
