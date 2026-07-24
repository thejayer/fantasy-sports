# Strictly Jayers hub

Member hub for Strictly Jayers fantasy leagues. V1 focuses on ESPN league
data: standings, teams, rosters, and players.

## Leagues (current scope)

| id | Sport | Format | ESPN league id | Seasons |
|---|---|---|---|---|
| `baseball-dynasty` | baseball | dynasty | 2499137 | 2024–2026 |
| `football-main` | football | redraft | 39790 | 2015–2026 |
| `football-dynasty` | football | dynasty | 94266 | 2018–2026 |

Registry: [`configs/leagues.yaml`](configs/leagues.yaml)

## Secrets (GCP Secret Manager)

Source of truth is Secret Manager in project **`fantasy-sports-analytics`**.
Do not commit secret values.

| Secret name | Env var | Used by |
|---|---|---|
| `sj-auth-secret` | `AUTH_SECRET` | Next.js / Auth.js |
| `sj-auth-google-id` | `AUTH_GOOGLE_ID` | Next.js / Auth.js |
| `sj-auth-google-secret` | `AUTH_GOOGLE_SECRET` | Next.js / Auth.js |
| `sj-allowed-emails` | `ALLOWED_EMAILS` | Next.js allowlist |
| `sj-espn-s2` | `ESPN_S2` | `sj sync` only |
| `sj-espn-swid` | `ESPN_SWID` | `sj sync` only |

### 1. Create secret shells (Cloud Shell)

From the repo root in [Cloud Shell](https://shell.cloud.google.com/):

```bash
git clone https://github.com/thejayer/fantasy-sports.git
cd fantasy-sports
git checkout cursor/strictly-jayers-hub-3b10   # until merged

chmod +x scripts/*.sh
./scripts/create-hub-secrets.sh
```

This creates the six secrets with a temporary `REPLACE_ME` version.

### 2. Populate values (Cloud Shell)

Interactive (value is hidden as you paste):

```bash
./scripts/add-hub-secret-version.sh sj-auth-secret
./scripts/add-hub-secret-version.sh sj-auth-google-id
./scripts/add-hub-secret-version.sh sj-auth-google-secret
./scripts/add-hub-secret-version.sh sj-allowed-emails
./scripts/add-hub-secret-version.sh sj-espn-s2
./scripts/add-hub-secret-version.sh sj-espn-swid
```

Or generate `AUTH_SECRET` without pasting:

```bash
openssl rand -base64 32 | gcloud secrets versions add sj-auth-secret \
  --project=fantasy-sports-analytics --data-file=-
```

`ALLOWED_EMAILS` should be a comma-separated list, e.g.
`you@gmail.com,friend@gmail.com`.

### 3. Pull secrets to your laptop (optional)

```bash
gcloud auth login
gcloud config set project fantasy-sports-analytics
./scripts/pull-hub-secrets.sh
```

Writes:

- `apps/web/.env.local` — for `npm run dev`
- `.env.espn` — `source .env.espn` before `sj sync`

Both files are gitignored.

### 4. Cloud Run (when you deploy the hub)

```bash
./scripts/hub-cloud-run-secrets.sh   # prints the mapping
```

Mount auth secrets on the web service with `--set-secrets=...`.
Keep ESPN cookies off the public service; use them only in a sync job.

## Sync ESPN → local JSON

Private leagues need ESPN cookies (`espn_s2` + `SWID`) in Secret Manager
(see above), or exported in your shell.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

source .env.espn   # after pull-hub-secrets.sh
# or: export ESPN_S2=... ESPN_SWID=...

sj sync --current-only
sj sync --league football-main --season 2025
sj sync   # full history; skips seasons ESPN doesn't have yet
```

Snapshots write to `data/sj/<league-id>/<season>.json`. The web app reads
`data/sj` first, then falls back to committed `fixtures/sj` sample data.

## Web app

```bash
cd apps/web
# Prefer: ../../scripts/pull-hub-secrets.sh
# Or temporarily: cp .env.example .env.local and edit

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Only Google accounts in `ALLOWED_EMAILS` can sign in (`AUTH_DEV_BYPASS=0`).

## Layout

```
configs/leagues.yaml     League registry
src/sj/                  Sync + store CLI (`sj`)
scripts/                 Secret Manager helpers
fixtures/sj/             Sample snapshots for offline UI
data/sj/                 Live sync output (gitignored)
apps/web/                Next.js member hub
src/ffa/                 Existing NFL analytics engine (later phase)
```
