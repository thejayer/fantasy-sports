# Strictly Jayers hub — development game plan

The plan that follows from [AUDIT.md](AUDIT.md). Ordered so that each phase makes
the next one cheaper, and structured so independent tracks can run in parallel.

No calendar estimates — each item is scoped by *what has to change* and *what
could go wrong*, which is the part that actually determines difficulty.

**The strategic goal:** the hub today shows members less than ESPN's own site
does. It should show them things ESPN can't — a decade of league history, all-time
records, rivalry pages, and projections from the 4,712-line engine already sitting
in this repo unused. Phases 0–2 make the foundation trustworthy; phases 3–5 are
where the product becomes something worth logging into.

**Tooling already in place:**

- `sj seed` (see [HUB.md](HUB.md)) fills the local store with realistic-scale
  synthetic snapshots — 24 league-seasons, deterministic, schema-guaranteed. Every
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

### 1.2 Test harness for the frontend
*Partly landed:* Vitest is in place with 26 tests covering the Phase 0
regressions — `callbackUrl` validation, the force-dynamic invariant, and the
`requireSession` backstop — and 1.1 now runs them on every PR.

Remaining: React Testing Library for component tests once Phase 3 introduces
client components, and Playwright for a handful of smoke paths (login redirect,
leagues list, standings, team roster, 404s). Neither is worth adding until there
is UI worth driving, so this stays open against Phase 3 rather than blocking it.

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

### 1.7 Next.js 16 and the ESLint CLI
Carried forward from 0.3, which patched within the 15.5.x line and stopped there.
`next lint` already warns it is removed in 16, so the two moves are one job:
`npx @next/codemod@canary next-lint-to-eslint-cli .`, then `next` 16.x.

Do it after 1.1, not before. Right now nothing in CI would catch what a major
bump breaks, and 1.1 is what makes this a green-or-red question instead of a
manual one. Also worth revisiting the `postcss` / `sharp` overrides from 0.3
here — a newer `next` may pin patched versions itself and make them unnecessary.

Two things to watch in this app specifically: `next-auth` is still a prerelease
and its Next 16 support should be confirmed before starting, and the
`verify:prerender` check reads `.next/prerender-manifest.json`, whose shape is
not a public contract and may move.

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
- **Retry / backoff / timeouts** around ESPN HTTP (`SJ_ESPN_TIMEOUT`,
  `SJ_ESPN_MAX_ATTEMPTS`). espn-api has neither; `--throttle` only spaces
  league-seasons.

Deferred (size / API gaps): box scores, free agents, per-week player stats,
playoff brackets — pull those when a phase-3 page needs them.

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
when the hub calendar leads the NFL year. **Weekly start/sit is deferred** —
store snapshots are season-level totals, not weekly posteriors; UI copy says so
explicitly. Baseball stays projection-free by design (roadmap 4.6 — landed).

### 4.5 Decision tools — LANDED (partial)
Football `tools` tab ships snapshot-backed decision surfaces without calling
`ffa` at request time:

- **Trade** — pick two rosters, check players to offer, see before/after Σ
  floor / median / ceiling / VOR (independent quantile sums; no joint samples
  in store).
- **Waivers** — unrostered projection rows by VOR (proxy until ESPN
  `free_agents` sync exists — roadmap 2.4).
- **Strength** — per-team season projection totals via the player map.

**Deferred in-tab (“More”):** Monte Carlo draft assistant (needs
`export-draft-sim` artifacts), playoff-odds MC (needs weekly team posteriors),
true ESPN FA wire. Use `ffa draft-sim` from the CLI until those exporters land.

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
- **Caching.** The 60 s in-process cache is per-instance. As traffic and
  projection payloads grow, move to a shared cache or Next.js data cache with
  explicit revalidation on sync.
- **Cold starts.** Set `min-instances` if members complain about first load.
- **Storage.** If weekly and projection data outgrow JSON-on-GCS, the pattern is
  already established elsewhere in the repo: Parquet plus DuckDB, as `src/ffa`
  does.
