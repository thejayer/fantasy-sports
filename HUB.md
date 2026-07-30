# Strictly Jayers hub

Member hub for Strictly Jayers fantasy leagues. V1 focuses on ESPN league
data: standings, teams, rosters, players, matchups (weekly scores / schedule /
playoff seeds), draft results, activity/transactions, free agents (football
Tools → Waivers; baseball Waivers tab), and multi-season history (all-time,
champions, records, H2H). Loading / empty / error states and mobile table cards
are in place (roadmap 3.6). Full registry history needs a one-time
`sj backfill` (see below); committed fixtures stay current-season only.

For the current state of the site and the plan to build it out, see
[AUDIT.md](AUDIT.md) (security / correctness baseline),
[AUDIT-COMPETITIVE.md](AUDIT-COMPETITIVE.md) (feature and UI/UX gaps vs ESPN,
Yahoo, Sleeper, and FantasyPros), and [ROADMAP.md](ROADMAP.md) (phases 0–9).

## Leagues (current scope)

| id | Sport | Format | Platform | Seasons |
|---|---|---|---|---|
| `baseball-dynasty` | baseball | dynasty | ESPN `2499137` | 2024–2026 |
| `football-main` | football | redraft | ESPN `39790` | 2015–2026 |
| `football-dynasty` | football | dynasty | ESPN `94266` | 2018–2026 |
| `golf-main` | golf | h2h | hub (no ESPN) | 2026 |

Registry: [`configs/leagues.yaml`](configs/leagues.yaml)

### Baseball scope (roadmap 4.6 + 8.2)

**Projection-free by design.** `sj` syncs ESPN baseball snapshots (standings,
rosters with batter/pitcher boards, matchups, draft results, activity, free
agents, history). The `ffa` analytics engine is NFL-only — no MLB ingest, no
baseball projection snapshots. The `projections` tab keeps that EmptyState.
Roadmap **8.2** fills `tools` with snapshot arithmetic (Category Board, Usage
Caps); trailing windows / week forecaster / daily locks stay EmptyStates until
split sync + MLB schedule feeds land. FA browsing remains the Waivers tab. Do
not stub a half engine. Revisit projections only with a dedicated MLB modeling
plan.

### Golf scope (roadmap 6.4a–e + 6.5 + auction/keepers + live room)

**Hub-native** PGA Tour counting leagues (LIV real-team model) — not ESPN and
not `ffa`. Package: `src/sg` (snake **or** offline auction + keepers) plus hub
live nomination room (`auction_room.json`, polled). Fixture `golf-main` stays
snake. Create UI can run offline auction or **Live nomination room** (empty
draft → Auction tab). Hub surfaces: Standings, Teams, Settings, Schedule,
Lineup, Scoreboard, Draft, **Auction**, History. Scoring stays offline — no
live tour scrapes. Tee locks fail closed (UTC). Room is file-backed + HTTP
polling (no websockets/Redis).

## Production (Cloud Run) — preferred

Hosted as Cloud Run service **`sj-hub`** in project **`fantasy-sports-analytics`**.

App secrets (Google OAuth, allowlist, ESPN cookies) live in **GCP Secret Manager**.
Deploy workflows authenticate with **Workload Identity Federation** (no JSON key):
pool/provider `github`, SA `ffa-deployer@fantasy-sports-analytics.iam.gserviceaccount.com`.

### One-time GCP setup (Cloud Shell)

```bash
cd fantasy-sports   # repo checkout on main
git pull
chmod +x scripts/*.sh

# App secrets in Secret Manager (if you haven't already):
./scripts/create-hub-secrets.sh
./scripts/add-hub-secret-version.sh ...   # populate each secret
./scripts/grant-hub-secret-access.sh      # Cloud Run runtime can read them

# Deployer SA roles + printed WIF commands (pool/provider/SA binding):
./scripts/setup-github-deployer.sh
# Run the WIF commands it prints if the pool does not exist yet.
# Do NOT create GCP_SA_KEY — delete it if an old key secret remains.
```

### Deploy

Hub deploys automatically on merge to `main` when hub paths change (branch
protection is the CI gate). Manual rollback / first-time:

1. GitHub → **Actions** → **deploy hub** → **Run workflow**
2. Defaults are fine (`fantasy-sports-analytics` / `us-central1` / `sj-hub`)
3. Set **bucket** to `fantasy-sports-analytics-sj-data` after
   `./scripts/setup-sync-infra.sh` (hub mounts it **RW** for ESPN + golf).
   Push-to-`main` CD defaults to that bucket and remounts (clears any stale
   dual-FUSE template). Manual deploy with blank **bucket** leaves volumes
   unchanged (image-only rollback). Ignore deprecated **hub_bucket**.
