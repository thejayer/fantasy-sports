#!/usr/bin/env bash
# One-time infrastructure for durable Strictly Jayers data:
#   - a Cloud Storage bucket for league snapshots (+ hub golf/members)
#   - IAM so the sync job and hub can write that bucket
#   - a Cloud Scheduler trigger for the sync Cloud Run Job
#   - optional …-sj-hub bucket (reserved; dual FUSE mount is disabled on hub)
#
# Run in Cloud Shell:
#   ./scripts/setup-sync-infra.sh
#
# Deploy the job itself with the "deploy sync job" GitHub Action.

set -euo pipefail

PROJECT="${GCP_PROJECT:-fantasy-sports-analytics}"
REGION="${GCP_REGION:-us-central1}"
BUCKET="${SJ_BUCKET:-${PROJECT}-sj-data}"
HUB_BUCKET="${SJ_HUB_BUCKET:-${PROJECT}-sj-hub}"
JOB="${SJ_JOB:-sj-sync}"
# Daily 6:00 America/Chicago (matches live sj-sync-trigger). Override with SJ_SCHEDULE.
SCHEDULE="${SJ_SCHEDULE:-0 6 * * *}"
TIME_ZONE="${SJ_TIMEZONE:-America/Chicago}"
SCHEDULER_JOB="${SJ_SCHEDULER_JOB:-sj-sync-trigger}"

echo "Project:     ${PROJECT}"
echo "Region:      ${REGION}"
echo "ESPN bucket: gs://${BUCKET}"
echo "Hub bucket:  gs://${HUB_BUCKET}"
echo "Schedule:    ${SCHEDULE} (${TIME_ZONE})"
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

# --- Buckets ----------------------------------------------------------------
# Shared store: sj-sync writes ESPN snapshots; hub mounts the same bucket RW
# for golf / members / auction (dual FUSE failed Cloud Run PORT probes).
if gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "ESPN/hub bucket already exists"
else
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="${PROJECT}" \
    --location="${REGION}" \
    --uniform-bucket-level-access
  echo "created gs://${BUCKET}"
fi

# Optional reserved bucket (not mounted by deploy-hub; kept for future split).
if gcloud storage buckets describe "gs://${HUB_BUCKET}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "reserved hub bucket already exists (not mounted by deploy-hub)"
else
  gcloud storage buckets create "gs://${HUB_BUCKET}" \
    --project="${PROJECT}" \
    --location="${REGION}" \
    --uniform-bucket-level-access
  echo "created gs://${HUB_BUCKET} (reserved; not mounted by deploy-hub)"
fi

# By default both run as the project's compute SA.
# Set SJ_SYNC_SA / SJ_HUB_SA to dedicated accounts to split them properly.
SYNC_SA="${SJ_SYNC_SA:-${RUNTIME_SA}}"
HUB_SA="${SJ_HUB_SA:-${RUNTIME_SA}}"

# objectUser = create/delete/get/list/update on objects. Narrower than
# objectAdmin, which also carries object setIamPolicy.
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SYNC_SA}" \
  --role="roles/storage.objectUser" \
  --quiet >/dev/null
echo "granted objectUser (write) on shared bucket to ${SYNC_SA}"

if [[ "${HUB_SA}" != "${SYNC_SA}" ]]; then
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member="serviceAccount:${HUB_SA}" \
    --role="roles/storage.objectUser" \
    --quiet >/dev/null
  echo "granted objectUser (write) on shared bucket to ${HUB_SA}"
fi

gcloud storage buckets add-iam-policy-binding "gs://${HUB_BUCKET}" \
  --member="serviceAccount:${HUB_SA}" \
  --role="roles/storage.objectUser" \
  --quiet >/dev/null
echo "granted objectUser on reserved hub bucket to ${HUB_SA}"

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
    --time-zone="${TIME_ZONE}" \
    --uri="${RUN_JOB_URI}" \
    --http-method=POST \
    --oauth-service-account-email="${SCHEDULER_SA}"
  echo "updated scheduler ${SCHEDULER_JOB}"
