# Strictly Jayers hub

Member hub for Strictly Jayers fantasy leagues. V1 focuses on ESPN league
data: standings, teams, rosters, players, matchups (weekly scores / schedule /
playoff seeds), and multi-season history (all-time, champions, records, H2H).
Loading / empty / error states and mobile table cards are in place (roadmap 3.6).

For the current state of the site and the plan to build it out, see
[AUDIT.md](AUDIT.md) and [ROADMAP.md](ROADMAP.md).

## Leagues (current scope)

| id | Sport | Format | ESPN league id | Seasons |
|---|---|---|---|---|
| `baseball-dynasty` | baseball | dynasty | 2499137 | 2024–2026 |
| `football-main` | football | redraft | 39790 | 2015–2026 |
| `football-dynasty` | football | dynasty | 94266 | 2018–2026 |

Registry: [`configs/leagues.yaml`](configs/leagues.yaml)

### Baseball scope (roadmap 4.6)

**Projection-free by design.** `sj` syncs ESPN baseball snapshots (standings,
rosters with batter/pitcher boards, matchups, history). The `ffa` analytics
engine is NFL-only — no MLB ingest, no baseball projection snapshots, no trade
tools on category leagues. Baseball `projections` / `tools` tabs in the hub
explain that boundary; do not stub a half engine. Revisit only with a dedicated
MLB modeling plan.

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
3. Leave **bucket** blank to serve baked fixtures (default for CD). Set it to
   `fantasy-sports-analytics-sj-data` only after `./scripts/setup-sync-infra.sh`
   has granted the hub runtime SA read access on that bucket.
4. When it finishes, copy the printed URL

### Google OAuth redirect (required after first deploy)

In GCP → **APIs & Services** → **Credentials** → your OAuth client, add:

- **Authorized JavaScript origin:** `https://sj-hub-….run.app`
- **Authorized redirect URI:** `https://sj-hub-….run.app/api/auth/callback/google`

(Use the exact URL the workflow prints.)

Then open that URL and sign in with an allowlisted Google account.

The deploy workflow sets `AUTH_URL` to the public Cloud Run URL. Without that,
Auth.js can redirect to `https://0.0.0.0:8080` (the container bind address).

If you need to set it manually:

```bash
gcloud run services update sj-hub \
  --project=fantasy-sports-analytics \
  --region=us-central1 \
  --update-env-vars="AUTH_URL=https://sj-hub-w6arul2i6a-uc.a.run.app,AUTH_TRUST_HOST=true"
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
| `sj-allowed-emails` | `ALLOWED_EMAILS` | Next.js allowlist |
| `sj-espn-s2` | `ESPN_S2` | ESPN sync (container start / CLI) |
| `sj-espn-swid` | `ESPN_SWID` | ESPN sync (container start / CLI) |

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
                                                        │ (read-only mount)
                                                        ▼
                                              Cloud Run service (sj-hub)
```

- **Writes:** the `sj-sync` job runs `sj sync --current-only` on a schedule
  (default every 30 minutes) with ESPN cookies from Secret Manager.
- **Reads:** the hub mounts the bucket read-only at `/app/data/sj` and caches
  snapshot JSON via Next.js Data Cache (`unstable_cache`, tag `sj-snapshots`)
  for `SJ_CACHE_TTL_MS` (default 60s). After sync, POST
  `https://<hub>/api/revalidate` with `Authorization: Bearer $SJ_REVALIDATE_SECRET`
  (optional `SJ_REVALIDATE_URL` + secret on the sync job). If the bucket is empty it falls
  back to the fixtures baked into the image.
- **Projections / player map:** `nightly refresh` exports under `store/` and
  promotes JSON to `gs://…-sj-data/projections/` + `player_map/` (WIF as
  `ffa-deployer`). Re-run `./scripts/setup-github-deployer.sh` so the deployer
  has `objectUser` on the bucket. Mount the bucket on the hub (deploy-hub
  **bucket** input) to serve them.
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

```bash
gcloud run jobs execute sj-sync --args=backfill \
  --region=us-central1 --project=fantasy-sports-analytics
```

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
