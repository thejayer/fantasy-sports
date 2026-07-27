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

Deferred deliberately: **Workload Identity Federation** → 1.3, since it rewrites
all three deploy workflows.

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

**One step remains, and it is not something a PR can do.** These jobs report but
do not yet *block*: nothing is configured as a required status check, so a red
run is still mergeable. The check names are now stable — `tests / python`,
`tests / web`, `tests / images` — so the remaining work is enabling branch
protection on `main` in the repo settings. Until that is done, this phase's
premise ("regressions impossible to merge") is only half true.

### 1.2 Test harness for the frontend
*Partly landed:* Vitest is in place with 26 tests covering the Phase 0
regressions — `callbackUrl` validation, the force-dynamic invariant, and the
`requireSession` backstop — and 1.1 now runs them on every PR.

Remaining: React Testing Library for component tests once Phase 3 introduces
client components, and Playwright for a handful of smoke paths (login redirect,
leagues list, standings, team roster, 404s). Neither is worth adding until there
is UI worth driving, so this stays open against Phase 3 rather than blocking it.

### 1.3 Continuous deployment
Deploy `sj-hub` on merge to `main` behind the CI gate, keeping
`workflow_dispatch` for manual rollback. Collapse `deploy-hub.yml`'s two-step
deploy into one by computing the service URL up front, closing the `AUTH_URL`
window. Fold in the Workload Identity Federation migration from 0.5 here, since
it edits the same files.

### 1.4 Close the `sync.py` coverage hole
`sj seed` moved the needle incidentally — `src/sj/sync.py` 0% → **38%**,
`src/sj/cli.py` 0% → **68%**, repo total 67% → **71%** — but only by exercising
`build_snapshot`. The part that actually talks to ESPN is still untested.

What remains is the failure behaviour: tests against recorded ESPN fixtures (not
live calls) covering missing credentials, `ESPNAccessDenied` vs
`ESPNInvalidLeague` vs network error, partial-season failure, and the throttle
path. Then make failure loud — `sj sync` currently exits `0` even when seasons
were skipped, so a partial failure looks like success to Cloud Scheduler. It
should exit non-zero, or at minimum emit a machine-readable summary 1.6 can
alert on. Target: `sync.py` to match `serialize.py` (~94%), repo total 85%+.

### 1.5 Align environments
Test on Python 3.12 in CI to match the containers (matrix 3.11 + 3.12 if you
want to keep the floor). Add a lockfile so CI and production resolve identically.
Enable Dependabot for npm, pip, and Actions — most of phase 0.3 should never
have become manual work.

### 1.6 Baseline observability
A `/api/health` route reporting snapshot freshness (`synced_at` age per league),
alerting on `sj-sync` job failure, and error tracking wired into the Next.js
app. This is what tells you the pipeline broke before a member does.

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
output.

*Partly landed:* `sj seed` ships with a schema contract test asserting the
committed fixtures are a subset of what the serializer emits, which pins the
drift the audit found (fixtures omit `scoring_type`, `period_label`, and most
extended player fields). What remains is regenerating the fixtures themselves
from the serializer so they stop drifting.

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
pagination or virtualization. Fixes both the UX problem and the 448 KB
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

**Next up: 1.4 or 1.3.** With CI in place, either can land against a real gate.
1.4 (`sync.py` failure-path tests) is the better next step: the pipeline feeding
the whole site is still the least-tested thing in the repo, and it currently
reports success when seasons were skipped, so 1.6's alerting has nothing
trustworthy to alert on. 1.3 (continuous deployment) is the bigger win but
carries the Workload Identity Federation migration, making it the largest item
in the phase.

**Do first, and it is not a code change:** enable branch protection on `main` so
`tests / python`, `tests / web`, and `tests / images` are required. Everything in
1.1 reports today but blocks nothing.

**Strictly ordered:** ~~0~~ → 1 → 2.2 → 3.1 → 3.2/3.3 → 3.4/3.5 → 4.
Phase 2.2 (schema split) before phase 3 so the UI is built once against the final
shape. Phase 3.1 (unify views) before any other UI work so nothing ships twice.
1.7 (Next 16) after 1.1, so a major bump lands against a real CI gate.

**Runs in parallel** now that phase 0 is in:

| Track | Contents | Touches |
|---|---|---|
| A — Platform | 1.3, 1.5, 1.6, 1.7 | workflows, Dockerfiles, scripts |
| B — Data | 1.4, 2.1, 2.3, 2.4, 2.5 | `src/sj`, `configs` |
| C — Product | 3.1 → 3.6 | `apps/web` |
| D — Engine | 4.1, 4.3 | `src/ffa` |

A, B, and D barely overlap with C, so platform hardening, sync extension, and the
`LevelModel` plumbing can all proceed while the UI is rebuilt. Track D's 4.3
(player ID mapping) is the long pole for phase 4 and should start early, because
it is the item most likely to reveal unpleasant surprises.

**Fastest visible wins** remaining: 3.2 (a decade of history appears), 2.1
(draft and matchup data for zero extra API calls), 3.3 (tables become usable).
0.2 is done — production was wrong and no longer is.

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
| `apps/web` tests | 0 | **26** | plus component + smoke |
| `apps/web` checks running in CI | 0 | **6** | typecheck + lint + build + tests + prerender + audit |
| CI checks that block a merge | 0 | 0 | all of them (branch protection) |
| `src/sj/sync.py` coverage | 0% | 38% | matches `serialize.py` (~94%) |
| Repo coverage | 67% | 71% | 85%+ |
| Seasons reachable in the UI | 3 of 24 | 3 of 24 | 24 of 24 |
| Largest page payload | 448 KB | 448 KB | < 100 KB |
| Deploys requiring a human | all | all | rollback only |
| Hub pages calling `ffa` | 0 | 0 | projections on roster + player + rankings |

The gap that stands out is now the last row: six checks run on every PR and none
of them can stop a merge, because no branch protection is configured. That is a
repo setting rather than a code change, and it is the cheapest remaining item in
the plan.