4. When it finishes, copy the printed URL

### Custom domain — `fantasy.strictlyjayers.com`

The hub is **not** the apex site. Broader Strictly Jayers (Discord home, Palworld,
etc.) lives on `strictlyjayers.com` (`apps/www`); fantasy stays on a subdomain.
See [PORTAL.md](PORTAL.md) for the community front door and how it deep-links here.

| Host | Role |
|---|---|
| `strictlyjayers.com` | Community portal (`sj-www` / `apps/www`) |
| `fantasy.strictlyjayers.com` | This Cloud Run hub (`sj-hub` / `apps/web`) |

One-time (Cloud Shell, after the hub already deploys on `*.run.app`):

```bash
./scripts/setup-hub-domain.sh
```

That creates the Cloud Run domain mapping and prints DNS records. At
**Spaceship → Domains → strictlyjayers.com → DNS**, add what the script shows
(usually):

| Type | Name | Value |
|---|---|---|
| `CNAME` | `fantasy` | `ghs.googlehosted.com` |

Use DNS-only / no proxy if Spaceship offers a CDN toggle (proxies can block
Google’s managed cert). Wait until the mapping is Ready, then open
`https://fantasy.strictlyjayers.com`.

Cut Auth.js over (so login redirects use the custom host):

```bash
./scripts/setup-hub-domain.sh --cutover
```

Deploy CD **keeps** a non-`*.run.app` `AUTH_URL` once set. Override anytime with
deploy-hub workflow input **auth_url**.

### Google OAuth redirect (required after first deploy)

In GCP → **APIs & Services** → **Credentials** → your OAuth client, add:

- **Authorized JavaScript origin:** `https://sj-hub-….run.app`
- **Authorized redirect URI:** `https://sj-hub-….run.app/api/auth/callback/google`

After the custom domain is Ready, **also** add:

- **Authorized JavaScript origin:** `https://fantasy.strictlyjayers.com`
- **Authorized redirect URI:** `https://fantasy.strictlyjayers.com/api/auth/callback/google`

Keep the `*.run.app` entries until you stop using that URL.

Then open the public URL and sign in with an allowlisted Google account.

The deploy workflow sets `AUTH_URL` to the public site URL. Without that,
Auth.js can redirect to `https://0.0.0.0:8080` (the container bind address).

If you need to set it manually:

```bash
gcloud run services update sj-hub \
  --project=fantasy-sports-analytics \
  --region=us-central1 \
  --update-env-vars="AUTH_URL=https://fantasy.strictlyjayers.com,AUTH_TRUST_HOST=true"
```

The container syncs current ESPN seasons on startup using `sj-espn-s2` /
`sj-espn-swid`, then serves the Next.js app. Auth secrets come from Secret
Manager via `--set-secrets` (never baked into the image).

## Secrets (GCP Secret Manager)

Source of truth is Secret Manager in project **`fantasy-sports-analytics`**.
Do not commit secret values.

| Secret name | Env var | Used by |
|---|---|---|
| `sj-auth-secret` | `AUTH_SECRET` | Next.js / Auth.js |
| `sj-auth-google-id` | `AUTH_GOOGLE_ID` | Next.js / Auth.js |
| `sj-auth-google-secret` | `AUTH_GOOGLE_SECRET` | Next.js / Auth.js |
| `sj-allowed-emails` | `ALLOWED_EMAILS` | Next.js allowlist (unioned with `hub_members.json`) |
| `sj-espn-s2` | `ESPN_S2` | ESPN sync (container start / CLI) |
| `sj-espn-swid` | `ESPN_SWID` | ESPN sync (container start / CLI) |

Optional: `ADMIN_EMAILS` (not a Secret Manager entry yet) bootstraps who can open
`/admin` until `hub_members.json` contains at least one `admin` role.

### Members / admin center

Hub UI **`/admin`** manages `{SJ_HUB_DIR}/hub_members.json`:

- Add Google emails (also grants sign-in when not listed in `ALLOWED_EMAILS`)
- Role: `admin` | `member`
- Link one franchise per league from the **current** snapshot teams (ESPN owners
  show as display names on the team options)

Sign-in allowlist = `ALLOWED_EMAILS` ∪ member emails in that file.

