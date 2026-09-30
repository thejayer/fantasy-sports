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
| `hockey-main` | hockey | redraft | ESPN `1023106173` | 2026–2027 |
| `golf-main` | golf | h2h | hub (no ESPN) | 2026 |

Registry: [`configs/leagues.yaml`](configs/leagues.yaml)

### Baseball scope (roadmap 4.6 + 8.2)

**Projection-free by design.** `sj` syncs ESPN baseball snapshots (standings,
rosters with batter/pitcher boards, matchups, draft results, activity, free
agents, history). The `ffa` analytics engine is NFL-only — no MLB ingest, no
baseball projection snapshots. The `projections` tab keeps that EmptyState.
Roadmap **8.2** fills `tools` with snapshot arithmetic: Category Board, Usage
Caps (season IP/GS + period IP floors), PR7/PR15/PR30 trailing windows,
games-per-team and two-start pitchers from `pro_schedule.json` (site
`probables`), and daily locks from game start times. ESPN period H2H category
boxes open from Matchups (`CategoryBoxPanel` over `weeks/{N}.json`). FA
browsing remains the Waivers tab. Hall of Shame (`?tab=drops`, roadmap 9.5)
ranks worst drops from synced activity. Season-points Analysis
(`?tab=analysis`, roadmap 8.5) shows points by lineup slot, bats vs
pitchers, and a cumulative season chart from synced
`analysis/slot_points.json` + `analysis/points_timeseries.json` — `sj sync`
walks ESPN `mRoster` per scoring period offline; the hub never calls ESPN
from a request. H2H category baseball gets an EmptyState (no invented FP).
Do not stub a half engine. Revisit projections only with a dedicated MLB
modeling plan.

### Baseball Analysis (roadmap 8.5)

`?tab=analysis` on baseball **and hockey** Season Points (`TOTAL_SEASON_POINTS`).
Three views on one page:

1. **Points by lineup slot** — baseball C / 1B / … / P / RP; hockey
   Forward / Defense / Goalie / Util — plus Starters, ESPN team pts, Bench unused.
2. **Split** — baseball bats vs pitchers; hockey skaters vs goalies.
3. **Season points chart** — one line per team of cumulative starter FP across
   scoring periods (ESPN `scoringPeriodId` ≈ calendar day). Toggle
   `?series=cumulative|daily|weekly` (cumulative default). Month ticks when
   dates exist.

**How it is produced.** Not from `lineups.json` / `weeks/` (those are empty for
season-points baseball/hockey). After the season snapshot, `sj sync` /
`sj backfill` / `sj analysis` call `sync_season_points_analysis`: for each
scoring period, `view=mRoster` and credit `player.stats[].appliedTotal` where
`statSourceId=0` and `statSplitTypeId=5` to that day's `lineupSlotId`. Do
**not** use `ppe.appliedStatTotal` (~1.7× high vs ESPN). Starter sum should
land within ~1% of ESPN team points. Incremental: completed periods in
`analysis/slot_points.json` `period_slots` are reused; `--force` /
`sj analysis --force` re-walks. Throttle matches the transactions fallback
(`SJ_TXN_PERIOD_THROTTLE`). Missing analysis → EmptyState. Committed fixtures
ship a synthetic sample; live numbers come from a cookie sync.

### Hockey scope

**ESPN + the NHL data layer ([HOCKEY-PORT.md](HOCKEY-PORT.md)).** `hockey-main`
is ESPN `1023106173`: hub 2026 (2025–26) and hub 2027 (2026–27, current,
`current_season`). ESPN years 2024 and 2025 do not exist for this id. `sj sync`
/ `sj backfill` pull listed seasons when ESPN cookies are set. `sj sync` still
skips `espn_league_id <= 0` so other placeholders cannot call `League(0)`.

Hockey reuses the ESPN snapshot layout (standings, rosters, matchups, draft,
activity, free agents). espn-api hockey is closer to baseball (Matchup objects,
optional category matrices) plus football-shaped `box_scores` with applied
totals. The hub does **not** invent player week lines ESPN omitted, and does
**not** add NHL code to `src/ffa` — hockey has its own package, `src/nhl`.

