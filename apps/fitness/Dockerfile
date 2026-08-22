# Strictly Jayers fitness log — Next.js on Cloud Run.
#
# Build from the repo root:
#   docker build -f apps/fitness/Dockerfile -t sj-fitness .
#
# No Auth.js, no ESPN sync, no GCS mount — public local-first PWA that
# deep-links to strictlyjayers.com and fantasy.strictlyjayers.com.

FROM node:22-bookworm-slim AS deps
WORKDIR /app/apps/fitness
COPY apps/fitness/package.json apps/fitness/package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY apps/fitness ./apps/fitness
WORKDIR /app/apps/fitness
ENV NEXT_TELEMETRY_DISABLED=1 \
    SITE_URL=https://fitness.strictlyjayers.com \
    COMMUNITY_SITE_URL=https://strictlyjayers.com \
    FANTASY_HUB_URL=https://fantasy.strictlyjayers.com
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

COPY --from=build /app/apps/fitness/.next/standalone ./apps/fitness/
COPY --from=build /app/apps/fitness/.next/static ./apps/fitness/.next/static
COPY --from=build /app/apps/fitness/public ./apps/fitness/public
COPY apps/fitness/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
    && groupadd --gid 1001 sjfit \
    && useradd --uid 1001 --gid sjfit --create-home --shell /usr/sbin/nologin sjfit \
    && chown -R sjfit:sjfit /app/apps/fitness
USER sjfit

ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    SITE_URL=https://fitness.strictlyjayers.com \
    COMMUNITY_SITE_URL=https://strictlyjayers.com \
    FANTASY_HUB_URL=https://fantasy.strictlyjayers.com

EXPOSE 8080
ENTRYPOINT ["/app/docker-entrypoint.sh"]