else
  gcloud scheduler jobs create http "${SCHEDULER_JOB}" \
    --project="${PROJECT}" \
    --location="${REGION}" \
    --schedule="${SCHEDULE}" \
    --time-zone="${TIME_ZONE}" \
    --uri="${RUN_JOB_URI}" \
    --http-method=POST \
    --oauth-service-account-email="${SCHEDULER_SA}"
  echo "created scheduler ${SCHEDULER_JOB}"
fi

# --- Hockey lines + starting goalies (HOCKEY-PORT.md H4) ---------------------
# Goalie confirmations land late afternoon, after the 6:00 sync, so a light
# `sj nhl-lines` run refreshes Daily Faceoff lines + starting goalies only
# (32 NHL roster reads, 32 team pages, 3 goalie pages). Same Cloud Run job,
# different args. SJ_HOCKEY_LINES=0 skips; SJ_HOCKEY_LINES_SCHEDULES is a
# ';'-separated cron list (default 15:00 and 17:30).
if [ "${SJ_HOCKEY_LINES:-1}" != "0" ]; then
  RUN_JOB_V2_URI="https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${JOB}:run"
  LINES_BODY='{"overrides":{"containerOverrides":[{"args":["nhl-lines"]}]}}'
  IFS=';' read -r -a LINES_SCHEDULES <<< "${SJ_HOCKEY_LINES_SCHEDULES:-0 15 * * *;30 17 * * *}"
  for LINES_SCHEDULE in "${LINES_SCHEDULES[@]}"; do
    # sj-hockey-lines-1500, sj-hockey-lines-1730, ...
    read -r MINUTE HOUR _ <<< "${LINES_SCHEDULE}"
    LINES_JOB="sj-hockey-lines-$(printf '%02d%02d' "${HOUR}" "${MINUTE}")"
    if gcloud scheduler jobs describe "${LINES_JOB}" \
        --project="${PROJECT}" --location="${REGION}" >/dev/null 2>&1; then
      VERB=update
    else
      VERB=create
    fi
    gcloud scheduler jobs "${VERB}" http "${LINES_JOB}" \
      --project="${PROJECT}" \
      --location="${REGION}" \
      --schedule="${LINES_SCHEDULE}" \
      --time-zone="${TIME_ZONE}" \
      --uri="${RUN_JOB_V2_URI}" \
      --http-method=POST \
      --headers="Content-Type=application/json" \
      --message-body="${LINES_BODY}" \
      --oauth-service-account-email="${SCHEDULER_SA}"
    echo "${VERB}d scheduler ${LINES_JOB} (${LINES_SCHEDULE}, args nhl-lines)"
  done
fi

cat <<EOF

================================================================
Infrastructure ready.

Next:
  1. GitHub → Actions → "deploy sync job" → Run workflow
       bucket: ${BUCKET}
  2. GitHub → Actions → "deploy hub" → Run workflow
       bucket: ${BUCKET}              (RW at /app/data/sj — ESPN + golf/members)
       (leave hub_bucket blank — dual FUSE is disabled)
  3. One-time history backfill:
       gcloud run jobs execute ${JOB} --args=backfill \\
         --region=${REGION} --project=${PROJECT}

Hockey lines + starting goalies refresh at 15:00 and 17:30 (${TIME_ZONE}) via
sj-hockey-lines-* (args nhl-lines). Skip with SJ_HOCKEY_LINES=0.

The scheduler runs "${SCHEDULE}" (${TIME_ZONE}). Override with SJ_SCHEDULE
(and optional SJ_TIMEZONE), or:
  gcloud scheduler jobs update http ${SCHEDULER_JOB} \\
    --location=${REGION} --schedule="0 6 * * *" --time-zone=${TIME_ZONE}
================================================================
EOF
