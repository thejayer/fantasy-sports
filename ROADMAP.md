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

---

## Phase 0 — Stop the bleeding

Small, self-contained, mostly one-file changes. Nothing else should ship before
these, because #2 makes production visibly wrong and #1 is a live vulnerability.

### 0.1 Fix the open redirect
`apps/web/src/app/login/page.tsx` — validate `callbackUrl` before redirecting.
Accept only same-origin relative paths: must start with a single `/`, must not
start with `//` or `/\`, fall back to `/` otherwise. Apply to both the
`AUTH_DEV_BYPASS` branch and the `session?.user` branch, and to the `redirectTo`
passed into `signIn()`.
*Test:* unit test the validator over the hostile inputs from the audit
(`https://example.com/`, `//example.com`, `/\evil.com`, `/leagues`).

### 0.2 Make `/` and `/leagues` dynamic
Add `export const dynamic = "force-dynamic"` (or a short `revalidate`) to
`apps/web/src/app/page.tsx` and `apps/web/src/app/leagues/page.tsx`.
*Risk:* this bug is invisible in `next dev`. Guard it with a test that asserts
`next build` does **not** mark those routes as static — otherwise it silently
regresses the first time someone adds a page.

### 0.3 Patch the dependency stack
Two steps, deliberately separated so a regression is attributable:
1. `next` 15.5.7 → **15.5.22** (same minor, backport line, patch-only) and
   `next-auth` to the newest 5.x that resolves `@auth/core` above 0.41.2. Re-run
   `npm audit` and expect the 12 high / 2 critical count to drop.
2. Then evaluate `next` 16.x on its own branch — `next lint` is already warning it
   is removed in 16, so that migration is coupled to moving to the ESLint CLI.

### 0.4 Add a second layer of authorization
Middleware stays, but stops being the only gate. Add a `requireSession()` helper
that every page and every `src/lib/data.ts` entry point calls, so a middleware
bypass yields no data. Cheap now, and it neutralizes the entire
middleware-bypass advisory class going forward.

### 0.5 Harden the containers and credentials
- `USER node` / non-root user in all three Dockerfiles.
- Move `DASHBOARD_PASSWORD` out of `--set-env-vars` into Secret Manager.
- Drop the deployer SA's `secretAccessor` grant (only the runtime SA needs it);
  narrow `artifactregistry.admin` → `artifactregistry.writer`; narrow the sync
  bucket grant from `objectAdmin` to `objectViewer` + a scoped writer.
- Replace `GCP_SA_KEY` with Workload Identity Federation. Larger than the rest
  of this phase and touches all three deploy workflows — safe to defer to 1.3,
  but do not defer indefinitely.

---

## Phase 1 — Make regressions impossible to merge

Phase 0 fixes today's bugs; this phase is why tomorrow's don't ship. Do it before
the UI work in phase 3, because that work is large and will need a safety net.

### 1.1 Web CI
Extend `.github/workflows/tests.yml` (or add a `web.yml`) with a job that runs
`npm ci`, `tsc --noEmit`, ESLint, and `next build` on every PR touching
`apps/web`. All of these pass today, so this lands green and immediately starts
earning.

### 1.2 Test harness for the frontend
Vitest plus React Testing Library for units, Playwright for a handful of smoke
paths (login redirect, leagues list, league standings, team roster, 404s). First
tests to write are the phase-0 regressions: `callbackUrl` validation, and the
static/dynamic assertion from 0.2.

### 1.3 Continuous deployment
Deploy `sj-hub` on merge to `main` behind the CI gate, keeping
`workflow_dispatch` for manual rollback. Collapse `deploy-hub.yml`'s two-step
deploy into one by computing the service URL up front, closing the `AUTH_URL`
window. Fold in the Workload Identity Federation migration from 0.5 here, since
it edits the same files.

### 1.4 Close the `sync.py` coverage hole
Tests against recorded ESPN fixtures (not live calls) covering: missing
credentials, `ESPNAccessDenied` vs `ESPNInvalidLeague` vs network error,
partial-season failure, and the throttle path. Then make failure loud — `sj sync`
should exit non-zero on partial failure, or at minimum emit a machine-readable
summary the scheduler can alert on. Target: `src/sj/sync.py` and `src/sj/cli.py`
off 0%; repo total off 67%.

### 1.5 Align environments
Test on Python 3.12 in CI to match the containers (matrix 3.11 + 3.12 if you
want to keep the floor). Add a lockfile so CI and production resolve identically.
Enable Dependabot for npm, pip, and Actions — most of phase 0.3 should never
have become manual work.