Golf auction nominate/bid/pass and lineup saves require a matching franchise
link (or admin / `AUTH_DEV_BYPASS`). Opening/starting an auction needs a link
or admin; finalize is admin-only.

### Hub-native store (golf) vs ESPN sync store

| Env | Path (prod) | Mount | Owns |
|---|---|---|---|
| `SJ_DATA_DIR` | `/app/data/sj` | GCS **RW** (`…-sj-data`) | ESPN football/baseball from `sj sync` |
| `SJ_HUB_DIR` | `/app/data/sj` | same mount | Golf leagues, auction rooms, league feeds (`feed.json`), `hub_members.json` |

Prod uses **one** RW mount. A second FUSE volume (`…-sj-hub`) failed Cloud Run
PORT probes. `getLeagueIndex` still merges roots when they differ (local sibling
`data/hub`). Sync/backfill skip `platform: hub` and refuse to overwrite
`sport=golf`. Deploy hub with **bucket** only (`hub_bucket` is ignored).

Optional outbound digest: set `SJ_DISCORD_WEBHOOK_URL` on the hub service.
Admins can send the latest weekly digest from the Feed tab; delivery is
idempotent per league-season-period. Digests still render in-app when unset.

### Create / populate (Cloud Shell)

```bash
./scripts/create-hub-secrets.sh
./scripts/add-hub-secret-version.sh sj-auth-secret
./scripts/add-hub-secret-version.sh sj-auth-google-id
./scripts/add-hub-secret-version.sh sj-auth-google-secret
./scripts/add-hub-secret-version.sh sj-allowed-emails
./scripts/add-hub-secret-version.sh sj-espn-s2
./scripts/add-hub-secret-version.sh sj-espn-swid
./scripts/grant-hub-secret-access.sh
```

Generate `AUTH_SECRET` without pasting:

```bash
openssl rand -base64 32 | gcloud secrets versions add sj-auth-secret \
  --project=fantasy-sports-analytics --data-file=-
```

### Optional: pull to a laptop

```bash
./scripts/pull-hub-secrets.sh
# writes apps/web/.env.local and .env.espn
```

## Data pipeline

Snapshots live in a Cloud Storage bucket, not on the web container's disk, so
they survive Cloud Run restarts and stay identical across instances.

```
Cloud Scheduler ──▶ Cloud Run Job (sj-sync) ──▶ gs://<project>-sj-data
                                                        │ (RW mount)
                                                        ▼
                                              Cloud Run service (sj-hub)
                                         (ESPN reads + golf/members writes)
```

- **ESPN writes:** the `sj-sync` job runs `sj sync --current-only` on a schedule
  (default every 30 minutes) with ESPN cookies from Secret Manager.
- **Hub writes:** golf leagues, auction rooms, and `hub_members.json` go to the
  same bucket (`SJ_HUB_DIR=/app/data/sj`). Sync skips `platform: hub` / golf.
- **Reads:** the hub mounts the bucket read-write at `/app/data/sj` and caches
  snapshot JSON via Next.js Data Cache (`unstable_cache`, tag `sj-snapshots`)
  for `SJ_CACHE_TTL_MS` (default 60s). After sync, POST
  `https://<hub>/api/revalidate` with `Authorization: Bearer $SJ_REVALIDATE_SECRET`
  (optional `SJ_REVALIDATE_URL` + secret on the sync job). If the bucket is empty it falls
  back to the fixtures baked into the image.
- **Projections / player map / draft sim / weekly / playoff odds:** `nightly
  refresh` exports under `store/` and promotes JSON to
  `gs://…-sj-data/projections/`, `player_map/`, `draft_sim/`,
  `weekly_projections/`, and `playoff_odds/` (WIF as `ffa-deployer`). Re-run
  `./scripts/setup-github-deployer.sh` so the deployer has `objectUser` on the
  bucket. Mount the bucket on the hub (deploy-hub **bucket** input) to serve
  them. Playoff odds promote only when refresh wrote them from live `data/sj`
  (marker `.from_live_sj`); committed `fixtures/sj/playoff_odds/` remain the
  offline hub fallback and are never promoted from a fixtures-only run.
- **Cold starts:** deploy uses `--cpu-boost` and `--min-instances=0` by default.
  Set **min_instances=1** on a manual deploy if first-load latency bothers members.

### One-time setup (Cloud Shell)

```bash
./scripts/setup-sync-infra.sh
./scripts/setup-github-deployer.sh   # also grants refresh promote objectUser
```

