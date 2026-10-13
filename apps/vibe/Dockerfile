# Strictly Jayers Vibe Split — Next.js on Cloud Run.
#
# Build from the repo root:
#   docker build -f apps/vibe/Dockerfile -t sj-vibe .
#
# Auth.js (same Google + allowlist as sj-hub). Per-user JSON on the hub
# GCS mount at /app/data/sj/vibe — do not mkdir/stat that path here.

FROM node:22-bookworm-slim AS deps
WORKDIR /app/apps/vibe
COPY apps/vibe/package.json apps/vibe/package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY apps/vibe ./apps/vibe
WORKDIR /app/apps/vibe
ENV NEXT_TELEMETRY_DISABLED=1 \
    SITE_URL=https://vibe.strictlyjayers.com \
    COMMUNITY_SITE_URL=https://strictlyjayers.com \
    FANTASY_HUB_URL=https://fantasy.strictlyjayers.com \
    FITNESS_URL=https://fitness.strictlyjayers.com
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

COPY --from=build /app/apps/vibe/.next/standalone ./apps/vibe/
COPY --from=build /app/apps/vibe/.next/static ./apps/vibe/.next/static
COPY --from=build /app/apps/vibe/public ./apps/vibe/public
COPY apps/vibe/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
    && groupadd --gid 1001 sjvibe \
    && useradd --uid 1001 --gid sjvibe --create-home --shell /usr/sbin/nologin sjvibe \
    && chown -R sjvibe:sjvibe /app/apps/vibe
USER sjvibe

ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    AUTH_TRUST_HOST=true \
    SITE_URL=https://vibe.strictlyjayers.com \
    AUTH_URL=https://vibe.strictlyjayers.com \
    COMMUNITY_SITE_URL=https://strictlyjayers.com \
    FANTASY_HUB_URL=https://fantasy.strictlyjayers.com \
    FITNESS_URL=https://fitness.strictlyjayers.com

EXPOSE 8080
ENTRYPOINT ["/app/docker-entrypoint.sh"]
