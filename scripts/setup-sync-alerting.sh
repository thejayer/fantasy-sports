#!/usr/bin/env bash
# One-time Cloud Monitoring alerts for the Strictly Jayers sync pipeline.
#
# Prerequisites:
#   - scripts/setup-sync-infra.sh already ran (job + scheduler exist)
#   - You can receive alert email (or pass an existing channel id)
#
# Run in Cloud Shell:
#   NOTIFY_EMAIL=you@example.com ./scripts/setup-sync-alerting.sh
#
# Optional:
#   NOTIFICATION_CHANNEL=projects/.../notificationChannels/123   # reuse one
#   SJ_JOB=sj-sync
#   STALE_HOURS=2   # unused here; freshness is watched via /api/health uptime

set -euo pipefail

PROJECT="${GCP_PROJECT:-fantasy-sports-analytics}"
REGION="${GCP_REGION:-us-central1}"
JOB="${SJ_JOB:-sj-sync}"
POLICY_DISPLAY="${SJ_ALERT_POLICY:-Strictly Jayers sync job failed}"
CHANNEL_DISPLAY="${SJ_CHANNEL_DISPLAY:-Strictly Jayers sync alerts}"

if [[ -z "${NOTIFY_EMAIL:-}" && -z "${NOTIFICATION_CHANNEL:-}" ]]; then
  echo "Set NOTIFY_EMAIL=you@example.com or NOTIFICATION_CHANNEL=projects/.../notificationChannels/ID" >&2
  exit 1
fi

echo "Project: ${PROJECT}"
echo "Job:     ${JOB}"
echo

gcloud config set project "${PROJECT}" >/dev/null

gcloud services enable \
  monitoring.googleapis.com \
  logging.googleapis.com \
  --project="${PROJECT}"

# --- Notification channel ---------------------------------------------------
CHANNEL="${NOTIFICATION_CHANNEL:-}"
if [[ -z "${CHANNEL}" ]]; then
  # Reuse an existing email channel with the same address when present.
  CHANNEL="$(
    gcloud beta monitoring channels list \
      --project="${PROJECT}" \
      --filter="type=email AND labels.email_address=${NOTIFY_EMAIL}" \
      --format='value(name)' \
      2>/dev/null | head -n1 || true
  )"
  if [[ -z "${CHANNEL}" ]]; then
    CHANNEL="$(
      gcloud beta monitoring channels create \
        --project="${PROJECT}" \
        --display-name="${CHANNEL_DISPLAY}" \
        --type=email \
        --channel-labels="email_address=${NOTIFY_EMAIL}" \
        --format='value(name)'
    )"
    echo "created notification channel ${CHANNEL}"
  else
    echo "reusing notification channel ${CHANNEL}"
  fi
else
  echo "using notification channel ${CHANNEL}"
fi

# --- Alert: Cloud Run Job execution failed ---------------------------------
# Metric: completed executions with result != succeeded. Any failed scheduled
# sync (exit 1 from sj sync --current-only) pages within ~5 minutes.
FILTER="resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${JOB}\" AND metric.type=\"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result!=\"succeeded\""

EXISTING_POLICY="$(
  gcloud alpha monitoring policies list \
    --project="${PROJECT}" \
    --filter="displayName=\"${POLICY_DISPLAY}\"" \
    --format='value(name)' \
    2>/dev/null | head -n1 || true
)"

POLICY_FILE="$(mktemp)"
trap 'rm -f "${POLICY_FILE}"' EXIT

cat >"${POLICY_FILE}" <<EOF
displayName: "${POLICY_DISPLAY}"
combiner: OR
conditions:
  - displayName: "${JOB} execution failed"
    conditionThreshold:
      filter: ${FILTER}
      comparison: COMPARISON_GT
      thresholdValue: 0
      duration: 0s
      aggregations:
        - alignmentPeriod: 300s
          perSeriesAligner: ALIGN_DELTA
          crossSeriesReducer: REDUCE_SUM
          groupByFields:
            - resource.label.job_name
      trigger:
        count: 1
notificationChannels:
  - ${CHANNEL}
alertStrategy:
  autoClose: 86400s
documentation:
  content: |
    The Cloud Run Job \`${JOB}\` finished with a non-success result.

    Scheduled syncs run \`sj sync --current-only\`, which exits 1 on any
    skipped season and prints a \`SYNC_SUMMARY\` JSON line. Check:

      gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="${JOB}" AND textPayload:"SYNC_SUMMARY"' \\
        --project=${PROJECT} --limit=5 --format='value(textPayload)'

    Also hit the hub's public probe: https://<sj-hub-url>/api/health
  mimeType: text/markdown
EOF

if [[ -n "${EXISTING_POLICY}" ]]; then
  gcloud alpha monitoring policies update "${EXISTING_POLICY}" \
    --project="${PROJECT}" \
    --policy-from-file="${POLICY_FILE}" \
    >/dev/null
  echo "updated alert policy ${EXISTING_POLICY}"
else
  CREATED="$(
    gcloud alpha monitoring policies create \
      --project="${PROJECT}" \
      --policy-from-file="${POLICY_FILE}" \
      --format='value(name)'
  )"
  echo "created alert policy ${CREATED}"
fi

cat <<EOF

================================================================
Sync alerting ready.

You will get mail at ${NOTIFY_EMAIL:-the channel you passed} when ${JOB}
fails. Confirm the channel from the email Google sends on first create.

Optional — page on stale snapshots too (after the hub is deployed):

  # Cloud Monitoring → Uptime checks → create HTTPS check
  #   URL: https://<sj-hub-host>/api/health
  #   Expected: HTTP 200
  #   Alert on check failure → same notification channel

Freshness threshold is SJ_HEALTH_STALE_SECONDS on the hub (default 7200).
================================================================
EOF
