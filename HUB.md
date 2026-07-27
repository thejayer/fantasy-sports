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

## Production (Cloud Run) — preferred

Hosted as Cloud Run service **`sj-hub`** in project **`fantasy-sports-analytics`**.

App secrets (Google OAuth, allowlist, ESPN cookies) live in **GCP Secret Manager**.
The GitHub Action that deploys also needs a separate credential: repository
secret **`GCP_SA_KEY`** (a GCP service-account JSON key). That is *not* created
by `create-hub-secrets.sh`.

### One-time GCP setup (Cloud Shell)

```bash
cd fantasy-sports   # repo checkout on main
git pull
chmod +x scripts/*.sh

# App secrets in Secret Manager (if you haven't already):
./scripts/create-hub-secrets.sh
./scripts/add-hub-secret-version.sh ...   # populate each secret
./scripts/grant-hub-secret-access.sh      # Cloud Run runtime can read them

# GitHub Actions deploy key (fixes the auth/credentials_json error):
./scripts/setup-github-deployer.sh
# → paste key.json into GitHub → Settings → Secrets → Actions → GCP_SA_KEY
# → rm key.json
```

### Deploy

1. Confirm `GCP_SA_KEY` exists under repo **Settings → Secrets and variables → Actions**
2. GitHub → **Actions** → **deploy hub** → **Run workflow**
3. Defaults are fine (`fantasy-sports-analytics` / `us-central1` / `sj-hub`)
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

## Sync ESPN from a laptop (optional)

```bash
source .env.espn
pip install -e ".[dev]"
sj sync --current-only
```

In production, sync runs on Cloud Run container start (`SJ_SYNC_ON_START=1`).

## Local web app (optional)

```bash
cd apps/web
../../scripts/pull-hub-secrets.sh
npm install
npm run dev
```

## Layout

```
configs/leagues.yaml     League registry
src/sj/                  Sync + store CLI (`sj`)
scripts/                 Secret Manager + IAM helpers
fixtures/sj/             Sample snapshots (fallback)
data/sj/                 Live sync output (gitignored)
apps/web/                Next.js hub (+ Dockerfile for Cloud Run)
src/ffa/                 Existing NFL analytics engine (later phase)
```
