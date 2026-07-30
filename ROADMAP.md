# Strictly Jayers hub — development game plan

The plan that follows from [AUDIT.md](AUDIT.md) (phases 0–6) and
[AUDIT-COMPETITIVE.md](AUDIT-COMPETITIVE.md) (phases 7–9). Ordered so that each
phase makes the next one cheaper, and structured so independent tracks can run in
parallel.

No calendar estimates — each item is scoped by *what has to change* and *what
could go wrong*, which is the part that actually determines difficulty.

**The strategic goal, restated after phase 6.** The first audit found a hub that
showed members less than ESPN's own site did. Phases 0–6 fixed that: the hub now
ships things no competitor offers free — calibrated floor/median/ceiling per
player, a playoff-odds Monte Carlo, and a decade of league history keyed to
franchises rather than owner names.

The second audit found the next problem, and it is not a data problem. The hub is
an excellent reference library that does nothing when you open it: it cannot tell
you which of the twelve teams is yours, almost nothing on any screen links
anywhere, and no member can say a word to another. Phases 0–2 made the foundation
trustworthy; 3–6 built the surfaces and the sports; **phase 7 is where it becomes
somewhere members go without being asked.**

**Tooling already in place:**

- `sj seed` (see [HUB.md](HUB.md)) fills the local store with realistic-scale
  synthetic snapshots — 25 league-seasons, deterministic, schema-guaranteed. Every
  phase below that touches the UI or the data layer can be developed and tested
  without ESPN credentials.
- In `apps/web`: `npm run typecheck`, `npm test` (vitest), `npm run build`, and
  `npm run verify:prerender`. All pass on `main` and all run in CI on every PR
  (1.1). They report but do not block until branch protection is enabled — see
  1.1 for that last step.

---

## Phase 0 — Stop the bleeding — LANDED

Shipped in #26. Five commits, one per item.

| Measure | Before | After |
|---|---|---|
| `npm audit` high + critical | 14 | **0** |
| Confirmed vulnerabilities | 1 (open redirect) | **0** |
| Authorization layers | 1 (middleware only) | **2** |
| Pages serving build-time fixtures | 2 | **0** |
| Containers running as root | 3 | **0** |
| `apps/web` tests | 0 | **26** |

**0.1 Open redirect** — `safeCallbackUrl` (`apps/web/src/lib/safe-redirect.ts`)
resolves a candidate against a probe origin and compares, rather than
prefix-matching, so it also rejects `/\host` (the URL parser treats a backslash
in a special scheme as a separator, making that an authority). Tab/CR/LF are
stripped *before* validating, since browsers strip them when resolving. Applied
to both `/login` branches, to `signIn()`, and in middleware. Middleware also now
preserves the query string in the `callbackUrl` it builds.

**0.2 Stale prerendering** — `force-dynamic` on all four snapshot-reading pages,
including the two `[param]` ones so a future `generateStaticParams` cannot
silently reintroduce it. Guarded twice, because `next dev` shows no symptom:
a unit test asserting every page importing `@/lib/data` declares it, plus
`npm run verify:prerender` against the build manifest (confirmed to fail on a
tampered manifest, so the check has teeth).

**0.3 Dependencies** — `next` 15.5.22, `next-auth` 5.0.0-beta.32,
`@auth/core` 0.41.3. `postcss`, `sharp`, and `brace-expansion` were transitive
and npm's only offered fix was downgrading `next` to 9.x, so they are pinned
forward with `overrides`. Step 2 (evaluating `next` 16.x) did **not** ship —
carried forward to 1.7.

**0.4 Second authorization layer** — `requireSession`
(`apps/web/src/lib/session.ts`) gates the two cached entry points in
`lib/data.ts`. Those are the only doors to league data, so a new page cannot
expose it by forgetting a guard. Verified by deleting `middleware.ts` entirely
and rebuilding: every route still returned 307 with no data, and with no
`callbackUrl` — the signature of this guard rather than the middleware that was
gone.

**0.5 Containers and credentials** — all three images run as uid 1001
(`sjhub` / `sjsync` / `ffadash`); building them caught that Debian already ships
a system user named `sync`, which would have failed the build.
`DASHBOARD_PASSWORD` moved to Secret Manager via `--set-secrets`. Deployer IAM
narrowed (`artifactregistry.admin` → `writer`, `secretAccessor` → `viewer`, and
the per-secret accessor grants removed), bucket `objectAdmin` → `objectUser`
with `SJ_SYNC_SA` / `SJ_HUB_SA` to split the two accounts.

~~Deferred deliberately: **Workload Identity Federation** → 1.3~~ — landed in 1.3.

---

## Phase 1 — Make regressions impossible to merge

Phase 0 fixes today's bugs; this phase is why tomorrow's don't ship. Do it before
the UI work in phase 3, because that work is large and will need a safety net.

### 1.1 Web CI — LANDED
Shipped in #28. `.github/workflows/tests.yml` now runs three parallel jobs:

| Job | Duration | Covers |
|---|---|---|
| `python` | ~63s | `ruff`, `pytest` (unchanged) |
| `web` | ~61s | `npm ci`, typecheck, lint, 26 vitest cases, build, `verify:prerender`, `npm audit` |
| `images` | ~88s | hub + sync image builds, plus an assertion that neither runs as root |

Total wall clock ~88s, which removed the argument for path filters — always
running avoids a required check that never reports on an unrelated PR.

The `images` job is the non-obvious one and it earns its time: Phase 0's
non-root work was invisible to review, and the `useradd sync` collision with a
Debian system account failed the build outright. Building is the only check that
catches that. The ffa dashboard image stays excluded — `ffa ingest` at build
time needs network access to nflverse for a ~1 GB image, too slow and flaky for
a PR gate.

`npm audit --audit-level=high` blocks, so the 14 → 0 advisory work from #26
cannot drift back silently. It can fail on an advisory published against an
untouched dependency; the escape hatch is 1.5 (Dependabot) plus moving it to a
scheduled run.

**Branch protection on `main` is enabled.** Required checks: `python`, `web`,
`images`. A red run can no longer merge — phase 1.1's premise holds.

### 1.2 Test harness for the frontend — LANDED
Vitest remains the unit gate (`npm test`): lib logic + source-shape invariants,
plus React Testing Library coverage for the interactive `DataTable` client
component (`DataTable.test.tsx`, jsdom).

Playwright smoke lives in `apps/web/e2e/` and runs against the standalone
server + committed `fixtures/sj` (`SJ_DATA_DIR` forced in
`playwright.config.ts`):

- `npm run test:e2e` — leagues list, standings, team roster, 404s, login bypass
  redirect (`AUTH_DEV_BYPASS=1`), plus projections + tools smoke (playoff-odds,
  draft slot, waivers, start-sit)
- `npm run test:e2e:auth` — unauthenticated `/leagues` → `/login?callbackUrl=…`

CI job `web-e2e` (Chromium only) runs both after `npm run build`. Not a
required branch-protection check yet — enable once it has stayed green on
`main`.

