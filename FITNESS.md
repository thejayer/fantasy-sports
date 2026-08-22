# Fitness — `fitness.strictlyjayers.com`

The crew training log lives in this monorepo as a **sibling Cloud Run app**,
not on the apex portal and not as a standalone GitHub Pages PWA.

| Host | App | Cloud Run | Role |
|---|---|---|---|
| `strictlyjayers.com` | `apps/www` | `sj-www` | Public community front door |
| `fantasy.strictlyjayers.com` | `apps/web` | `sj-hub` | Authenticated member hub |
| `fitness.strictlyjayers.com` | `apps/fitness` | `sj-fitness` | Local-first training log |

Visual language is the shared **Modernist** system (Archivo, Signal Red
`--color-accent`, 0 radius, 2px rules) — the same tokens as
`strictlyjayers.com`. The Texas Tech red / black / white / graphite palette
from [athlete-log](https://github.com/thejayer/athlete-log) is not used.

## Why a sibling host

- The log is a **service-worker PWA**. A SW on the apex would intercept
  Community / AI / People / Watch routes.
- Product boundary matches Fantasy: absolute cross-origin links, independent
  scale-to-zero, no Auth.js, no GCS snapshot mount.
- Portal `/ai` `/watch` `/people` are content pages. Fitness is an app.

The old Pages site (`thejayer.github.io/athlete-log`) is stale and is not
the deploy target. This repo is.

## What shipped

- Golf, tennis, pickleball, lifting, endurance (plus CrossFit / swim / cycle
  templates), planner, calendar, goals, GPS round, library, programs,
  compare, progress, import/export.
- Persistence stays `athleteLog.*` localStorage (+ IndexedDB mirror) so an
  Athlete Log JSON export still imports.
- PWA manifest + service worker (bypasses `/api/` and `/_next/`).
- Portal nav (More), People, and the home destination list link here via
  `FITNESS_URL` (default `https://fitness.strictlyjayers.com`).

## Local

```bash
cd apps/fitness && npm install && npm run dev
# http://localhost:3003

cd apps/fitness && npm test && npm run test:verify && npm run build && npm run test:e2e
```

## Deploy

```bash
# First image: Actions → deploy fitness (or merge apps/fitness to main)
# Then map the custom domain (ops — does not have to happen in the PR):
./scripts/setup-fitness-domain.sh
# After DNS + TLS Ready:
./scripts/setup-fitness-domain.sh --cutover
```

Push-path CD: `.github/workflows/deploy-fitness.yml` watches `apps/fitness/**`.
`SITE_URL` cutover is preserved when it is not a `*.run.app` host (same
pattern as `sj-www`).

Typical Spaceship record after mapping:

| Type | Name | Value |
|---|---|---|
| `CNAME` | `fitness` | `ghs.googlehosted.com` |

Also set `FITNESS_URL=https://fitness.strictlyjayers.com` on `sj-www` (deploy
portal already sends that default). Live check: `/api/health` →
`{"service":"sj-fitness"}`.
