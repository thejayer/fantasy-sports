# Strictly Jayers community portal (`apps/www`)

Public front door for **https://strictlyjayers.com**.

The fantasy member hub stays on **https://fantasy.strictlyjayers.com**
(`apps/web`). This app never proxies or rewrites league routes — it deep-links
with absolute URLs so Auth.js cookies and snapshot data stay on the hub host.

**Bets** (`/bets`) is the one members-only surface on this host (roadmap P.11).
Auth.js + Google uses the same allowlist as Fantasy / Fitness
(`ALLOWED_EMAILS` ∪ `{SJ_HUB_DIR}/hub_members.json`). The rest of the apex
stays public. There is **no service worker** on www — `/bets` is a
server-rendered page, not a PWA.

See [PORTAL.md](../../PORTAL.md) for domain routing and deploy.

## Local

```bash
cd apps/www
cp .env.example .env.local   # AUTH_DEV_BYPASS=1 opens /bets
npm install
npm run dev                  # http://localhost:3002
```

| Env | Purpose |
|---|---|
| `SITE_URL` | Canonical origin (metadata + Auth.js host) |
| `AUTH_URL` | Auth.js public origin (same as `SITE_URL` in prod) |
| `FANTASY_HUB_URL` | Absolute link to the hub (default production host) |
| `FITNESS_URL` | Absolute link to the fitness log (default production host) |
| `DISCORD_INVITE_URL` | Optional Discord CTA override (default baked in) |
| `PALWORLD_INFO_URL` | Optional extra Palworld link on `/palworld` |
| `PALWORLD_STATUS` | Optional public world-status line (never IPs/passwords) |
| `YOUTUBE_PLAYLIST_ID` | Optional override for `/watch` (default baked in) |
| `AUTH_SECRET` | Same secret as sj-hub (`sj-auth-secret`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Same Google OAuth client as sj-hub |
| `ALLOWED_EMAILS` | Same env allowlist (`sj-allowed-emails`) |
| `SJ_HUB_DIR` | Read `hub_members.json` (prod: `/app/data/sj`) |
| `SJ_BETS_DIR` | Override `bets.json` directory (local: `fixtures/bets`) |
| `AUTH_DEV_BYPASS` | Local / CI only — skip Google |

```bash
cd apps/www && npm test && npm run build && npm run test:e2e
AUTH_DEV_BYPASS=1 npm run test:e2e:bets
AUTH_DEV_BYPASS=0 npm run test:e2e:auth
```

## Bets ingest

`sj bets` looks up the Drive file's `mimeType` (read-only Drive + Sheets
scopes via ADC) and then:

- native Google Sheet (`application/vnd.google-apps.spreadsheet`) → Sheets API
- uploaded `.xlsx` → `files.get?alt=media` + the same Bets-tab parser as `--from`

The live tracker id is an uploaded `.xlsx` in Drive today — no conversion
needed. Austin shares that file with the reader SA as Viewer. Writes
`bets/bets.json` + `bets/summary.json` to the store
(`gs://fantasy-sports-analytics-sj-data/bets/` when `SJ_GCS_BUCKET` is set).

```bash
# Offline fixture → local JSON (what CI / the fallback UI use)
sj bets --from tests/fixtures/bets/trent_steve_bet_tracker.xlsx \
  --store-dir apps/www/fixtures

# Live Drive file (xlsx or native Sheet; share with the job SA as Viewer)
sj bets
```

One-time GCP: `./scripts/setup-bets-infra.sh` (SA, Drive + Sheets APIs,
scheduler `32 9-23/2 * * *` America/Chicago). Image updates ride
**deploy sync job**. Share the file with
`sj-bets-reader@fantasy-sports-analytics.iam.gserviceaccount.com` as Viewer.

## Google OAuth (one-time, Austin)

Use the **existing** hub OAuth client. Add:

| Field | Value |
|---|---|
| Authorized JavaScript origin | `https://strictlyjayers.com` |
| Authorized redirect URI | `https://strictlyjayers.com/api/auth/callback/google` |

Keep the Fantasy and Fitness pairs. Also keep the `*.run.app` pair if you
still open the Cloud Run URL directly.

## Cloud Run env (`sj-www`)

Push CD (`.github/workflows/deploy-portal.yml`) now sets the hub auth secrets
and mounts `gs://fantasy-sports-analytics-sj-data` **read-only** at
`/app/data/sj` (uid/gid `1001`, semicolon `mount-options`). Do not
`mkdir`/`stat` the FUSE mount in the entrypoint.

| Runtime env | Source | Purpose |
|---|---|---|
| `SITE_URL` / `AUTH_URL` | `https://strictlyjayers.com` | Canonical host (keep non-`*.run.app`) |
| `AUTH_TRUST_HOST` | `true` | Cloud Run / custom domain |
| `AUTH_SECRET` | secret `sj-auth-secret:latest` | Same JWT secret as sj-hub |
| `AUTH_GOOGLE_ID` | secret `sj-auth-google-id:latest` | Same Google OAuth client |
| `AUTH_GOOGLE_SECRET` | secret `sj-auth-google-secret:latest` | Same Google OAuth client |
| `ALLOWED_EMAILS` | secret `sj-allowed-emails:latest` | Same env allowlist as Fantasy |
| `SJ_HUB_DIR` | `/app/data/sj` | `hub_members.json` + `bets/` |