- **Season Points:** SJ Hockey is `TOTAL_SEASON_POINTS` — total points for the
  whole regular season, no weekly matchups. Standings rank by cumulative points
  (like season-points baseball); the committed fixture matches.
- **H0 (landed):** league scoring, lineup slot counts, and per-slot GP caps are
  read from ESPN at sync (`settings.categories`, `position_slot_counts`,
  `lineup_slot_stat_limits` on `GP`). `configs/hockey_scoring.yaml` holds the
  SJ Hockey rules as an override for tests/fixtures/sandboxing only
  (`nhl.scoring`).
- **H1 (landed):** after the current hockey season syncs, `sj sync` calls the
  public NHL API and writes side concerns under `{league}/{season}/nhl/`
  (not in `manifest.files`, no index upsert): `player_map.json` (ESPN id → NHL
  id, match method, coverage), `nhl_context.json` (age, ht/wt, team, prior
  team, EV/PP minutes, goalie start share, recent NHL stat lines, draft/minors
  for rookies), `schedule.json` (club schedules + back-to-backs), and
  `team_strength.json` (GF/GA/SF/SA, PK%, PP%, blended with last season until
  15 GP). `sj nhl --league hockey-main [--fail-below 0.98]` rebuilds them from
  the stored snapshot (no ESPN cookies). `SJ_NHL_SYNC=0` turns the post-sync
  step off; NHL failures are reported and never fail the ESPN sync. The hub
  reads them via `getHockeyNhl` — never the NHL from a request. Roster and
  Waivers tables show **Age, Ht, Wt, Team, EV min, PP min** ("—" when missing).
- **H2 + H3 (landed): player values.** The same sync step writes
  `nhl/values.json` for every rostered player and free agent (`src/nhl/value.py`,
  `durability.py`, `aging.py`, `prospects.py`, `roles.py`). Per-game value is a
  weighted blend — last 7/15/30 days, this season, ESPN's projected stat line
  scored under league rules, age-adjusted NHL history (3 seasons,
  1.0/0.5/0.25), a prospect estimate for rookies, or a flagged role estimate
  when nothing else exists. ROS = value × remaining team games × expected
  share played (H3 durability; goalies use start share; real season length —
  2026–27 is 84 games). Zero projections and zero past seasons are gaps;
  missing data is null.
- **H2b (landed): backtested and tuned.** `sj nhl-backtest` replays 2022–23 …
  2025–26 and scores the model against what happened
  ([HOCKEY-BACKTEST.md](HOCKEY-BACKTEST.md)). The tuned weights (less weight
  on short streaks, more on this season, faster-decaying history, role
  adjustment off) cut error 15% on held-out seasons and ship as the defaults.
  The board shows the shipped model's typical miss per game by position.
- **H4 (landed): Daily Faceoff lines + starting goalies.** The same sync step
  (unless `SJ_DFO_SYNC=0`) reads the 32 clubs' Daily Faceoff line-combination
  pages and the next three days of starting goalies, matches names to NHL ids,
  and writes `nhl/lines.json` + `nhl/starting_goalies/{date}.json`; published
  lines / PP units replace the ice-time role estimate. A light `sj nhl-lines`
  job (Cloud Scheduler `sj-hockey-lines-1500` / `-1730`, Central) refreshes
  just lines + goalies after confirmations land. Roster and Waivers show
  **Role** (with possible-scratch / injury flags), **PP** (links to the club's
  Daily Faceoff page) and **Linemates**.
- **H5a (landed): decision tools.** Hockey **Tools** gains **Waiver board**
  (`view=waivers`: value, upgrade over the team's weakest healthy F / D / G,
  next-7-day points, filters), **Compare free agents** (`view=compare&ids=`,
  2–4 side by side with a verdict), **Evaluate a move** (`view=move&drop=&add=`:
  value / next-14 / ROS deltas and warnings) and **Weakest to best**
  (`view=depth`). Open to every member; `team=` picks any franchise and
  defaults to the viewer's linked one. Reads `values.json`, `schedule.json`
  (`getHockeySchedule`) and the bios/lines join — server-rendered forms only.