### 1.6 Baseline observability
A `/api/health` route reporting snapshot freshness (`synced_at` age per league),
alerting on `sj-sync` job failure, and error tracking wired into the Next.js
app. This is what tells you the pipeline broke before a member does.

---

## Phase 2 — Make the data layer worth building a product on

Everything in phase 3 and 4 is gated on data the sync doesn't currently keep.
This is the highest-leverage phase in the plan, and it starts with free wins.

### 2.1 Persist what is already being fetched
`src/sj/sync.py` already makes an HTTP call for `league.draft` and discards the
result, and `team.schedule` / `team.scores` / `team.outcomes` are already
populated in memory by the initial `mMatchup` fetch. Serializing them costs **no
additional ESPN requests**. That single change unlocks draft-results pages,
matchup history, and weekly scores.

### 2.2 Split the snapshot schema
One monolithic blob per league-season stops working the moment weekly data lands
(finding #16), and `getTeam()` already parses a whole league to render one team.
Move to per-concern files — `standings.json`, `rosters.json`, `matchups.json`,
`draft.json`, `transactions.json` — with a manifest per league-season. Version the
schema so the web app can detect and tolerate old snapshots during rollout.
*Risk:* this is the one breaking change in the plan. Do it before there is more
data to migrate, not after.

### 2.3 Fix the index rewrite
`_rewrite_index()` re-reads every snapshot on every write. Make it incremental,
or write per-league manifests and compose the index from those. Required before
weekly snapshots multiply the file count.

### 2.4 Extend the sync
In rough value order, all available through the `espn-api` client already in use:
transactions and trades, box scores (2019+), playoff brackets, free agents,
league settings (roster slots, FAAB, keeper counts — which is what would make
`format: dynasty` mean something), per-week player stats.
Add retry with backoff and explicit timeouts around the ESPN calls; the
underlying library has neither, and `--throttle` only spaces out league-seasons.

### 2.5 Backfill and validate
Run the full backfill (24 league-seasons; football back to 2015) and validate the
output. Add a schema contract test asserting committed fixtures match what
`serialize_league` emits — the current fixtures have already drifted, omitting
`scoring_type`, `period_label`, and most extended player fields.

---

## Phase 3 — Rebuild the UI into an actual hub

Where members notice the difference. 3.1 comes first because it stops the cost
of every later item from doubling.

### 3.1 Unify the league views
Delete the football branch of `apps/web/src/app/leagues/[leagueId]/page.tsx` and
generalize `BaseballLeagueView` into one sport-aware `LeagueView` with pluggable
stat columns. Football immediately inherits season chips, win percentage, injury
dots, and scroll containers. Without this, every feature below ships twice.

### 3.2 Season navigation everywhere
Season switcher on every league and team page. This alone surfaces 12 seasons of
`football-main` and 9 of `football-dynasty` that are already on disk and
currently unreachable (finding #6). Highest value-per-line change in the plan.

### 3.3 A real data table
One reusable table with search, sortable columns, position/role filters, and
pagination or virtualization. Fixes both the UX problem and the 396 KB
baseball players response. Requires a client component — deliberately kept
narrow so the rest of the app stays server-rendered.

### 3.4 Matchups, scores, and playoffs
Consuming 2.1 and 2.4: a weekly matchup view, a season schedule with results, a
playoff bracket, and box scores per matchup. This is the core weekly loop the hub
currently has none of.

### 3.5 History and records
The differentiator, and the thing ESPN genuinely cannot show them: all-time
standings across every season, champions by year, head-to-head records between
any two managers, franchise/manager pages spanning a decade, single-week and
single-season record books, draft history with hit/bust retrospectives.
A decade of `football-main` data makes this possible today.

### 3.6 States and polish
`loading.tsx` skeletons, `error.tsx` boundaries, a branded `not-found.tsx`, real
empty states. Distinguish "missing snapshot" from "corrupt snapshot" in
`readJson()` instead of caching both as `null`. Delete the `create-next-app`
SVGs; add `robots.txt`, a manifest, and an Open Graph image. Card layouts for
wide tables on mobile.

---

## Phase 4 — Connect the engine

This is the "another level" step. 4,712 lines of calibrated projection modeling
currently reach members through a separate password-gated Streamlit app; the hub
never calls it. Sequenced after phase 2 because it needs the richer data, and
after phase 3 because it needs somewhere to render.

### 4.1 Finish the engine's own open item
Wire the conditioned `LevelModel` (with the `years_exp` rosters join) through the
`simulate` / `rank` / `draft-sim` commands. `README.md` names this as the missing
plumbing, and it is the best-calibrated configuration the backtest found
(central coverage 0.80 vs 0.75). Everything below consumes its output, so it
should be the recommended path first.

### 4.2 Give the engine a consumable interface
Today `ffa` is a CLI plus a Streamlit app. The hub needs projections as data:
either a scheduled job that writes projection snapshots into the same store the
hub already reads — which fits the existing architecture and keeps the web
container free of the Python analytics stack (finding #17) — or a small service
the hub queries. The snapshot approach is strongly preferred.

### 4.3 Map ESPN players to engine players
The unglamorous prerequisite and the main technical risk in this phase. ESPN
player IDs and nflverse IDs need a reliable join, with explicit handling for
misses. Get this wrong and every projection surface inherits the error. Build it
with a coverage report — what fraction of rostered players resolved — and treat
that number as a monitored metric.

### 4.4 Projections in the hub
Per-player floor/median/ceiling on roster and player pages, VOR and tiers on a
ranked board, and weekly start/sit guidance for real rosters. Now the hub tells
a member something ESPN doesn't.

### 4.5 Decision tools
Trade analyzer comparing posterior distributions across two rosters, a draft
assistant using the existing Monte Carlo draft sim seeded with the actual league
settings, playoff-odds simulation from current standings plus remaining schedule,
and waiver-wire recommendations against `free_agents`.

### 4.6 Baseball
The engine is NFL-only, while `baseball-dynasty` has the best UI in the app. Decide
deliberately: either extend the modeling to baseball, or keep the hub's baseball
experience data-rich but projection-free. Scoping this honestly is the
deliverable — the ingest layer, projection features, and calibration work are all
NFL-shaped today.

---

## Phase 5 — Scale and operate

Fold in continuously rather than saving for the end.

- **Container slimming.** Drop the Python analytics stack from the hub image
  (finding #17); non-root, multi-stage, stop copying fixtures twice.
- **Caching.** The 60 s in-process cache is per-instance. As traffic and
  projection payloads grow, move to a shared cache or Next.js data cache with
  explicit revalidation on sync.
- **Cold starts.** Set `min-instances` if members complain about first load.
- **Storage.** If weekly and projection data outgrow JSON-on-GCS, the pattern is
  already established elsewhere in the repo: Parquet plus DuckDB, as `src/ffa`
  does.
- **`refresh.yml`.** It currently produces artifacts nothing consumes, on a
  year-round cron for a seasonal workload. Either wire it into 4.2 as the
  projection producer or retire it.
- **Accessibility and performance budgets** in CI once phase 3 lands.

---

## Sequencing

**Strictly ordered:** 0 → 1 → 2.2 → 3.1 → 3.2/3.3 → 3.4/3.5 → 4.
Phase 2.2 (schema split) before phase 3 so the UI is built once against the final
shape. Phase 3.1 (unify views) before any other UI work so nothing ships twice.

**Runs in parallel** once phase 0 is in:

| Track | Contents | Touches |
|---|---|---|
| A — Platform | 1.1, 1.3, 1.5, 1.6, 0.5 | workflows, Dockerfiles, scripts |
| B — Data | 2.1, 2.3, 2.4, 2.5, 1.4 | `src/sj`, `configs` |
| C — Product | 3.1 → 3.6 | `apps/web` |
| D — Engine | 4.1, 4.3 | `src/ffa` |

A, B, and D barely overlap with C, so platform hardening, sync extension, and the
`LevelModel` plumbing can all proceed while the UI is rebuilt. Track D's 4.3
(player ID mapping) is the long pole for phase 4 and should start early, because
it is the item most likely to reveal unpleasant surprises.

**Fastest visible wins,** if you want momentum before the deep work:
0.2 (stale pages — production is wrong right now), 3.2 (a decade of history
appears), 2.1 (draft and matchup data for zero extra API calls), 3.3 (tables
become usable).

---

## What "done" looks like

Concrete targets, all measured against numbers recorded in [AUDIT.md](AUDIT.md):

| Metric | Today | Target |
|---|---|---|
| `npm audit` high + critical | 14 | 0 |
| Confirmed vulnerabilities | 1 (open redirect) | 0 |
| Authorization layers | 1 (middleware) | 2 |
| Pages serving stale build-time data | 2 | 0 |
| Seasons reachable in the UI | 3 of 24 | 24 of 24 |
| `apps/web` CI checks | 0 | typecheck + lint + build + tests |
| `src/sj/sync.py` coverage | 0% | matches `serialize.py` (~94%) |
| Repo coverage | 67% | 85%+ |
| Largest page payload | 396 KB | < 100 KB |
| Deploys requiring a human | all | rollback only |
| Hub pages calling `ffa` | 0 | projections on roster + player + rankings |
