# Fitness — `fitness.strictlyjayers.com`

The crew training log lives in this monorepo as a **sibling Cloud Run app**,
not on the apex portal and not as a standalone GitHub Pages PWA.

| Host | App | Cloud Run | Role |
|---|---|---|---|
| `strictlyjayers.com` | `apps/www` | `sj-www` | Public community front door |
| `fantasy.strictlyjayers.com` | `apps/web` | `sj-hub` | Authenticated member hub |
| `fitness.strictlyjayers.com` | `apps/fitness` | `sj-fitness` | Member training log |

Visual language is the shared **Modernist** system (Archivo, Signal Red
`--color-accent`, 0 radius, 2px rules) — the same tokens as
`strictlyjayers.com`. The Texas Tech red / black / white / graphite palette
from [athlete-log](https://github.com/thejayer/athlete-log) is not used.

## Why a sibling host

- The log is a **service-worker PWA**. A SW on the apex would intercept
  Community / AI / People / Watch routes.
- Product boundary matches Fantasy: absolute cross-origin links, independent
  scale-to-zero.
- Portal `/ai` `/watch` `/people` are content pages. Fitness is an app.

The old Pages site (`thejayer.github.io/athlete-log`) is stale and is not
the deploy target. This repo is.

## Identity (same people as Fantasy)

Fitness uses **Auth.js / next-auth v5 + Google**, the same client and
allowlist as `sj-hub`. There is no second user directory.

Allowlist = `ALLOWED_EMAILS` ∪ `{SJ_HUB_DIR}/hub_members.json` emails.
`hub_members.json` is the file the hub admin center writes. Fitness only
reads it.

On first sign-in, the member gets an empty fitness profile. Settings and
logged sessions are stored under that person and follow them across devices.
Guests see a sign-in wall — not a shared demo log. A signed-in member cannot
read or write another member's document: `/api/me` always keys the file from
the session email.

Cookies stay on the fitness origin. Members click **Continue with Google**
here (same Google account as Fantasy; not a second login product).

### Cloud Run env (sj-fitness)

Reuse the hub Secret Manager names. Do not put secret values in the repo.

| Runtime env | Source | Purpose |
|---|---|---|
| `AUTH_URL` | `https://fitness.strictlyjayers.com` | Auth.js public origin (same host as `SITE_URL`) |
| `AUTH_TRUST_HOST` | `true` | Cloud Run / custom domain |
| `AUTH_SECRET` | secret `sj-auth-secret:latest` | Same JWT secret as `sj-hub` |
| `AUTH_GOOGLE_ID` | secret `sj-auth-google-id:latest` | Same Google OAuth client |
| `AUTH_GOOGLE_SECRET` | secret `sj-auth-google-secret:latest` | Same Google OAuth client |
| `ALLOWED_EMAILS` | secret `sj-allowed-emails:latest` | Same env allowlist as Fantasy |
| `SJ_HUB_DIR` | `/app/data/sj` | Read `hub_members.json` |
| `SJ_FITNESS_DIR` | `/app/data/sj/fitness` | Per-user `users/{sha256(email)[:32]}/athlete.json` |
| `AUTH_DEV_BYPASS` | unset in prod | Local / CI only (`1` + `SJ_DEV_VIEWER_EMAIL`) |

Push CD (`.github/workflows/deploy-fitness.yml`) sets those secrets and mounts
`gs://fantasy-sports-analytics-sj-data` RW at `/app/data/sj` (uid/gid `1001`,
semicolon `mount-options`). The default Compute Engine SA already has
`secretAccessor` on the auth secrets from
`./scripts/grant-hub-secret-access.sh`. It also needs `objectUser` on that
bucket (hub already granted this for the same SA).

**Do not** `mkdir` / `stat` / `test` the FUSE mount in the entrypoint — a
slow mount hangs the Cloud Run PORT probe. Dirs are created on first write.

### Google OAuth client (one-time)

Use the **existing** hub OAuth client. Add:

| Field | Value |
|---|---|
| Authorized JavaScript origin | `https://fitness.strictlyjayers.com` |
| Authorized redirect URI | `https://fitness.strictlyjayers.com/api/auth/callback/google` |

Keep the Fantasy origin/redirect. Also keep the `*.run.app` pair if you still
open the Cloud Run URL directly.

## Storage

Not Firestore. Same pattern as hub-native JSON (`hub_members.json`, feed,
auction room): one file per member on the GCS-backed filesystem.

- Server: `{SJ_FITNESS_DIR}/users/{userKey}/athlete.json`
- Browser cache: `athleteLog.{userKey}.*` localStorage + namespaced IndexedDB
- Legacy anonymous `athleteLog.sessions.v1` (etc.) is migrated **once** into
  that signed-in member's store when their server profile has no training yet
- Athlete Log JSON export/import still works from the Profile tools. Hevy workout CSV (Profile → Settings → Export & Import Data → Export Workouts) imports as lifting sessions on the signed-in member via `/api/me`; re-import is idempotent.

`fitness/` lives next to hub files on the shared bucket. `sj sync` only
writes known ESPN league paths and will not touch it.

## What shipped

- Golf, tennis, pickleball, lifting, endurance (plus CrossFit / swim / cycle
  templates), planner, calendar, goals, GPS round, library, programs,
  compare, progress, import/export.
- Per-member profile + settings + sessions (Auth.js gate + `/api/me`).
- PWA manifest + service worker (bypasses `/api/` and `/_next/`).
- Portal nav (More), People, and the home destination list link here via
  `FITNESS_URL` (default `https://fitness.strictlyjayers.com`).

## Local

```bash
cd apps/fitness && cp .env.example .env.local
# AUTH_DEV_BYPASS=1 uses SJ_DEV_VIEWER_EMAIL (demo@example.com)
npm install && npm run dev
# http://localhost:3003

cd apps/fitness && npm test && npm run test:verify && npm run build && npm run test:e2e
AUTH_DEV_BYPASS=0 npm run test:e2e:auth
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
`SITE_URL` / `AUTH_URL` cutover is preserved when it is not a `*.run.app`
host (same pattern as `sj-www` / `sj-hub`).

Typical Spaceship record after mapping:

| Type | Name | Value |
|---|---|---|
| `CNAME` | `fitness` | `ghs.googlehosted.com` |

Also set `FITNESS_URL=https://fitness.strictlyjayers.com` on `sj-www` (deploy
portal already sends that default). Live check: `/api/health` →
`{"service":"sj-fitness"}`. `/` without a session → `/login`.
