#!/usr/bin/env bash
# Map fitness.strictlyjayers.com → Cloud Run sj-fitness and print DNS steps.
#
# Run in Cloud Shell (needs gcloud auth + project access):
#   ./scripts/setup-fitness-domain.sh
#   ./scripts/setup-fitness-domain.sh --cutover   # after DNS/TLS are Ready: set SITE_URL
#
# Apex strictlyjayers.com is the community portal (see setup-portal-domain.sh).
# Fantasy stays on fantasy.strictlyjayers.com (see setup-hub-domain.sh).

set -euo pipefail

PROJECT="${GCP_PROJECT:-fantasy-sports-analytics}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SJ_FITNESS_SERVICE:-sj-fitness}"
BASE_DOMAIN="${SJ_BASE_DOMAIN:-strictlyjayers.com}"
HOST="${SJ_FITNESS_HOST:-fitness.${BASE_DOMAIN}}"
PUBLIC_URL="https://${HOST}"
CUTOVER=0

for arg in "$@"; do
  case "$arg" in
    --cutover) CUTOVER=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

echo "Project:  ${PROJECT}"
echo "Service:  ${SERVICE} (${REGION})"
echo "Host:     ${HOST}"
echo

gcloud config set project "${PROJECT}" >/dev/null

gcloud services enable \
  run.googleapis.com \
  domains.googleapis.com \
  --project="${PROJECT}"

echo "================================================================"
echo "1) Verify ownership of ${BASE_DOMAIN} (Search Console / Cloud Domains)"
echo "================================================================"
echo "If you have not verified this domain in this GCP project yet:"
echo "  gcloud domains verify ${BASE_DOMAIN}"
echo "Follow the prompt (TXT record at Spaceship), then re-run this script."
echo

create_mapping() {
  if gcloud run domain-mappings describe --domain="${HOST}" \
      --region="${REGION}" --project="${PROJECT}" >/dev/null 2>&1; then
    echo "Domain mapping already exists for ${HOST}"
    return 0
  fi
  if gcloud beta run domain-mappings describe --domain="${HOST}" \
      --region="${REGION}" --project="${PROJECT}" >/dev/null 2>&1; then
    echo "Domain mapping already exists for ${HOST} (beta)"
    return 0
  fi

  echo "Creating domain mapping ${HOST} → ${SERVICE} ..."
  if gcloud run domain-mappings create \
      --service="${SERVICE}" \
      --domain="${HOST}" \
      --region="${REGION}" \
      --project="${PROJECT}"; then
    return 0
  fi
  echo "GA domain-mappings create failed; trying gcloud beta ..."
  gcloud beta run domain-mappings create \
      --service="${SERVICE}" \
      --domain="${HOST}" \
      --region="${REGION}" \
      --project="${PROJECT}"
}

create_mapping

echo
echo "================================================================"
echo "2) DNS records — add these at Spaceship for ${BASE_DOMAIN}"
echo "================================================================"
echo "Spaceship → Domains → ${BASE_DOMAIN} → DNS"
echo "Use DNS-only / no proxy if Spaceship offers a CDN toggle."
echo

RECORDS_JSON=""
if RECORDS_JSON="$(gcloud run domain-mappings describe --domain="${HOST}" \
    --region="${REGION}" --project="${PROJECT}" \
    --format=json 2>/dev/null)"; then
  :
elif RECORDS_JSON="$(gcloud beta run domain-mappings describe --domain="${HOST}" \
    --region="${REGION}" --project="${PROJECT}" \
    --format=json 2>/dev/null)"; then
  :
fi

if [ -n "${RECORDS_JSON}" ]; then
  RECORDS_JSON="${RECORDS_JSON}" python3 - <<'PY'
import json, os
doc = json.loads(os.environ["RECORDS_JSON"])
records = (
    doc.get("status", {}).get("resourceRecords")
    or doc.get("resourceRecords")
    or []
)
if not records:
    print("(No resourceRecords in describe output yet — check Cloud Console →")
    print(" Cloud Run → sj-fitness → custom domains, or re-run in a few minutes.)")
    raise SystemExit(0)
print(f"{'TYPE':<8} {'NAME':<28} VALUE")
print("-" * 72)
for row in records:
    rtype = row.get("type", "?")
    host = row.get("name") or ""
    value = row.get("rrdata") or row.get("rdata") or ""
    print(f"{rtype:<8} {host:<28} {value}")
print()
print("Typical subdomain result (confirm against the table above):")
print("  Type  CNAME")
print("  Name  fitness")
print("  Value ghs.googlehosted.com")
print("  TTL   300 (or Spaceship default)")
PY
else
  echo "Could not describe the mapping via CLI. In Cloud Console:"
  echo "  Cloud Run → ${SERVICE} → Manage custom domains → ${HOST}"
  echo "Copy the DNS records shown there into Spaceship."
  echo
  echo "Most common for a subdomain:"
  echo "  Type  CNAME"
  echo "  Name  fitness"
  echo "  Value ghs.googlehosted.com"
fi

echo
echo "================================================================"
echo "3) Wait for certificate / Ready"
echo "================================================================"
echo "SSL usually takes a few minutes after DNS propagates (up to ~24h)."
echo "Check:"
echo "  gcloud run domain-mappings describe --domain=${HOST} --region=${REGION}"
echo "When status is Ready / Active, open ${PUBLIC_URL}"
echo

if [ "${CUTOVER}" = "1" ]; then
  echo "================================================================"
  echo "4) Cutover: set SITE_URL=${PUBLIC_URL}"
  echo "================================================================"
  gcloud run services update "${SERVICE}" \
    --project="${PROJECT}" \
    --region="${REGION}" \
    --update-env-vars="SITE_URL=${PUBLIC_URL},COMMUNITY_SITE_URL=https://${BASE_DOMAIN},FANTASY_HUB_URL=https://fantasy.${BASE_DOMAIN}"
  echo "SITE_URL updated. Fitness metadata uses ${PUBLIC_URL}."
  echo "Also set FITNESS_URL=${PUBLIC_URL} on sj-www so portal CTAs match:"
  echo "  gcloud run services update sj-www --region=${REGION} --project=${PROJECT} \\"
  echo "    --update-env-vars=FITNESS_URL=${PUBLIC_URL}"
else
  echo "When DNS + TLS look good, cut SITE_URL over with:"
  echo "  ./scripts/setup-fitness-domain.sh --cutover"
  echo
  echo "Deploy CD will preserve a non-*.run.app SITE_URL once set."
fi

echo
echo "Apex ${BASE_DOMAIN} is the community portal — ./scripts/setup-portal-domain.sh"
echo "Fantasy hub domain (separate): ./scripts/setup-hub-domain.sh"
echo "Done."
