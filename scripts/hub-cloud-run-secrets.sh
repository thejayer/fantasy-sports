#!/usr/bin/env bash
# Print the Cloud Run --set-secrets flag for the Strictly Jayers hub.
# Useful when deploying manually or wiring a deploy workflow later.
#
# Usage:
#   ./scripts/hub-cloud-run-secrets.sh

set -euo pipefail

# Maps Secret Manager secret -> process env var expected by apps/web / Auth.js
cat <<'EOF'
# Attach these to the hub Cloud Run service (example):
#
# gcloud run deploy sj-hub \
#   --project=fantasy-sports-analytics \
#   --region=us-central1 \
#   --set-secrets=AUTH_SECRET=sj-auth-secret:latest,AUTH_GOOGLE_ID=sj-auth-google-id:latest,AUTH_GOOGLE_SECRET=sj-auth-google-secret:latest,ALLOWED_EMAILS=sj-allowed-emails:latest \
#   ...
#
# Do NOT mount ESPN cookies on the public web service.
# Use them only in a sync job / Action:
#   ESPN_S2=sj-espn-s2:latest,ESPN_SWID=sj-espn-swid:latest

AUTH_SECRET=sj-auth-secret:latest
AUTH_GOOGLE_ID=sj-auth-google-id:latest
AUTH_GOOGLE_SECRET=sj-auth-google-secret:latest
ALLOWED_EMAILS=sj-allowed-emails:latest
EOF