- **H5b (landed): daily tools.** **Start / sit** (`view=lineup&date=`: best
  lineup for a day from ESPN slot counts, with reasons for every sit), **Goalie
  starts** (`view=goalies&date=`: start chance from Daily Faceoff or share of
  starts, win / saves / GA / shutout from `team_strength.json`
  via `getHockeyTeamStrength`, scored with league weights), **Streaming
  planner** (`view=streaming`: open slots per day and the free agents who fill
  them) and **Games-played pace** (`view=pace`: starter games per slot against
  ESPN's GP caps). Pacing reads `teams[].games` + `periods.final` that the
  season-points analysis sync now writes for hockey.
- **H7 (landed): ESPN ownership.** `sj sync` (current hockey season) adds
  ESPN-wide `percent_owned` / `percent_change` (7-day) / `percent_started`
  to every rostered player and free agent (`sj.hockey_ownership`; failures
  never fail the sync) and `values.json` carries them. Waiver board gains
  **ESPN %** (with the change) and a **Rising** filter; players rostered in
  85%+ of ESPN leagues are protected (🔒) — never a suggested drop, and
  Evaluate a move warns first. The Waivers tab's % Own shows the change.
- **H6 (landed): injuries & alerts.** Each hockey sync (and the afternoon
  `sj nhl-lines` job) updates `nhl/injury_log.json`: ESPN + Daily Faceoff
  status per player and transitions (hurt / nearing return / back); the first
  log is a silent baseline. Hockey → Tools → **Injuries & alerts**
  (`view=alerts`) shows lineup alerts for the picked team (injured starter,
  healthy player on IR, lineup goalie whose partner is named, named starter
  on the bench, possible scratch in the lineup, ESPN vs Daily Faceoff
  disagreeing) and the league's injury news with ESPN news links. Injury news
  also appears in the Feed, and the member home shows one alerts action for
  a linked hockey team. Discord posting is opt-in (below).
- The hockey **`projections` tab** is the values board: value, ROS, ESPN
  per-game, share played, age, data-source tag, a recent-form setting
  (`?recent=0…1`, re-blended from saved inputs in `lib/hockey-values.ts`),
  position / rostered / free-agent filters, sort, 25-row pages, and one
  expanded input breakdown at a time (`?open=`). Roster and Waivers gain Value
  and ROS. Tools are Category Board (when `season_stats` exist), Scoring lab,
  and the season-points Analysis tab below.

espn-api hockey `Player` omits `total_points`. Sync derives season FP from
`season_stats × scoring_format` counting weights (skipping GAA/SV%) and
attaches ESPN `teams[].points` as `points_for` so Hall of Shame can rank drops.

Season-points Analysis (`?tab=analysis`, roadmap 8.5 twin) is the baseball
walk with hockey slots: Forward / Defense / Goalie / Util, skaters vs goalies,
and a cumulative chart from `analysis/slot_points.json` +
`analysis/points_timeseries.json`. `sj analysis --league hockey-main` (or
`sj sync`) walks `mRoster` per scoring period; never `ppe.appliedStatTotal`.

### Golf scope (roadmap 6.4a–e + 6.5 + auction/keepers + live room + 8.3)

**Hub-native** PGA Tour counting leagues (LIV real-team model) — not ESPN and
not `ffa`. Package: `src/sg` (snake **or** offline auction + keepers) plus hub
live nomination room (`auction_room.json`, polled). Fixture `golf-main` stays
snake. Create UI can run offline auction or **Live nomination room** (empty
draft → Auction tab). Hub surfaces: Standings, Teams, Settings, Scoring lab, Schedule
(with start-usage board), Lineup, Scoreboard (Final / Through + projected),
Draft, **Auction**, History, plus golfer detail pages from roster links.
Scoring stays offline — no live tour scrapes. Tee locks fail closed (UTC).
Missed-deadline auto-pick and per-segment start caps are settings knobs.
Room is file-backed + HTTP polling (no websockets/Redis).

### Hall of Shame / worst drops (roadmap 9.5)

`?tab=drops` on ESPN sports (football, baseball, hockey) ranks this season's
first drop per team–player by the cut player's **season fantasy points**
(`total_points` on the current roster, free-agent, or players row — ESPN
applied total for the whole season, not points after the cut). Claimed-after
is the first later `FA ADDED` / `WAIVER ADDED`; a note flags when the same
franchise re-added the player. Trades are not drops. Empty
`transactions.json` (pre-2019, or a season that has not been re-synced after
the `mTransactions2` fallback) shows an EmptyState. Season chips switch
2024 / 2025 / 2026 when those snapshots exist. Read-only — no ESPN write-back.
Season-points baseball keeps the tab beside Scoring lab and Analysis; other
leagues file it under More.

### Scoring lab (roadmap 8.4)

`?tab=sandbox` on every sport clones the league's official scoring items
(football/baseball/hockey weights, golf keep-N / multipliers) and rescores in the
browser. Football uses stored week box `stats` and shows matchup W/L flips;
baseball and hockey Season Points / H2H points reweight roster counting stats
(H2H cats show rank flips, not fake points — empty stats stay EmptyState);
golf re-keeps scoreboard slot points. Nothing writes ESPN or the live settings
file — optional `sessionStorage` draft only.

## Production (Cloud Run) — preferred

Hosted as Cloud Run service **`sj-hub`** in project **`fantasy-sports-analytics`**.

App secrets (Google OAuth, allowlist, ESPN cookies, OpenAI recap key) live in **GCP Secret Manager**.
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
| `fitness.strictlyjayers.com` | Training log (`sj-fitness` / `apps/fitness`) |

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
| `openai-api-key` | `OPENAI_API_KEY` | Weekly recap columnist (Cloud Run `sj-hub`, not CI) |

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

Linked members land on `/` with a **Your portfolio** strip (roadmap 9.4) —
sport, team, record, standing, current/next matchup across football, baseball,
and golf — plus the existing per-league cards. Local bypass: set
`SJ_DEV_VIEWER_EMAIL` to the email you linked in admin.

### Hub-native store (golf) vs ESPN sync store

| Env | Path (prod) | Mount | Owns |
|---|---|---|---|
| `SJ_DATA_DIR` | `/app/data/sj` | GCS **RW** (`…-sj-data`) | ESPN football/baseball from `sj sync` |
| `SJ_HUB_DIR` | `/app/data/sj` | same mount | Golf leagues, auction rooms, league feeds (`feed.json`), weekly recaps (`recaps/{period}.json`), recap usage caps (`recap_usage.json`), `hub_members.json` |

Prod uses **one** RW mount. A second FUSE volume (`…-sj-hub`) failed Cloud Run
PORT probes. `getLeagueIndex` still merges roots when they differ (local sibling
`data/hub`). Sync/backfill skip `platform: hub` and refuse to overwrite
`sport=golf`. Deploy hub with **bucket** only (`hub_bucket` is ignored).

Optional outbound digest: set `SJ_DISCORD_WEBHOOK_URL` on the hub service.
Admins can send the latest weekly digest from the Feed tab; delivery is
idempotent per league-season-period. Digests still render in-app when unset.

**Hockey injury news → Discord (HOCKEY-PORT.md H6)** is off by default. Deploy
CD replaces the service's env vars on every push, so the switch lives in the
repo, not on the service. To turn it on:

1. Store the league channel's webhook URL in Secret Manager (once):
   `printf %s "<webhook url>" | gcloud secrets create sj-discord-webhook --project fantasy-sports-analytics --data-file=-`
2. Let the hub's runtime service account read it (the account that already
   reads `sj-auth-secret`):
   `gcloud secrets add-iam-policy-binding sj-discord-webhook --project fantasy-sports-analytics --member=serviceAccount:<hub runtime SA> --role=roles/secretmanager.secretAccessor`
