# Strictly Jayers member hub — Next.js on Cloud Run.
#
# Build from the repo root:
#   docker build -f apps/web/Dockerfile -t sj-hub .
#
# Runtime expects AUTH_* (+ optional ESPN_*) from Secret Manager via
# Cloud Run --set-secrets (see scripts/hub-cloud-run-secrets.sh).

FROM node:22-bookworm-slim AS web-deps
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

FROM web-deps AS web-build
WORKDIR /app
COPY apps/web ./apps/web
COPY fixtures ./fixtures
WORKDIR /app/apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime

# Node runs the Next.js standalone server. Copy the binary from the node:22
# build stage instead of apt-installing from NodeSource — that GPG endpoint
# has 403'd in CI and already broke `images` on main after #31.
COPY --from=web-deps /usr/local/bin/node /usr/local/bin/node
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
COPY configs ./configs
COPY fixtures ./fixtures
RUN pip install --no-cache-dir -e .

# Next standalone output (built with apps/web as the app root).
COPY --from=web-build /app/apps/web/.next/standalone ./apps/web/
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /app/apps/web/public ./apps/web/public

COPY apps/web/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /app/data/sj \
    && cp -a /app/fixtures/sj/. /app/data/sj/

# Drop root. Only the paths the app writes are chowned -- chowning all of /app
# would duplicate every file into a new layer for no benefit.
RUN groupadd --gid 1001 sjhub \
    && useradd --uid 1001 --gid sjhub --create-home --shell /usr/sbin/nologin sjhub \
    && chown -R sjhub:sjhub /app/data /app/apps/web/.next
USER sjhub

ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    SJ_DATA_DIR=/app/data/sj \
    SJ_SYNC_ON_START=1 \
    AUTH_TRUST_HOST=true \
    PYTHONUNBUFFERED=1

EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
