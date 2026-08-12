#!/usr/bin/env bash
# Map strictlyjayers.com (+ optional www) → Cloud Run sj-www and print DNS steps.
#
# Run in Cloud Shell (needs gcloud auth + project access):
#   ./scripts/setup-portal-domain.sh
#   ./scripts/setup-portal-domain.sh --cutover   # after DNS/TLS Ready: set SITE_URL
#   ./scripts/setup-portal-domain.sh --with-www  # also map www.strictlyjayers.com
#
# Fantasy stays on fantasy.strictlyjayers.com (see setup-hub-domain.sh).

set -euo pipefail

PROJECT="${GCP_PROJECT:-fantasy-sports-analytics}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SJ_WWW_SERVICE:-sj-www}"
BASE_DOMAIN="${SJ_BASE_DOMAIN:-strictlyjayers.com}"
HOST="${SJ_PORTAL_HOST:-${BASE_DOMAIN}}"
WWW_HOST="www.${BASE_DOMAIN}"
PUBLIC_URL="https://${HOST}"
CUTOVER=0
WITH_WWW=0

for arg in "$@"; do
  case "$arg" in
    --cutover) CUTOVER=1 ;;
    --with-www) WITH_WWW=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

echo "Project:  ${PROJECT}"
echo "Service:  ${SERVICE} (${REGION})"
echo "Host:     ${HOST}"
if [ "${WITH_WWW}" = "1" ]; then
  echo "Also:     ${WWW_HOST}"
fi
echo

gcloud config set project "${PROJECT}" >/dev/null

gcloud services enable \
  run.googleapis.com \
  domains.googleapis.com \
  --project="${PROJECT}"

echo "================================================================"
echo "1) Verify ownership of ${BASE_DOMAIN}"
echo "================================================================"
echo "If you have not verified this domain in this GCP project yet:"
echo "  gcloud domains verify ${BASE_DOMAIN}"
echo "Follow the prompt (TXT record at Spaceship), then re-run this script."
echo

create_mapping() {
  local domain="$1"
  if gcloud run domain-mappings describe --domain="${domain}" \
      --region="${REGION}" --project="${PROJECT}" >/dev/null 2>&1; then
    echo "Domain mapping already exists for ${domain}"
    return 0
  fi
  if gcloud beta run domain-mappings describe --domain="${domain}" \
      --region="${REGION}" --project="${PROJECT}" >/dev/null 2>&1; then
    echo "Domain mapping already exists for ${domain} (beta)"
    return 0
  fi

  echo "Creating domain mapping ${domain} → ${SERVICE} ..."
  if gcloud run domain-mappings create \
      --service="${SERVICE}" \
      --domain="${domain}" \
      --region="${REGION}" \
      --project="${PROJECT}"; then
    return 0
  fi
  echo "GA domain-mappings create failed; trying gcloud beta ..."
  gcloud beta run domain-mappings create \
      --service="${SERVICE}" \
      --domain="${domain}" \
      --region="${REGION}" \
      --project="${PROJECT}"
}

create_mapping "${HOST}"
if [ "${WITH_WWW}" = "1" ]; then
  create_mapping "${WWW_HOST}"
fi

print_records() {
  local domain="$1"
  local records_json=""
  if records_json="$(gcloud run domain-mappings describe --domain="${domain}" \
      --region="${REGION}" --project="${PROJECT}" \
      --format=json 2>/dev/null)"; then
    :
  elif records_json="$(gcloud beta run domain-mappings describe --domain="${domain}" \
      --region="${REGION}" --project="${PROJECT}" \
      --format=json 2>/dev/null)"; then
    :
  fi

  echo
  echo "DNS for ${domain}:"
  if [ -z "${records_json}" ]; then
    echo "  (Could not describe mapping — check Cloud Console → Cloud Run → ${SERVICE})"
    return 0
  fi
  RECORDS_JSON="${records_json}" python3 - <<'PY'
import json, os
doc = json.loads(os.environ["RECORDS_JSON"])
records = (
    doc.get("status", {}).get("resourceRecords")
    or doc.get("resourceRecords")
    or []
)
if not records:
    print("  (No resourceRecords yet — re-run in a few minutes.)")
    raise SystemExit(0)
print(f"  {'TYPE':<8} {'NAME':<28} VALUE")
print("  " + "-" * 70)
for row in records:
    rtype = row.get("type", "?")
    host = row.get("name") or ""
    value = row.get("rrdata") or row.get("rdata") or ""
    print(f"  {rtype:<8} {host:<28} {value}")
PY
}

echo
echo "================================================================"
echo "2) DNS records — add these at Spaceship for ${BASE_DOMAIN}"
echo "================================================================"
echo "Spaceship → Domains → ${BASE_DOMAIN} → DNS"
echo "Use DNS-only / no proxy if Spaceship offers a CDN toggle."
print_records "${HOST}"
if [ "${WITH_WWW}" = "1" ]; then
  print_records "${WWW_HOST}"
fi

echo
echo "Typical apex result (confirm against the table above):"
echo "  Type  A / AAAA   (or ALIAS/ANAME if Spaceship supports apex CNAME)"
echo "  Name  @          → values from gcloud describe"
echo "  Type  CNAME"
echo "  Name  www        → ghs.googlehosted.com   (with --with-www)"
echo
echo "Do not point the apex at sj-hub. Fantasy stays on the fantasy subdomain."
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
    --update-env-vars="SITE_URL=${PUBLIC_URL},FANTASY_HUB_URL=https://fantasy.${BASE_DOMAIN}"
  echo "SITE_URL updated. Portal metadata and absolute links use ${PUBLIC_URL}."
else
  echo "When DNS + TLS look good, cut SITE_URL over with:"
  echo "  ./scripts/setup-portal-domain.sh --cutover"
  echo
  echo "Production already uses SITE_URL=https://strictlyjayers.com when the"
  echo "custom domain is Ready — deploy CD preserves a non-*.run.app value."
  echo "Portal middleware 308s www → apex once SITE_URL is set."
fi

echo
echo "Fantasy hub domain (separate): ./scripts/setup-hub-domain.sh"
echo "Done."