3. GitHub → Settings → Secrets and variables → Actions → **Variables** →
   `SJ_HOCKEY_INJURY_DISCORD` = `1`, then Actions → **deploy hub** → Run
   workflow (or wait for the next push to `main`).

`deploy-hub.yml` then sets `SJ_HOCKEY_INJURY_DISCORD=1` and maps
`SJ_DISCORD_WEBHOOK_URL=sj-discord-webhook:latest` (the secret is referenced
only when the variable is `1`, so deploys never fail on a missing secret).
Admins get **Post injury news to Discord** on Hockey → Tools → Injuries &
alerts (`POST /api/leagues/{id}/injury-digest`): the last 3 days of rostered
players' injury changes, each posted once (`injury_digest.json` under
`SJ_HUB_DIR`). Set the variable back to `0` to switch it off.

Weekly **Recap** column (`?tab=recap&week=N`, football/baseball): funny
power-rankings prose on top of the same digest facts. Admins POST
`/api/leagues/{id}/recap`. Production uses Secret Manager `openai-api-key` →
`OPENAI_API_KEY` on Cloud Run (`deploy-hub.yml` `--set-secrets`; a one-off
`gcloud run services update` is wiped on the next hub deploy). Default model
is **`gpt-5.6-luna`** (`SJ_RECAP_MODEL`); OpenAI wins when that key is set
unless `SJ_RECAP_PROVIDER=anthropic`. Cheap-model allowlist (Luna / 4.1-mini /
Haiku) unless `SJ_RECAP_ALLOW_EXPENSIVE=1`. Cost caps live in
`{SJ_HUB_DIR}/recap_usage.json`: `SJ_RECAP_DAILY_LIMIT` (default 12 UTC) and
`SJ_RECAP_PERIOD_LIMIT` (default 2 rewrites per league-season-week). A slot is
reserved under a lock **before** the LLM call (fail-closed if generation later
errors). Voice is **roast** by default (intramural needle, facts only); admins
pick Roast / Mild / Savage on the Recap button (`voice` on the POST). Optional
`SJ_RECAP_VOICE` / `SJ_RECAP_VOICE_NOTE` set the server default and a short
house running-joke line (flavor, not new numbers). Unchanged
facts skip the LLM unless the admin clicks Rewrite (`force`). Never generated
on page load. `AUTH_DEV_BYPASS` may write the template columnist. Committed
fixtures cover football-main weeks 13–14 and football-dynasty week 14.

