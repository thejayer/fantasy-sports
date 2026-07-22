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

## Sync ESPN → local JSON

Private leagues need ESPN cookies from a logged-in browser session:

1. Log into ESPN Fantasy in Chrome.
2. DevTools → Application → Cookies → `espn.com`
3. Copy `espn_s2` and `SWID`

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

export ESPN_S2='...'
export ESPN_SWID='{...}'   # SWID also accepted

# Current seasons only (fast)
sj sync --current-only

# One league / season
sj sync --league football-main --season 2025

# Everything in the registry (can take a while for long histories)
sj sync
```

Snapshots write to `data/sj/<league-id>/<season>.json`. The web app reads
`data/sj` first, then falls back to committed `fixtures/sj` sample data.

## Web app

```bash
cd apps/web
cp .env.example .env.local
# set AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_SECRET, ALLOWED_EMAILS
# keep AUTH_DEV_BYPASS=1 for local browsing without Google

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Google allowlist auth

Production should set:

- `AUTH_SECRET`
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` from Google Cloud OAuth
- `ALLOWED_EMAILS` = comma-separated Strictly Jayers member Gmail addresses
- `AUTH_DEV_BYPASS` unset or `0`

Only allowlisted Google accounts can sign in.

## Layout

```
configs/leagues.yaml     League registry
src/sj/                  Sync + store CLI (`sj`)
fixtures/sj/             Sample snapshots for offline UI
data/sj/                 Live sync output (gitignored)
apps/web/                Next.js member hub
src/ffa/                 Existing NFL analytics engine (later phase)
```
