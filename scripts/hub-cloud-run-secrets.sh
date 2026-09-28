#!/usr/bin/env bash
# Print the Cloud Run --set-secrets flag for the Strictly Jayers hub.
# Useful when deploying manually; the GitHub Action deploy-hub.yml uses the same mapping.

set -euo pipefail

cat <<'EOF'
# Auth + ESPN (ESPN used only at container start for `sj sync --current-only`):
#
# gcloud run deploy sj-hub \
#   --project=fantasy-sports-analytics \
#   --region=us-central1 \
#   --set-env-vars=SJ_SYNC_ON_START=1,AUTH_TRUST_HOST=true,SJ_DATA_DIR=/app/data/sj \
#   --set-secrets=AUTH_SECRET=sj-auth-secret:latest,AUTH_GOOGLE_ID=sj-auth-google-id:latest,AUTH_GOOGLE_SECRET=sj-auth-google-secret:latest,ALLOWED_EMAILS=sj-allowed-emails:latest,OPENAI_API_KEY=openai-api-key:latest,ESPN_S2=sj-espn-s2:latest,ESPN_SWID=sj-espn-swid:latest \
#   ...

AUTH_SECRET=sj-auth-secret:latest
AUTH_GOOGLE_ID=sj-auth-google-id:latest
AUTH_GOOGLE_SECRET=sj-auth-google-secret:latest
ALLOWED_EMAILS=sj-allowed-emails:latest
OPENAI_API_KEY=openai-api-key:latest
ESPN_S2=sj-espn-s2:latest
ESPN_SWID=sj-espn-swid:latest
EOF
