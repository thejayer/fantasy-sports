# Strictly Jayers community portal (apex) — Next.js on Cloud Run.
#
# Build from the repo root:
#   docker build -f apps/www/Dockerfile -t sj-www .
#
# No Auth.js, no ESPN sync, no GCS mount — public marketing surface that
# deep-links to https://fantasy.strictlyjayers.com for the member hub.

FROM node:22-bookworm-slim AS deps
WORKDIR /app/apps/www
COPY apps/www/package.json apps/www/package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY apps/www ./apps/www
WORKDIR /app/apps/www
ENV NEXT_TELEMETRY_DISABLED=1 \
    SITE_URL=https://strictlyjayers.com \
    FANTASY_HUB_URL=https://fantasy.strictlyjayers.com \
    FITNESS_URL=https://fitness.strictlyjayers.com
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Next standalone output (built with apps/www as the app root).
COPY --from=build /app/apps/www/.next/standalone ./apps/www/
COPY --from=build /app/apps/www/.next/static ./apps/www/.next/static
COPY --from=build /app/apps/www/public ./apps/www/public
COPY apps/www/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
    && groupadd --gid 1001 sjwww \
    && useradd --uid 1001 --gid sjwww --create-home --shell /usr/sbin/nologin sjwww \
    && chown -R sjwww:sjwww /app/apps/www
USER sjwww

ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    SITE_URL=https://strictlyjayers.com \
    FANTASY_HUB_URL=https://fantasy.strictlyjayers.com \
    FITNESS_URL=https://fitness.strictlyjayers.com

EXPOSE 8080
ENTRYPOINT ["/app/docker-entrypoint.sh"]