- **`refresh.yml`.** Wired as the 4.2/4.3 projection + player-map producer.
  ~~Year-round cron~~ → **NFL-season cron (Sept–Jan, Tue–Sat)**. Still needs a
  promote step into the live hub store/GCS mount (deploy/sync) — needs GCP
  credentials (pairs with 1.3 WIF).
- **Accessibility and performance budgets** in CI once phase 3 lands.

---

## Sequencing

**Next up: remaining Phase 5 ops** (shared cache, min-instances, artifact
promote, a11y budgets). **1.3 WIF / CD** and hub image slim + season-bound
refresh cron are in. Engine track D through 4.6 is closed.

**Branch protection on `main` is done** — required checks are `python`, `web`,
and `images`. The `python` check is an aggregator over the 3.11 + 3.12 matrix.

**Strictly ordered:** ~~0~~ → 1 → 2.2 → ~~3.1~~ → ~~3.2~~ → ~~3.3~~ → ~~3.4~~ → ~~3.5~~ → ~~3.6~~ → 4.
Phase 2.2 (schema split) before phase 3 so the UI is built once against the final
shape. Phase 3.1 (unify views) before any other UI work so nothing ships twice.
1.7 (Next 16) after 1.1, so a major bump lands against a real CI gate.

**Runs in parallel** now that phase 0 is in:

| Track | Contents | Touches |
|---|---|---|
| A — Platform | ~~1.3~~, ~~1.5~~, ~~1.6~~, 1.7 | workflows, Dockerfiles, scripts |
| B — Data | ~~1.4~~, ~~2.1~~, ~~2.2~~, ~~2.3~~, ~~2.4~~, ~~2.5~~ | `src/sj`, `configs` |
| C — Product | ~~3.1~~ → ~~3.2~~ → ~~3.3~~ → ~~3.4~~ → ~~3.5~~ → ~~3.6~~ | `apps/web` |
| D — Engine | ~~4.1~~ … ~~4.6~~ | `src/ffa` + football hub surfaces; baseball ESPN-only |

A, B, and D barely overlap with remaining C polish. Draft-sim / playoff-odds
exporters remain optional football follow-ups under 4.5's deferred list — not
blockers for closing phase 4. Baseball modeling is explicitly out of scope.

**Fastest visible wins** remaining: 3.2 (a decade of history appears), 3.3
(tables become usable). 2.1 is done — draft and matchup data persist for zero
extra API calls. 0.2 is done — production was wrong and no longer is.

---

## What "done" looks like

Concrete targets, baselined against [AUDIT.md](AUDIT.md) and re-measured on
`main` after phase 0.

| Metric | At audit | Now | Target |
|---|---|---|---|
| `npm audit` high + critical | 14 | **0** | 0 |
| Confirmed vulnerabilities | 1 (open redirect) | **0** | 0 |
| Authorization layers | 1 (middleware) | **2** | 2 |
| Pages serving stale build-time data | 2 | **0** | 0 |
| Containers running as root | 3 | **0** | 0 |
| `apps/web` tests | 0 | **35** | plus component + smoke |
| `apps/web` checks running in CI | 0 | **6** | typecheck + lint + build + tests + prerender + audit |
| CI checks that block a merge | 0 | **3** | all of them (branch protection) |
| `src/sj/sync.py` coverage | 0% | **100%** | matches `serialize.py` (~94%) |
| Repo coverage | 67% | **74%** | 85%+ |
| Seasons reachable in the UI | 3 of 24 | 3 of 24 | 24 of 24 |
| Largest page payload | 448 KB | 448 KB | < 100 KB |
| Deploys requiring a human | all | all | rollback only |
| Hub pages calling `ffa` | 0 | 0 | projections on roster + player + rankings |

Branch protection is on; environment alignment is in (1.5). Draft/matchup
persistence is in (2.1); schema split is in (2.2); incremental index upsert is
in (2.3). The remaining platform gap is continuous deploy (1.3). Observability
baseline is in (1.6).