### 1.3 Continuous deployment — LANDED
`deploy-hub.yml` runs on push to `main` (path-filtered; branch protection is the
CI gate) and keeps `workflow_dispatch` for rollback. `AUTH_URL` is resolved up
front (existing service URL, else regional `run.app` form) so deploy is one
`gcloud run deploy`, with a reconcile update only if Cloud Run returns a
different `status.url`. All three deploy workflows
(`deploy-hub` / `deploy-sync-job` / `deploy`) authenticate via Workload Identity
Federation (`github` pool/provider → `ffa-deployer`); JSON key `GCP_SA_KEY` is
retired.

### 1.4 Close the `sync.py` coverage hole — LANDED
Shipped failure-path tests (no live ESPN calls) covering missing credentials,
`ESPNAccessDenied` vs `ESPNInvalidLeague` vs network error, partial-season
failure, throttle, and sport dispatch. Failures are classified into stable
kinds (`credentials` / `access_denied` / `invalid_league` / `network` /
`unknown`).

Loud exits: `sj sync` exits `1` on any skipped season so Cloud Scheduler sees
the failure; `sj backfill` still tolerates `invalid_league`-only gaps (seasons
ESPN no longer serves) but fails loud on everything else. Both commands emit a
`SYNC_SUMMARY {...}` JSON line for 1.6 alerting.

Coverage: `src/sj/sync.py` 38% → **100%**, `src/sj/` package **94%**, full
`src/` 71% → **74%** (still dragged by untested `ffa.cli` / `ffa.dashboard`).

### 1.5 Align environments — LANDED
CI now runs the Python job on **3.11 and 3.12** (matrix), with an aggregator
job that keeps the required check name `python` for branch protection. 3.12
matches the hub/sync containers; 3.11 keeps the floor.

`requirements-lock.txt` is the shared pin set (compiled from
`pyproject.toml` with the `dev`, `dashboard`, and `gcs` extras via `uv pip
compile --python-version 3.11` so the same pins install on the 3.11 + 3.12
matrix). CI installs from it; the three Dockerfiles pass it as
`--constraint` so production resolves the same transitive versions without
pulling every optional extra into every image.

`.github/dependabot.yml` watches npm (`apps/web`), pip (repo root), and
GitHub Actions on a weekly cadence. After a Dependabot bump to
`pyproject.toml`, regenerate the lockfile with the command in its header.

### 1.6 Baseline observability — LANDED
Public `GET /api/health` (middleware allowlisted, session-free) reports
per-league `synced_at` age for the latest season of each league. HTTP 200 when
fresh, 503 when empty or past `SJ_HEALTH_STALE_SECONDS` (default 2h). Route-level
`error.tsx` / `not-found.tsx` log to stderr for Cloud Logging / Error Reporting.

`scripts/setup-sync-alerting.sh` creates a Cloud Monitoring email alert on
`sj-sync` Cloud Run Job non-success — the loud exit from 1.4 is what makes that
alert trustworthy. Optional uptime check on `/api/health` is documented in
HUB.md (console click; needs the live hub URL).

### 1.7 Next.js 16 and the ESLint CLI — LANDED
`apps/web` is on `next` / `eslint-config-next` 16.2.x. Lint is the ESLint CLI
(`eslint .`) via the codemod flat config (`eslint-config-next/core-web-vitals` +
`typescript`). `next-auth@5.0.0-beta.32` already peers `^16`.

Compatibility notes kept in-tree:
- `revalidateTag(tag, "max")` on `/api/revalidate` (Next 16 cacheLife profile).
- Keep `src/middleware.ts` (Auth.js Edge). Do **not** rename to `proxy.ts` —
  proxy is Node-only; Next prints a deprecation warning until Auth.js moves.
- `verify:prerender` allowlists `/_global-error` (new Next 16 shell).
- `verify:bundle-budget` reads Turbopack per-route manifests when
  `app-build-manifest.json` is absent (Turbopack is the default `next build`).
- Overrides revisited: `next` still pins `postcss` 8.4.31 / `sharp` ^0.34.5;
  advisory-clean `brace-expansion@5` needs `minimatch@^10` alongside it.

---

## Phase 2 — Make the data layer worth building a product on

Everything in phase 3 and 4 is gated on data the sync doesn't currently keep.
This is the highest-leverage phase in the plan, and it starts with free wins.

### 2.1 Persist what is already being fetched — LANDED
`serialize_league` now writes top-level `draft` (from `league.draft` /
`mDraftDetail`) and each team carries parallel `schedule` / `scores` /
`outcomes` arrays. Football exposes those lists directly from espn-api;
baseball `Matchup` objects are normalized into the same shape (category live
scores preferred when present). Still **no additional ESPN requests**.

`sj seed` fabricates draft boards and weekly matchup arrays so local snapshots
stay schema-complete. Unlocks draft-results pages, matchup history, and weekly
scores in phase 3 without waiting on 2.4.

### 2.2 Split the snapshot schema — LANDED
Writers still build one in-memory monolith; the store persists it as per-concern
files under `{league}/{season}/` with a `manifest.json` written last:

```
standings.json  rosters.json  matchups.json  draft.json  settings.json  transactions.json
```

`schema_version: 2` on the manifest. Legacy `{league}/{season}.json` monoliths
(`schema_version` 1 — committed fixtures) stay readable; writers emit only v2
and delete a leftover monolith for that season. `settings.json` / populated
`transactions.json` arrived in 2.4; assemble treats both as optional so older
v2 seasons still load.