Creates the bucket, grants IAM, and registers the Cloud Scheduler trigger.
Override defaults with `SJ_BUCKET`, `SJ_SCHEDULE`, `GCP_REGION`.

### Alerting (Cloud Shell)

After the sync job has been deployed at least once:

```bash
./scripts/setup-sync-alerting.sh
# defaults to austincwiley@gmail.com; override with NOTIFY_EMAIL=…
```

Creates (or updates) a Cloud Monitoring alert that emails when the `sj-sync`
Cloud Run Job finishes non-success — the scheduled `sj sync --current-only`
path exits 1 on any skipped season. Also creates an HTTPS uptime check on
`/api/health` (expects HTTP 200) when the hub URL is resolvable. Confirm the
notification channel from the verification mail Google sends. The health probe
returns 503 when snapshots are missing or older than `SJ_HEALTH_STALE_SECONDS`
(default 2 hours) — prefer a GCS-mounted hub so sync keeps timestamps fresh.

### Deploy

1. GitHub → **Actions** → **deploy sync job** → Run workflow
2. GitHub → **Actions** → **deploy hub** → Run workflow

### Backfill history

The registry declares every season (football back to 2015, dynasty to 2018).
Scheduled runs only refresh the current season; load history once with:

1. GitHub → **Actions** → **backfill sync** → **Run workflow**
2. Leave defaults (`backfill`, wait=`true`)
3. Confirm the job finishes green; invalid ESPN seasons are skipped on backfill

Equivalent CLI:

```bash
gcloud run jobs execute sj-sync --args=backfill \
  --region=us-central1 --project=fantasy-sports-analytics
```

Deploy the sync job first if `sj-sync` does not exist yet (**deploy sync job**).
Hub only sees backfilled seasons when deployed with the GCS bucket mounted
(**deploy hub** → set **bucket** to `fantasy-sports-analytics-sj-data`).

Seasons ESPN refuses (`invalid_league`) are skipped and reported on
`backfill` without failing the run. Auth, network, and unknown errors still
fail the job. Scheduled `sj sync --current-only` fails the run on **any**
skipped season (exit 1) and always prints a machine-readable
`SYNC_SUMMARY {...}` line for Cloud Logging / alerting.

### Sync from a laptop (optional)

```bash
source .env.espn
pip install -e ".[dev,gcs]"

sj sync --current-only                 # writes to ./data/sj
sj status

# Replace fixture/dummy copies under data/sj with live ESPN:
#   rm -rf data/sj && source .env.espn && sj sync --current-only
#   sj backfill   # optional multi-season history
SJ_GCS_BUCKET=... sj sync              # writes to Cloud Storage
sj status                              # what's in the store
```

## Local web app (optional)

```bash
cd apps/web
../../scripts/pull-hub-secrets.sh
npm install
npm run dev
```

### Local data without ESPN credentials

The app falls back to `fixtures/sj/`. Those samples stay small (3–4 teams) and
on the schema_version 1 monolith layout, but they are regenerated from the live
serializer so every field a real sync would emit is present:

```bash
sj regenerate-fixtures   # rewrite fixtures/sj from the serializer
sj validate-fixtures     # CI/local gate — fails on drift
```

They still hide anything that only shows up at real scale — table pagination,
page weight, wide-table layout, multi-season navigation. `sj seed` fills the
local store with realistic-scale **synthetic** snapshots instead:

```bash
sj seed                              # every league and season in the registry
sj seed --current-only               # just the current season of each league
sj seed --league football-main       # one league
sj seed --teams 14                   # override team count
```

The full registry is 24 league-seasons (~6 MB) and takes under a second. Output
is deterministic per league-season, and it is built by driving the same
serializer and store as `sj sync`, so seeded data always matches the live
snapshot schema.

Guardrails: `sj seed` only ever writes to a local directory — `SJ_GCS_BUCKET` is
ignored, so synthetic data cannot reach the production bucket — it drops a
`SYNTHETIC.txt` marker in the target directory, and it refuses to overwrite
snapshots that lack that marker unless you pass `--force`. To go back to real
data, delete `data/sj/` and run `sj sync`.

## Layout

```
configs/leagues.yaml     League registry
src/sj/                  Sync + store CLI (`sj`)
scripts/                 Secret Manager, IAM, and infra helpers
fixtures/sj/             Sample snapshots (fallback)
data/sj/                 Local sync output (gitignored)
apps/web/                Next.js hub (+ Dockerfile for Cloud Run)
Dockerfile.sync          Sync job image (Cloud Run Job)
src/ffa/                 NFL analytics engine (later phase)
```
