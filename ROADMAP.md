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

### 1.3 Continuous deployment
Deploy `sj-hub` on merge to `main` behind the CI gate, keeping
`workflow_dispatch` for manual rollback. Collapse `deploy-hub.yml`'s two-step
deploy into one by computing the service URL up front, closing the `AUTH_URL`
window. Fold in the Workload Identity Federation migration from 0.5 here, since
it edits the same files.

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
standings.json  rosters.json  matchups.json  draft.json  transactions.json
```

`schema_version: 2` on the manifest. Legacy `{league}/{season}.json` monoliths
(`schema_version` 1 — committed fixtures) stay readable; writers emit only v2
and delete a leftover monolith for that season. `transactions.json` is an empty
stub until 2.4 so the layout does not need a second migration.

Python `read_snapshot` reassembles the monolith. The web dual-reads manifest or
monolith; `getTeam` on v2 loads standings + one roster only (AUDIT #16). Index
entries point at the manifest path.

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

**Next up: 1.3 or 2.3.** Continuous deployment + Workload Identity Federation
(1.3) is the biggest remaining platform win on track A (needs GCP-side WIF
setup). On the data track, 2.3 (incremental index rewrite) is the natural
follow-on now that seasons are multi-file. 1.5, 2.1, and 2.2 are in.

**Branch protection on `main` is done** — required checks are `python`, `web`,
and `images`. The `python` check is an aggregator over the 3.11 + 3.12 matrix.

**Strictly ordered:** ~~0~~ → 1 → 2.2 → 3.1 → 3.2/3.3 → 3.4/3.5 → 4.
Phase 2.2 (schema split) before phase 3 so the UI is built once against the final
shape. Phase 3.1 (unify views) before any other UI work so nothing ships twice.
1.7 (Next 16) after 1.1, so a major bump lands against a real CI gate.

**Runs in parallel** now that phase 0 is in:

| Track | Contents | Touches |
|---|---|---|
| A — Platform | 1.3, ~~1.5~~, ~~1.6~~, 1.7 | workflows, Dockerfiles, scripts |
| B — Data | ~~1.4~~, ~~2.1~~, ~~2.2~~, 2.3, 2.4, 2.5 | `src/sj`, `configs` |
| C — Product | 3.1 → 3.6 | `apps/web` |
| D — Engine | 4.1, 4.3 | `src/ffa` |

A, B, and D barely overlap with C, so platform hardening, sync extension, and the
`LevelModel` plumbing can all proceed while the UI is rebuilt. Track D's 4.3
(player ID mapping) is the long pole for phase 4 and should start early, because
it is the item most likely to reveal unpleasant surprises.

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
persistence is in (2.1); schema split is in (2.2). The remaining platform gap
is continuous deploy (1.3). Observability baseline is in (1.6).