Python `read_snapshot` reassembles the monolith. The web dual-reads manifest or
monolith; `getTeam` on v2 loads standings + one roster only (AUDIT #16). Index
entries point at the manifest path.

### 2.3 Fix the index rewrite — LANDED
Writes upsert one `(league_id, season)` row into `index.json` from the manifest
just written — no rescan of the store, no re-download of every season on GCS.
A missing or corrupt index still falls back to a full rebuild from manifests +
legacy monoliths so recovery stays one command away. Required before weekly
snapshots multiply the file count.

### 2.4 Extend the sync — LANDED
Shipped the high-leverage slice without ballooning snapshot size:

- **Settings** from the already-loaded `league.settings` (`mSettings`) →
  `settings.json` (roster slots, FAAB, keeper counts, scoring format). No extra
  ESPN request; this is what makes `format: dynasty` mean something on disk.
- **Transactions / trades** via paged `recent_activity` (both sports; empty
  before 2019) → `transactions.json` (fills the 2.2 stub).
- **Free agents / waivers** via `league.free_agents` (both sports; empty before
  2019; size-capped, default 50, `SJ_FREE_AGENT_SIZE` up to 150) →
  `free_agents.json`. Hub Waivers tab prefers this list (joined to season
  projections through the player map) and falls back to unrostered projections
  when the season has no FA file.
- **Retry / backoff / timeouts** around ESPN HTTP (`SJ_ESPN_TIMEOUT`,
  `SJ_ESPN_MAX_ATTEMPTS`). espn-api has neither; `--throttle` only spaces
  league-seasons.

Deferred (size / API gaps): box scores, per-week player stats, playoff
brackets — pull those when a page needs them.

### 2.5 Backfill and validate — LANDED
Committed `fixtures/sj/` are regenerated from the live serializer via
`sj regenerate-fixtures` (schema_version 1 monoliths, current season × 3
leagues, small team counts). `sj validate-fixtures` — and a pytest gate —
fail the build if they drift. Football fixtures bumped to 2026 to match the
registry.

Live ESPN backfill of all 24 league-seasons remains an ops step
(`sj backfill` / Cloud Run job) when credentials are available; the CLI and
failure taxonomy for that landed in 1.4.

---

## Phase 3 — Rebuild the UI into an actual hub

Where members notice the difference. 3.1 comes first because it stops the cost
of every later item from doubling.

### 3.1 Unify the league views — LANDED
One sport-aware `LeagueView` owns standings / teams / players for every league.
The football inline branch in `leagues/[leagueId]/page.tsx` is gone; the page
only loads data and renders `<LeagueView />`. Football inherits season chips,
Win%, injury dots, and `.table-scroll`. Standings keep sport-specific columns
(football PF/PA; baseball optional Points). Baseball keeps the batter/pitcher
role switcher and counting-stat columns. Shared helpers live in `lib/league.ts`;
`BaseballRosterView` stays on the team page until a later roster unify.

### 3.2 Season navigation everywhere — LANDED
Shared `SeasonSwitcher` on league pages (via `LeagueView`) and both team-page
branches. Team pages load `getLeagueSeasons` and keep `?season=` on chips and
the back-link to the league. This surfaces the full history already on disk
(12 seasons of `football-main`, 9 of `football-dynasty`) that AUDIT #6 found
unreachable from the UI.

### 3.3 A real data table — LANDED
Reusable client `DataTable` (no new deps) with search, sortable headers,
position filter chips, and pagination (25/page). The players tab wires it
through `PlayersDataTable` while `LeagueView` stays a server component — only
the current page of rows renders in HTML. Baseball URL `RoleSwitcher` still
owns batter/pitcher role; the table adds search/position/sort/page on top.
Standings/teams/roster tables left alone for later reuse.

### 3.4 Matchups, scores, and playoffs — LANDED
`LeagueView` gains a **matchups** tab with three sub-views on existing
`schedule` / `scores` / `outcomes` arrays (no new ESPN pulls):

- **This week** — period chips (`?week=`) defaulting to `current_week`, paired
  matchup cards with scores and W/L/T pills, bye callouts
- **Schedule** — every period in the snapshot
- **Playoffs** — seed table from `playoff_team_count` + standings; real post-
  `reg_season_count` periods when present; otherwise a projected 1-vs-N first
  round (no scores)

Box scores remain deferred (not in the snapshot — see 2.4). Helpers live in
`lib/matchups.ts`; `MatchupsPanel` keeps `LeagueView` a server component.

### 3.5 History and records — LANDED
`LeagueView` **history** tab aggregates every season on disk (standings +
matchups only — no roster haul) via `getLeagueHistoryArchive`:

- **All-time** — franchise standings keyed by `team_id` (W/L/T, win%, PF/PA, #1s)
- **Champions** — regular-season #1 finish by year
- **Records** — best season wins/PF, highest/lowest weekly score, most #1s
- **Head-to-head** — pick two franchises (`?a=` / `?b=`), series record + game log

Helpers in `lib/history.ts`; `HistoryPanel` stays a server component. Deferred:
dedicated franchise/manager pages, draft hit/bust retrospectives (need career
outcomes beyond draft picks), playoff-champion labeling (not in snapshot).

### 3.6 States and polish — LANDED
Route `loading.tsx` skeletons (root + leagues + league detail), branded
`error.tsx` / `not-found.tsx` (`state-panel` + brand mark), and shared
`EmptyState` on leagues / standings / teams / rosters. `readJson` caches ENOENT
as `null` but **throws** `CorruptSnapshotError` on bad JSON (not cached as
missing). create-next-app SVGs removed; `robots.ts`, `manifest.ts`, and
`opengraph-image.tsx` added with layout Open Graph metadata. Wide tables use
`.table-cards` + `data-label` for mobile stacked cards.

---

## Phase 4 — Connect the engine

This is the "another level" step. 4,712 lines of calibrated projection modeling
currently reach members through a separate password-gated Streamlit app; the hub
never calls it. Sequenced after phase 2 because it needs the richer data, and
after phase 3 because it needs somewhere to render.

### 4.1 Finish the engine's own open item — LANDED
`--conditioned-level` on `simulate` / `rank` / `optimize` / `draft-sim` /
`backtest` builds a per-player `LevelModel` table (tier + rosters `years_exp` +
collapse) via `build_player_level` / `years_exp_from_rosters` and passes it as
`player_level`. Global `--level-sd` / `--level-mean` remain the fallback for
players missing from that table. This is the calibrated phase-18 path
(central coverage 0.80) usable at draft time, not just in the Python API.

### 4.2 Give the engine a consumable interface — LANDED
`ffa export-projections` runs the same simulation summary as `rank`, attaches
VOR + tiers, and writes hub-consumable snapshots to
`{out_dir}/{scoring}/{season}.json` (optional Parquet sibling). Defaults to
`--conditioned-level` (calibrated path). Schema aliases `floor`/`median`/
`ceiling` ← `q05`/`q50`/`q95`. Hub reader: `getProjectionSnapshot(scoring,
season)` under `data/sj/projections/` (fixtures committed for offline). Nightly
`.github/workflows/refresh.yml` exports PPR + standard into `store/projections/`
artifacts. UI surfaces deferred to 4.4; ESPN ID join is 4.3.

### 4.3 Map ESPN players to engine players — LANDED
`ffa export-player-map` builds an ESPN↔nflverse (GSIS) crosswalk from ingested
`rosters.parquet` (`espn_id`↔`gsis_id`), optionally filling gaps via DynastyProcess
`load_ff_playerids()`. Writes `{out_dir}/{season}.json` with embeddings for
`coverage` (unique football hub roster ESPN ids resolved / rostered + miss list)
and engine-side `skill_*` stats. Hub reader: `getPlayerMap(season)` under
`data/sj/player_map/` (fixtures committed). Nightly `refresh.yml` uploads
`store/player_map/` alongside projections. No silent name matching — misses are
explicit. Projection UI join is 4.4.

### 4.4 Projections in the hub — LANDED
Football `projections` tab ranks engine season posteriors (floor / median /
ceiling / VOR / tier) via `ProjectionsBoard`. Roster and players tables join
ESPN `Player.id` → GSIS through `getPlayerMap` + `lib/projection-join.ts`, then
show Floor / Med / Ceil (and VOR on the players board). Scoring slug from league
reception points (`ppr` / `standard`); season file falls back to `league.season - 1`
when the hub calendar leads the NFL year. **Weekly start/sit** uses a separate
typical-week export (see 4.5) — season boards stay season-only by design.
Baseball stays projection-free by design (roadmap 4.6 — landed).

### 4.5 Decision tools — LANDED
Football `tools` tab ships snapshot-backed decision surfaces without calling
`ffa` at request time:

- **Trade** — pick two rosters, check players to offer, see before/after Σ
  floor / median / ceiling / VOR (independent quantile sums; no joint samples
  in store).
- **Waivers** — ESPN `free_agents` when synced (2.4 leftover); else unrostered
  projection rows by VOR as fallback.
- **Strength** — per-team season projection totals via the player map.
- **Draft** — offline Monte Carlo snake-draft assistant from
  `ffa export-draft-sim` → `draft_sim/{scoring}/{season}/slot_{N}.json`
  (pick rates + availability). Hub switches slot via `?view=draft&slot=N`.
  Nightly refresh exports all slots for PPR + standard.
- **Start/Sit** — typical-week player posteriors from
  `ffa export-weekly-projections` →
  `weekly_projections/{scoring}/{season}.json` (`grain: typical_week`).
  Hub: `getWeeklyProjectionSnapshot` + `StartSitBoard`
  (`?view=start-sit`). Same bootstrap atom as season sims, but one game per
  sample — **not** schedule-/opponent-adjusted.
- **Playoff odds** — offline make-playoffs MC from
  `ffa export-playoff-odds` → `playoff_odds/{league_id}/{season}.json`.
  Walks remaining regular-season H2H games with independent typical-week
  draws + greedy skill lineups (K/DST omitted, fixed rosters). Hub:
  `getPlayoffOddsSnapshot` + `PlayoffOddsBoard` (`?view=playoff-odds`).
  Bracket-champion odds stay out of scope unless playoff periods exist in
  the snapshot.

Season / weekly **quantile** boards must not be dressed as playoff
probabilities — only the playoff-odds artifact.

### 4.6 Baseball — LANDED
**Decision: keep baseball data-rich but projection-free.** The `ffa` engine
(ingest, scoring, simulation, projection export, ESPN↔GSIS map) is NFL-shaped;
there is no MLB path in `src/ffa`. `baseball-dynasty` already has the strongest
ESPN hub UI (batter/pitcher boards, role switcher, matchups, history). Closing
4.6 as a deliberate product boundary — not a missing feature stub.

Hub UX: baseball exposes `projections` and `tools` tabs that explain the scope
(EmptyStates), and the league lede says “projection-free by design.” Football
keeps the engine surfaces from 4.1–4.5. Revisit only with a real MLB ingest +
calibration plan — do not half-port football projections onto category leagues.

---

## Phase 5 — Scale and operate

Fold in continuously rather than saving for the end.

- **Container slimming.** ~~Drop the Python analytics stack from the hub image
  (finding #17); non-root, multi-stage, stop copying fixtures twice.~~ —
  **LANDED (hub):** runtime installs sj-only deps (no duckdb/sklearn/nflreadpy);
  fixtures copied once; non-root + multi-stage were already in. Sync image was
  already slim.
- **Caching.** ~~The 60 s in-process Map~~ → **LANDED:** Next.js Data Cache
  (`unstable_cache` on snapshot `readJson`, tag `sj-snapshots`, TTL still from
  `SJ_CACHE_TTL_MS`). Explicit purge via `POST /api/revalidate` (Bearer
  `SJ_REVALIDATE_SECRET`); `sj sync` / `backfill` best-effort POST when
  `SJ_REVALIDATE_URL` + secret are set. Still per Cloud Run instance (no Redis)
  — TTL remains the multi-instance bound.
- **Cold starts.** ~~Set `min-instances` if members complain~~ → **LANDED:**
  deploy-hub sets `--cpu-boost`, `--max-instances=5`, and `--min-instances`
  (default `0`; workflow_dispatch override to `1` when members want always-warm).
  `setup-sync-alerting.sh` creates an HTTPS uptime check on `/api/health`.
- **Storage.** If weekly and projection data outgrow JSON-on-GCS, the pattern is
  already established elsewhere in the repo: Parquet plus DuckDB, as `src/ffa`
  does.
- **Member admin / email↔team ACL.** Hub `/admin` + `{SJ_HUB_DIR}/hub_members.json`
  (add Google emails, roles, link one franchise per league from snapshots).
  Sign-in allowlist = `ALLOWED_EMAILS` ∪ members file. Golf auction/lineup
  mutations enforce the link (admins + `AUTH_DEV_BYPASS` may act as any team;
  finalize is admin-only).
- **Hub-native store isolation.** Golf / members / auction rooms write under
  `SJ_HUB_DIR`. Prod shares the ESPN GCS bucket RW at `/app/data/sj` (dual FUSE
  failed Cloud Run PORT probes); sync skips `platform: hub` and refuses
  `sport=golf` overwrite. Local default is still a sibling `data/hub`.
- **Live ESPN vs fixtures.** Committed `fixtures/sj` and accidental `data/sj`
  copies are dummy team names. Restore with `source .env.espn && rm -rf data/sj
  && sj sync --current-only` (+ `sj backfill` for history) and mount the GCS
  bucket on the hub. Not a code change — ops + cookies.
- **`refresh.yml`.** Wired as the 4.2/4.3 projection + player-map producer.
  ~~Year-round cron~~ → **NFL-season cron (Sept–Jan, Tue–Sat)**. ~~Still needs a
  promote step~~ → **LANDED:** `promote` job (WIF) copies JSON into
  `gs://…-sj-data/projections|player_map|draft_sim|weekly_projections|playoff_odds/`.
  Requires `ffa-deployer`
  `objectUser` on the bucket (`setup-github-deployer.sh`). Hub must mount the
  bucket (deploy-hub `bucket` input) to serve promoted files.
- **Accessibility and performance budgets.** ~~once phase 3 lands~~ → **LANDED:**
  jsx-a11y via `next/core-web-vitals` lint (existing) + post-build
  `npm run verify:bundle-budget` in the `web` CI job.

---

## Phase 6 — Fantasy golf (PGA Tour) — MVP + hub surfaces LANDED

Private fantasy golf in the **same Strictly Jayers hub** as football/baseball
(Auth.js allowlist, season chips, sport-aware `LeagueView`). Model is the
**LIV Golf real-team counting score**, not official LIV Fantasy (4 + sub +
LIV team). Tour scope: **PGA Tour / FedExCup only**. Engine work lives in a
new package (working name `src/sg` / CLI `sg`) — do **not** extend `src/ffa`
(NFL analytics) for golf.

### 6.0 Product model (locked)

| Area | Decision |
|---|---|
| Placement | Hub sport alongside football + baseball (not a separate app) |
| Tour / pool | PGA Tour events; draft pool = **all OWGR** players |
| League size | Manager-configured **6–14** teams |
| Season format | Manager choice: **H2H** *or* **season cumulative points** |
| Draft | Once per year; **snake** or **auction** (offline sim); keepers optional |
| Cap | Auction draft establishes acquisition cost; **no weekly salary** |
| Roster | **5 starters** + bench (**2–20**, manager-configured; default TBD ~8–10) |
| Captain | Selected each week; **tiebreaker only** (not a points multiplier) |
| Lineup locks | Per player, before **that player's** round tee time |
| Counting | Thu/Fri: best **4 of 5** starter rounds; Sat/Sun: **all 5** |
| Player score | Round **to-par**; fantasy points = **−(to-par)** (under-par positive) |
| Missed cut / WD | League setting: **off / alt1 / alt1+2** — alts fill **weekend only** |
| Schedule | Full FedExCup slate; manager may curate which events count |
| Multipliers | Per-event on the **week total** (e.g. regular 1×, signature 1.5×, major 2×) |
| Scoring cadence | **End-of-day** (not live in-round) |
| Playoff holes | Out of MVP; handle edge cases as exceptions |

**Alternates (option C):** when enabled, owner names Alt1 (and optionally Alt2)
from the bench. If a starter misses the cut (or WD before the weekend), Alt1
then Alt2 supply Sat/Sun rounds for counting. Thursday/Friday still use the
original five starters (best 4 of 5). When alts are **off**, a MC starter
simply contributes nothing on the weekend.

### 6.1 League settings schema (sketch)

Persisted with the league (hub settings / golf-specific JSON — exact file
layout lands with 6.2). Illustrative shape:

```yaml
# golf league settings (conceptual)
sport: golf
team_count: 10                    # 6–14
format: h2h                       # h2h | season_points
draft:
  style: snake                    # snake | auction
  keepers: false
roster:
  starters: 5                     # fixed for MVP
  bench: 10                       # 2–20
captain_tiebreaker: true
missed_cut:
  mode: alt1                      # off | alt1 | alt1_2
schedule:
  source: fedex_cup               # curated from official slate
  include: []                     # optional allow-list of event ids
  exclude: []                     # optional deny-list
multipliers:
  regular: 1.0
  signature: 1.5
  major: 2.0
scoring:
  grain: end_of_day
  player_points: neg_to_par       # points = -(strokes - par)
  thu_fri_count: 4
  sat_sun_count: 5
```

Hub create-league UI exposes these knobs; defaults should make a playable
league without every toggle.

### 6.2 Data plane (`sg` — not `ffa`)

New offline pipeline, same hub pattern as `sj` / projection exports:

1. **Ingest** — OWGR universe + PGA Tour schedule/field/round scores (source
   TBD: official / licensed feed preferred over brittle scrape).
2. **Normalize** — per-player per-round `{event_id, round, to_par, status}`
   with statuses for DNS / WD / MC / active.
3. **Export** — JSON (or Parquet later) under a golf store root the hub reads
   session-gated, e.g. `golf/{league_id}/{season}/…` or shared
   `golf/events/{season}/{event_id}.json`.
4. **Score week** — pure function of lineups + round file + league settings
   (counting + alts + multiplier). Hub never calls live tour APIs at request
   time; EOD job writes artifacts, hub displays them.

Fixtures/seeds for offline UI tests (same role as `sj seed` / `fixtures/sj`).

### 6.3 Week scoring algorithm (normative)

For one team in one counting event:

1. Resolve the owner's **locked lineup** (5 starters, captain, Alt1/Alt2).
2. For each calendar round R ∈ {Thu, Fri, Sat, Sun} that the event plays:
   - Build the five **active** starter scores for R (to-par → points).
   - If R is weekend and `missed_cut.mode ≠ off`, replace MC/WD starters
     with Alt1 then Alt2 for that round only.
   - **Thu/Fri:** team round points = sum of the best `thu_fri_count` (4)
     active scores.
   - **Sat/Sun:** team round points = sum of all `sat_sun_count` (5) active
     scores (missing round → 0 for that slot).
3. `week_raw = Σ team round points`.
4. `week_total = week_raw × event_multiplier`.
5. **H2H:** compare `week_total`; tie → higher captain `week` points
   (sum of captain's counting rounds that week); still tied → draw.
6. **Season points:** add `week_total` into season standings (H2H leagues
   track W–L–T instead or in addition — exact standings columns in 6.5).

Opposite-field / short-field events follow the curated schedule; odd formats
are per-event exceptions, not general playoff-hole logic.

### 6.4 MVP slices (build order)

| Slice | Delivers | Notes |
|---|---|---|
| **6.4a** League create + settings | ~~Golf league in registry/hub; format, roster size, MC mode, multipliers~~ | **LANDED:** `golf-main` registry + fixtures, `src/sg` settings/snapshot/`sg create-league`, hub `/leagues/new` + Settings tab. No live tour data. |
| **6.4b** Snake draft + roster | ~~One draft/year; 5 + bench; OWGR pool fixture~~ | **LANDED:** synthetic OWGR pool (`sg.pool` / hub `golf-draft`), snake runner, fixtures + create auto-draft, `DraftResultsPanel` + `GolfRosterView`. |
| **6.4b+** Auction + keepers | ~~Offline auction + keeper clauses~~ | **LANDED:** `run_auction_draft` / hub mirror; `budget` + `keeper_slots`; Draft tab budget board + Bid/Keeper/Nominator columns. |
| **6.4b++** Live nomination room | ~~Multiplayer nominate/bid/pass~~ | **LANDED:** file-backed `auction_room.json` + polling UI (`AuctionRoomPanel`); start/nominate/bid/pass/finalize APIs; create “Live nomination room” skips offline draft. |
| **6.4c** Weekly lineup | ~~Set starters / captain / alts; tee-time locks~~ | **LANDED:** fixture FedEx events + tee times, `lineups` concern, hub Lineup tab + `POST …/lineups`, fail-closed locks. |
| **6.4d** EOD scorer + board | ~~Counting scoreboard for the event week~~ | **LANDED:** fixture round cards + `sg.score` (best 4/5, weekend alts, multiplier, captain TB), `scoreboard` concern, hub Scoreboard tab. |
| **6.4e** Standings | ~~H2H record *or* season points per settings~~ | **LANDED:** derive W–L–T / PF from `scoreboard` at snapshot build (`sg.standings` + hub mirror); Standings tab shows record+PF (h2h) or points (season_points). |

Out of MVP: live hole-by-hole, LIV tour, DFS salary, public/open leagues,
playoff-hole scoring, websocket push, in-round swap after tee.

### 6.5 Hub surfaces — LANDED

Extend sport-aware `LeagueView` (do not fork a golf-only page tree):

- ~~Standings / Teams / roster (golf slots: starters, bench, alts)~~ — GS/BE
  sections + current-event Alt1/Alt2 on team pages; Teams list GS/BE pills
- ~~Schedule (curated FedEx events + multipliers)~~ — `GolfSchedulePanel` with
  resolved × from settings + Lineup/Scoreboard links
- ~~Lineup (week-scoped)~~ — from 6.4c
- ~~Scoreboard (daily counting + week total)~~ — expandable per-player round
  slots; `?event=` deep-links work for scoreboard
- ~~Draft results (ESPN-style board pattern)~~ — shared `DraftResultsPanel`
- ~~History when multi-season golf snapshots exist~~ — scoreboard pairings
  project into team `schedule`/`scores`/`outcomes` for Records/H2H; single
  fixture season ships today, multi-year grows under the same league id

Baseball stays projection-free; football keeps `ffa`. Golf is a **third sport
lane** with its own sync/score package.

### 6.6 Risks

- **Data rights / feed quality** — largest external dependency; fixtures unblock
  UI, production needs a durable PGAT+OWGR source.
- **Tee-time locks** — per-player lock times are timezone- and wave-sensitive;
  store tee times in UTC and fail closed (late change rejected).
- **MC + alt edge cases** — Friday WD vs Saturday DNS vs 36-hole cut; encode
  explicit status rules in the scorer tests.
- **Scope creep** — live scoring, LIV, and websocket push stay out of the
  file-backed polling auction room.

---

## Phase 7 — Make it a place members open without being asked

Follows from [AUDIT-COMPETITIVE.md](AUDIT-COMPETITIVE.md), which measured the hub
against ESPN, Yahoo, Sleeper, and FantasyPros. That audit's finding: phases 0–6
built a very good reference library. Opening it does nothing.

**Nine of its thirteen findings are blocked on nothing** — they are ordering,
emphasis, naming, and display over data already synced and already modelled. So
this phase is mostly `apps/web`, and it front-loads the cheap items because they
are also the ones members feel first.

The organizing principle: **every screen should answer "what about me?" before
it answers "what about the league?"**

### 7.1 Identity — teach the hub which team is yours

The prerequisite for most of this phase. `hub_members.json` already links member
email → one franchise per league, and `/admin` already edits it; today only golf
reads it (`lib/franchise-acl.ts`).

- New server helper (`lib/viewer.ts`) resolving `session → member → { leagueId:
  teamId }` for **all** sports, cached per request like `getLeagueIndex`.
- `LeagueView` and every panel take an optional `viewerTeamId`.
- Standings: highlight the viewer's row (`.is-viewer`), keep sort order intact.
- Matchups: viewer's card first and visually promoted; "your matchup" label.
- Teams list, trade/start-sit/draft pickers, H2H pickers: default to the viewer.
- Team pages: "your team" affordance instead of an anonymous roster.

Risks: `AUTH_DEV_BYPASS` and admins have no single franchise — the helper must
return `null` cleanly and every consumer must render the current
non-personalized layout unchanged. Members with no link must not see a broken
page; prompt them toward `/admin` instead. This is also the guard that keeps
7.2 honest.

### 7.2 A member home worth landing on

Replace the marketing hero on `/` (it sells a product the visitor already
signed into) with a member dashboard built from data on disk:

- Per league: your record, your rank, your current-period matchup with live-ish
  scores, next deadline.
- Football: your playoff odds delta since last week (the snapshot already has
  `make_playoffs` per team).
- Golf: your current event, whether your lineup is set, when your first tee
  time locks.
- A recent-activity strip across leagues (feeds 7.6 once it exists).
- ESPN's **day-of-week action items** pattern is the cheap version of
  intelligence: "waivers process tonight", "you have an unset golf lineup",
  "3 of your starters are questionable". All derivable, no model needed.

`/leagues` gets the same treatment at index level: record, rank, and last-synced
per card instead of `sport · format · season · team_count`.

Keep the hero for signed-out/unlinked visitors so there is still a front door.

### 7.3 Kill the dead ends

Nothing in the app is clickable except team names (AUDIT-COMPETITIVE #3).

- **Player pages** — `/leagues/{id}/players/{playerId}`: season line, roster
  status and fantasy owner, injury, floor/median/ceiling + tier + VOR, weekly
  posterior, draft slot they went at, and their transaction history in this
  league. All of it is already keyed by player id across `rosters.json`,
  `draft.json`, `transactions.json`, and the projection/weekly snapshots. Every
  player name in every table links here.
- **Manager / franchise pages** — `/leagues/{id}/franchises/{teamId}`: career
  record, seasons, titles, best/worst weeks, H2H splits, draft history. Pure
  `getLeagueHistoryArchive` aggregation; owner names become links.
- **Team logos** — `Team.logo_url` is synced and rendered nowhere. Add an
  avatar component with a monogram fallback and use it in standings, matchup
  cards, teams list, and team headers.
- **"Open in ESPN" deep links** — `espn_league_id` is on every snapshot. The hub
  has no write path to ESPN and should not pretend otherwise, so send members to
  the page that *can* act: roster, transaction, player, matchup. Turning a dead
  end into an outbound link is the honest version of a commissioner tool.

Box scores and play-by-play stay out — they need the weekly player stats
deferred in 2.4 (see 8.1).

### 7.4 Put the season back on the team page

`loadTeamSelective()` builds v2 team pages without reading `matchups.json` and
sets `schedule` / `scores` / `outcomes` to `[]` (a 2.2 cost optimization). The
result: team pages show a roster and no results at all — no game log, no weekly
scores, no next opponent, which is the one thing a team page is for on every
competing product.

Read `matchups.json` on the team path and render a game log + weekly score
sparkline + next opponent. Measure the cost; if it matters, load matchups lazily
in a sibling component rather than reintroducing a full monolith read. Add a
regression test asserting a v2 team page exposes non-empty `scores`, because the
symptom is silent.

### 7.5 Navigation and information architecture

Measured today: 21–28 identical pills per screen, and **more than one full
mobile screen** of chrome before the first data row on the players tabs.

- Collapse the 12 season chips into a `SeasonSwitcher` that shows 3–4 recent
  years plus a select/overflow for the rest.
- Group the 9–10 tabs (e.g. *League* · *Play* · *Research*) or move secondary
  tabs into an overflow; write real labels instead of route slugs.
- Sticky compact league header on scroll: league, season, period, your record.
- Global league + team switcher in the header (Yahoo makes this reachable from
  every screen); the hub currently routes back through `/leagues`.
- Mobile bottom tab bar for the 3–4 real destinations. This is a phone-first
  audience on a desktop layout that reflows.
- Sticky table headers.

Do **not** regress the `.table-cards` mobile treatment — measured horizontal
overflow is 0 px at 390 px on every route today, including the 16-column
baseball board. That is a genuine strength.

### 7.6 A league feed — the social layer

The largest single gap against Sleeper, and the one that decides whether a
friend league uses the hub or its Discord. Sleeper credits chat as the reason
its leagues are the most active, and reports trade volume **tripling** after it
relaxed roster validation.

Scope deliberately, in order:

1. **System event stream** — one chronological feed per league, generated from
   data already synced: transactions, waiver claims, trades, draft picks, weekly
   results, golf auction lots, scoring finalizations. This replaces the
   four-row `activity` table and needs no new writes.
2. **Member comments + reactions** on any feed item. New writable concern
   (`{SJ_HUB_DIR}/{leagueId}/feed.json` or per-period shards) following the
   `auction_room.json` pattern — file-backed, uncached, optimistic-concurrency
   `revision`, HTTP polling. No websockets, no Redis.
3. **Polls** (ESPN's LM Polls / Sleeper's chat polls) — the coordination tool a
   friend league actually uses, for draft times and rule votes.

Risks: this is the first user-generated content in the repo, so it needs input
validation, length caps, per-member rate limiting, an admin delete path, and
ACL via `lib/franchise-acl.ts`. Ordering by `synced_at` across ESPN and hub
sources will need care. Do not start here before 7.1 — a feed with no identity
is a wall of text.

### 7.7 Weekly digest and an outbound channel

Findings 1, 2, and 12 roll up into one: **the hub has no way to reach a member
who is not already looking at it.** Every competitor manufactures a recurring
appointment.

- **Recap generator** (`src/sj` or a new `src/sjr`): per league-period, from
  standings + matchups + transactions. Highest score, biggest blowout, closest
  game, best/worst start-sit call, luckiest win (win with the week's lowest
  winning score), transaction of the week, current power rankings.
- **Power rankings** — nobody in the comparison ships them free (Yahoo gates
  them behind Plus). All-play win %, PF adjusted for schedule strength, and
  roster projection strength are all computable from the snapshot.
- **Awards** — Sleeper's Weekly Report pattern. Cheap, and it is the thing that
  gets disengaged managers reading.
- **Recap surface first, transport second**: render digests in the hub (and post
  them into 7.6's feed) before wiring email. Then one transport — a Discord
  webhook is the highest-value target for this specific group, with email as the
  fallback. Golf **tee-time lineup reminders** are the highest-value single
  notification: golf locks fail-closed with no prior warning, and the Tour
  removed its own opening-round deadline in 2026 precisely because missed
  lineups are the main churn cause.

Risks: any transport means secrets, retries, unsubscribe handling, and a
scheduled job that must not double-send. Keep generation pure and idempotent
(keyed by league-season-period) so delivery can be retried safely.

### 7.8 Package the decision tools

The tools are better modelled than every free competitor's and worse packaged
than all of them. FantasyPros' equivalents each have a proper noun, a one-line
promise, and a roster-aware default; the hub's are `?view=` values.

- Name them, give each a one-line promise and a landing card on the tools tab.
- Default every tool to the viewer's roster (needs 7.1).
- **State a verdict.** Trade currently shows two Σ columns and leaves the
  subtraction to the member. Say which side gains and by how much, with the
  uncertainty the posterior already provides.
- **Price decisions in Δ playoff odds.** Yahoo's Assistant GM frames advice as
  "+2.4 points and +6% win probability" — the most copyable idea in the
  comparison. The hub already runs a playoff-odds Monte Carlo; re-running it
  with a swapped lineup or a completed trade converts every tool's output into
  the unit members actually care about. No competitor ships this free.
- **Trade Finder** — enumerate two-for-one packages across rosters ranked by
  joint improvement. Bounded search, offline-friendly, no new data.
- **Coverage disclosure** — the players board renders four columns of `—` per
  row when the projection join misses, with no explanation. State the coverage
  rate on the surface that displays it and collapse columns with zero coverage
  on the current page. The team page already does this right.

### 7.9 Settings, and make `dynasty` mean something

`settings.json` has been synced since 2.4 and only golf renders it. Add a
`settings` tab for football and baseball over the data already on disk: roster
slots, scoring format, FAAB, keeper count, playoff team count, trade deadline,
divisions, tie rules.

Then close AUDIT #9's last loose end: derive dynasty/keeper behaviour from
`settings.keeper_count` rather than the `configs/leagues.yaml` declaration, and
surface keeper status on rosters and the draft board.

### 7.10 Visual system

- **Dark mode.** `globals.css` has no `prefers-color-scheme` handling at all.
  Sleeper is dark-first and that is a large part of why it reads as a consumer
  app rather than an admin console. Tokens are already centralized, so this is a
  second palette plus a manual toggle.
- **Imagery.** Team logos (7.3), member avatars, event art for golf. Every
  screen is currently text-only.
- **Freshness.** Relative "synced 4 min ago", a staleness badge when past
  `SJ_HEALTH_STALE_SECONDS`, and an explicit final/pending marker on scores.
  Nothing on screen currently distinguishes a live-ish score from a six-hour-old
  one.
- **Status legend** for the injury dots — a `title` attribute is invisible on
  touch and unexplained everywhere.
- **Hierarchy.** Nothing on any screen is louder than anything else. Promote the
  viewer's row, the current period, and the live matchup; demote chrome.

### 7.11 Hold the payload budget

`verify:bundle-budget` guards JS. Nothing guards HTML, and the largest route is
**239 KB** against ROADMAP's own < 100 KB target — the football players tab is
now *bigger* than at the first audit because projection columns were added.

Cause: `DataTable` is a client component and `PlayersDataTable` passes it every
row (348 for baseball) so 25 can render. That trade buys instant client-side
search, so it is a real decision, not a bug — but pick one deliberately: move
search/sort/page to `searchParams` on the server, or trim client rows to the
displayed fields. Add an HTML-size assertion to the `web` CI job either way, and
include the 204-row golf scoreboard.

---

## Phase 8 — Sport-specific depth

Runs after 7.1–7.5; each track is independent.

### 8.1 Football: box scores and weekly player stats
The data gap behind three separate audit findings (box scores, live-ish matchup
detail, player game logs). Deferred in 2.4 on size grounds; the 2.2 per-concern
layout plus 2.3's incremental index are what make it affordable now. Write
weekly player lines as their own concern (`weeks/{N}.json`) so a season's team
pages and league pages never load them, and confirm the index-upsert path does
not go quadratic as file count multiplies.

Sleeper's lesson here: **never render a raw stat line.** Show points as *this
league* computes them. The hub already does that for golf via `sg.score`.

### 8.2 Baseball: the projection-free toolkit
4.6's boundary (no MLB model in `src/ffa`) stands. But most useful baseball
tooling needs no model — it is scheduling and roster arithmetic:

- **Category standings**: projected category wins and margin, the summary unit
  FantasyPros uses for roto/H2H-cat.
- **Games-per-team per period** and **two-start pitchers** — ESPN's Weekly
  Forecaster pattern, derivable from the schedule.
- **Trailing-window rater** (7 / 15 / 30 day), ESPN's `PR7/PR15/PR30`. Pure
  arithmetic over synced stats, and the fastest waiver-scouting affordance in
  any competing product.
- **Usage caps**: minimum weekly IP (Yahoo forfeits *every* pitching category
  when unmet) and season maximums. The mechanic home-built baseball hubs miss
  most often, and it is arithmetic.
- **Daily lineup locks** — baseball is a daily game and the hub treats it weekly.

Only the probable-starter grid needs a feed. Do not read this as permission to
half-port football projections onto category leagues.

### 8.3 Golf: close the week-to-week loop
Golf is the one sport where the hub *is* the system of record, so every gap is
ours:

- **Lineup reminder before first tee** (7.7 transport). Highest-value item in
  this phase — locks currently fail closed with no warning.
- **Projected leaderboard / projected week total** as rounds land, the golf
  analogue of live in-game projections; Pro Tour Fantasy Golf projects earnings
  after each round.
- **Golfer detail pages**: usage, results history, ownership % across the league.
- **Per-segment start limits** (the official game's core strategic constraint at
  3 starts per segment) as a settings knob plus a usage board.
- **Auto-pick / alternate on a missed deadline**, and optionally Splash's "drop
  your worst golfer" as a variance dampener for casual managers.

Live in-round scoring stays out — it needs a durable PGAT feed (risk 6.6).

---

## Phase 9 — Optional, and only if members ask

Named so they are not accidentally treated as roadmap:

- **Live scoring.** Requires a real-time feed and a push channel; the 30-minute
  batch sync is a deliberate architecture. Tighten sync cadence on game days
  before considering it.
- **Side games.** Survivor/knockout (ESPN shipped Knockout for 2026, Yahoo
  Death Leagues), toilet-bowl bracket with a last-place trophy, season-long
  pick'em. Cheap to run over existing data and the kind of thing that keeps an
  eliminated manager engaged.
- **Dues tracking** (Sleeper shipped SleeperSafe; Yahoo has a dues field).
  Ledger only — do not touch payments.
- **Multi-league portfolio** view across all four leagues.
- **Native/PWA install.** `manifest.ts` already exists; a real app shell is a
  separate project.

---

## Sequencing

**Phase 5 ops closeout is in** (cache, promote, cold-start knobs, a11y/perf
budgets, hub slim, season cron) along with **1.3 WIF / CD** and **1.7**
(Next 16 / eslint-cli). Engine track D through 4.6 is closed.

**Branch protection on `main` is done** — required checks are `python`, `web`,
and `images`. The `python` check is an aggregator over the 3.11 + 3.12 matrix.

**Strictly ordered:** ~~0~~ → 1 → 2.2 → ~~3.1~~ → ~~3.2~~ → ~~3.3~~ → ~~3.4~~ → ~~3.5~~ → ~~3.6~~ → 4.
Phase 2.2 (schema split) before phase 3 so the UI is built once against the final
shape. Phase 3.1 (unify views) before any other UI work so nothing ships twice.
1.7 (Next 16) after 1.1, so a major bump lands against a real CI gate.

**Runs in parallel** now that phase 0 is in:

| Track | Contents | Touches |
|---|---|---|
| A — Platform | ~~1.3~~, ~~1.5~~, ~~1.6~~, ~~1.7~~ | workflows, Dockerfiles, scripts |
| B — Data | ~~1.4~~, ~~2.1~~, ~~2.2~~, ~~2.3~~, ~~2.4~~, ~~2.5~~ | `src/sj`, `configs` |
| C — Product | ~~3.1~~ → ~~3.2~~ → ~~3.3~~ → ~~3.4~~ → ~~3.5~~ → ~~3.6~~ | `apps/web` |
| D — Engine | ~~4.1~~ … ~~4.6~~ | `src/ffa` + football hub surfaces; baseball ESPN-only |
| F — Golf | ~~6.4a–e~~ → ~~6.5~~ | `src/sg` + hub golf sport lane (MVP + hub surfaces) |

A, B, and D barely overlap with remaining C polish. Playoff make-odds MC
(schedule × typical-week draws × greedy lineups) shipped with 4.5; bracket
champion odds remain optional. Baseball modeling is explicitly out of scope.

**Phase 6 (golf)** is a new product track: private PGA Tour fantasy with the
LIV real-team counting model. It does not block remaining football/baseball
polish; start when feed + MVP slices (6.4a–e) are staffed. Do not put golf
scoring into `src/ffa`.

**Fastest visible wins** remaining: 3.2 (a decade of history appears), 3.3
(tables become usable). 2.1 is done — draft and matchup data persist for zero
extra API calls. 0.2 is done — production was wrong and no longer is.

### Phase 7–9 sequencing

**7.1 is strictly first.** Identity is the prerequisite for 7.2 (a dashboard
about you), 7.6 (a feed with names on it), and 7.8 (tools that default to your
roster). Building any of those before it means building them twice — the same
argument that put 3.1 ahead of the rest of phase 3.

**Strictly ordered:** 7.1 → 7.2 → { 7.5, 7.6 } → 7.7 → 7.8.

Everything else in phase 7 is independent and can land in any order: 7.3
(dead ends), 7.4 (team game log), 7.9 (settings), 7.10 (visual), 7.11
(payload budget).

| Track | Contents | Touches |
|---|---|---|
| G — Identity & IA | 7.1 → 7.2 → 7.5 | `apps/web` (`lib/viewer.ts`, `LeagueView`, layout) |
| H — Depth surfaces | 7.3, 7.4, 7.9 | `apps/web` routes + `lib/data.ts` |
| I — Social | 7.6 → 7.7 | new writable hub concern + a transport |
| J — Tools packaging | 7.8 | `apps/web` + `ffa` playoff-odds re-run |
| K — Craft | 7.10, 7.11 | `globals.css`, CI |
| L — Sport depth | 8.1 · 8.2 · 8.3 | `src/sj` · `apps/web` · `src/sg` |

G, H, and K barely overlap. I is the only track that introduces user-generated
content, so it carries the validation/rate-limit/moderation risk and should not
start before 7.1. L is three independent sports and can run beside any of them;
8.1 is the only item in phases 7–8 gated on new sync data.

**Fastest visible wins in phase 7:** 7.1 (twelve identical rows become *your*
league), 7.4 (team pages stop hiding the season), 7.3's logos and player links
(the app stops being text-only and stops dead-ending).

**Explicitly not roadmap:** phase 9. Live scoring needs a real-time feed the
architecture deliberately does not have, and side games/dues are only worth
building if members ask.

---

## What "done" looks like

Concrete targets, baselined against [AUDIT.md](AUDIT.md) (phase 0) and
[AUDIT-COMPETITIVE.md](AUDIT-COMPETITIVE.md) (phase 7). "Now" is measured on
`main` at `b6ea87e` against `sj seed` data.

### Platform and correctness (phases 0–6)

| Metric | At audit | Now | Target |
|---|---|---|---|
| `npm audit` high + critical | 14 | **0** | 0 |
| Confirmed vulnerabilities | 1 (open redirect) | **0** | 0 |
| Authorization layers | 1 (middleware) | **2** | 2 |
| Pages serving stale build-time data | 2 | **0** | 0 |
| Containers running as root | 3 | **0** | 0 |
| `apps/web` tests | 0 | **138** + Playwright smoke | plus component + smoke |
| Python tests | 197 | **360** | — |
| `apps/web` checks running in CI | 0 | **8** | typecheck + lint + build + tests + prerender + audit + bundle + e2e |
| CI checks that block a merge | 0 | **3** | all of them (branch protection) |
| `src/sj/sync.py` coverage | 0% | **100%** | matches `serialize.py` (~94%) |
| Repo coverage | 67% | **82%** | 85%+ |
| Seasons reachable in the UI | 3 of 24 | **25 of 25** | all of them |
| Deploys requiring a human | all | **rollback only** | rollback only |
| Hub pages calling `ffa` snapshots | 0 | **projections + 6 tools** | projections on roster + player + rankings |

### Product (phase 7)

| Metric | Now | Target |
|---|---|---|
| Screens that identify the viewer's team | **0** | standings, matchups, home, tools |
| Clicks from a player name to that player's detail | **∞** (no page) | 1 |
| Team pages showing the team's own results | **0** | all |
| Nav pills on the densest screen | **28** | ≤ 12 |
| Mobile chrome above the first data row | **1.07–1.23 screens** | < 0.5 screens |
| Ways one member can address another in-app | **0** | feed comments + reactions + polls |
| Outbound messages the hub can send | **0** | weekly recap + golf lineup reminder |
| Decision tools defaulting to your roster | **0 of 6** | 6 of 6 |
| Decision tools stating a verdict | **0 of 6** | trade, start/sit, waivers |
| Largest page payload | **239 KB** | < 100 KB, CI-gated |
| Colour schemes | **1 (light)** | light + dark |
| Screens rendering a team logo | **0** | standings, matchups, teams, headers |

The phase 0–6 table is the one that says the hub is trustworthy. The phase 7
table is the one that says anyone wants to use it.