### Create / populate (Cloud Shell)

```bash
./scripts/create-hub-secrets.sh
./scripts/add-hub-secret-version.sh sj-auth-secret
./scripts/add-hub-secret-version.sh sj-auth-google-id
./scripts/add-hub-secret-version.sh sj-auth-google-secret
./scripts/add-hub-secret-version.sh sj-allowed-emails
./scripts/add-hub-secret-version.sh sj-espn-s2
./scripts/add-hub-secret-version.sh sj-espn-swid
./scripts/add-hub-secret-version.sh openai-api-key
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
  (default once daily at 6:00 America/Chicago; override with `SJ_SCHEDULE`)
  with ESPN cookies from Secret Manager.
  Transactions come from paged `recent_activity` (25 topics per page, default
  200 pages / 5,000 topics; `SJ_ACTIVITY_MAX_PAGES` up to 400). Historical
  seasons (2019+) where that communication view is empty or raises
  `ESPNInvalidLeague` fall back to `mTransactions2` across scoring periods
  (`SJ_TXN_MAX_PERIODS`, default 200; `SJ_TXN_PERIOD_THROTTLE`, default 0.15s).
  Each sync **replaces** `transactions.json` — it does not merge with the prior
  file — so raise the cap if a baseball season is still missing early drops,
  then redeploy/run the sync job.
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

Creates the bucket, grants IAM, and registers the Cloud Scheduler trigger
(`0 6 * * *` America/Chicago unless overridden).
Override defaults with `SJ_BUCKET`, `SJ_SCHEDULE`, `SJ_TIMEZONE`, `GCP_REGION`.

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
(default 26 hours — one missed daily sync plus 2h slack) — prefer a
GCS-mounted hub so sync keeps timestamps fresh.

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
sj analysis --league baseball-dynasty --force   # optional full re-walk
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
src/nhl/                 Hockey NHL data layer (HOCKEY-PORT.md; `sj nhl`)
scripts/                 Secret Manager, IAM, and infra helpers
fixtures/sj/             Sample snapshots (fallback)
data/sj/                 Local sync output (gitignored)
apps/web/                Next.js hub (+ Dockerfile for Cloud Run)
Dockerfile.sync          Sync job image (Cloud Run Job)
src/ffa/                 NFL analytics engine (later phase)
```
