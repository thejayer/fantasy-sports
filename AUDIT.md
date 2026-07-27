# Strictly Jayers hub — site audit

Point-in-time audit of the member hub (`apps/web`), its data pipeline (`src/sj`),
the analytics engine (`src/ffa`), and the infrastructure around them. Every
finding below was reproduced against a locally running build, not inferred from
reading code alone. The plan that follows from it is in [ROADMAP.md](ROADMAP.md).

Audited at commit `fde0613` (merge of #22).

---

## How this audit was run

The committed fixtures are 1.8–6.4 KB with 3–4 teams and 0–2 players per team,
which hides every problem that only appears at real scale. To audit honestly, a
schema-accurate dataset was generated at production shape — 3 leagues × 24
league-seasons, 12 teams each, full rosters — matching what `src/sj/serialize.py`
actually emits:

| League | Seasons | Per-season snapshot | Players/season |
|---|---|---|---|
| `baseball-dynasty` | 2024–2026 | 464 KB | 300 |
| `football-main` | 2015–2026 | 195 KB | 192 |
| `football-dynasty` | 2018–2026 | 267 KB | 264 |

Total: **6.0 MB across 24 league-seasons.** Storage is a non-issue; everything
below is about correctness, security, and product surface.

Baseline health is genuinely good and worth stating up front: `ruff check .`
passes clean, **197 Python tests pass**, `tsc --noEmit` passes, and
`next lint` reports zero warnings. Nothing here is a fire caused by sloppiness.
The problems are gaps in coverage and scope, not rot.

---

## P0 — Security

### 1. Open redirect on `/login` (confirmed exploitable)

`apps/web/src/app/login/page.tsx` takes `callbackUrl` straight from the query
string and passes it to `redirect()` with no validation that it is a relative
path:

```ts
const { callbackUrl = "/", error } = await searchParams;
if (process.env.AUTH_DEV_BYPASS === "1") redirect(callbackUrl);
if (session?.user) redirect(callbackUrl);
```

Reproduced against a production build:

```
/login?callbackUrl=https%3A%2F%2Fexample.com%2F  -> 307  Location: https://example.com/
/login?callbackUrl=%2F%2Fexample.com             -> 307  Location: http://example.com/
/login?callbackUrl=%2Fleagues       (control)    -> 307  Location: http://localhost:3100/leagues
```

In production `AUTH_DEV_BYPASS` is `0`, so the live vector is the
`session?.user` branch: any **signed-in member** who follows
`https://<hub-url>/login?callbackUrl=https://evil.example` is bounced to the
attacker's site from a domain they trust. That is a credible credential-phishing
setup, and the fix is a few lines — reject any `callbackUrl` that is not a
same-origin relative path.

### 2. Auth is enforced in exactly one place

`apps/web/src/middleware.ts` is the only thing standing between an anonymous
request and league data. No page, layout, or data-layer function re-checks the
session. Gating itself works — verified anonymous requests return
`307 -> /login?callbackUrl=…` for both `/leagues` and `/leagues/football-main` —
but it is a single point of failure, which matters because of the next finding.

### 3. Dependencies are behind on security patches

`npm audit` over 371 dependencies reports **14 vulnerabilities: 12 high, 2
critical**, and `npm ci` itself prints a deprecation warning that the pinned
Next.js release has a known security vulnerability.

| Package | Installed | Note |
|---|---|---|
| `next` | 15.5.7 | 15.5.x backport line is at **15.5.22**; current stable is 16.2.12 |
| `next-auth` | 5.0.0-beta.25 | Production auth on a **prerelease**; pulls vulnerable `@auth/core` |
| `@auth/core` | ≤0.41.2 | 3 **critical** advisories, incl. OAuth state/nonce/PKCE cookies not bound to the issuing provider |

Several of the Next.js advisories are specifically **middleware/proxy bypass**
classes (`GHSA-267c-6grr-h53f`, `GHSA-26hh-7cqf-hhc6`, `GHSA-492v-c6pp-mqqv`).
Combined with finding #2, a middleware bypass in this app is a total
authorization bypass.

To be precise about severity: the two bypass vectors probed directly against
this build — the `x-middleware-subrequest` header (CVE-2025-29927) and an
RSC/segment-prefetch header combination — **both returned `307` and leaked no
data**. So this is latent risk from running behind on patches, not a
demonstrated live hole. It should be treated as urgent anyway, because the
app has no second layer to fall back on.

### 4. Deployment credentials and container hardening

- All three deploy workflows authenticate with a long-lived service-account JSON
  key (`secrets.GCP_SA_KEY`) rather than Workload Identity Federation.
  `scripts/setup-github-deployer.sh` generates and prints a downloadable
  `key.json`.
- That deployer SA is granted project-level `run.admin`,
  `artifactregistry.admin`, `serviceusage.serviceUsageAdmin`, and
  `secretmanager.secretAccessor`. The script also grants the **deployer** read
  access to all six hub secrets, which deployment does not need — only the
  runtime SA does.
- `scripts/setup-sync-infra.sh` grants the default Compute Engine SA
  `roles/storage.objectAdmin` on the snapshot bucket (read/write/delete) where
  `objectViewer` plus a narrow writer for the sync job would do.
- No `USER` directive in `Dockerfile`, `Dockerfile.sync`, or
  `apps/web/Dockerfile` — **all three containers run as root**.
- `deploy.yml` passes `DASHBOARD_PASSWORD` via `--set-env-vars`, so it is
  readable by anyone with `run.services.get`, instead of via Secret Manager.

---

## P0 — Correctness

### 5. The home and leagues pages are frozen at build-time data

`next build` reports `/` and `/leagues` as `○ (Static) prerendered as static
content`. Both call `getLatestLeagues()`, which reads the filesystem at build
time. In `apps/web/Dockerfile` the build stage has only `fixtures/sj` available —
the real snapshots arrive later, at runtime, as a Cloud Storage mount. So both
pages bake in fixture data **permanently**, and no amount of syncing will
refresh them.

Reproduced by building with only fixtures present (mimicking Docker), then
serving with the realistic dataset mounted (mimicking production):

| Page | Rendering | Team count shown |
|---|---|---|
| `/leagues` | static, build-time | Baseball **3 teams** · Football **4 teams** · Dynasty **3 teams** |
| `/leagues/football-main` | dynamic, request-time | **12 teams · week 14** |

<img src="/opt/cursor/artifacts/audit_leagues_index_stale_team_counts.webp" alt="Leagues index showing stale fixture team counts of 3, 4 and 3" />

The same page's league entries also show `season 2025` for both football leagues
while the live snapshot is `season 2026`. Any league added to
`configs/leagues.yaml` will not appear on `/leagues` until someone rebuilds and
redeploys the image. The home page inherits the same staleness through its
"Open latest season" link, which targets `leagues[0]` from that frozen list.

Fix is one line per page (`export const dynamic = "force-dynamic"` or a
`revalidate` window), but it needs a regression test, because nothing about the
symptom is visible in development — `next dev` renders every page per request,
so this bug is invisible until production.

---

## P1 — Product and UX

### 6. Football leagues have no way to reach their own history

`SeasonSwitcher` exists only inside `apps/web/src/components/BaseballLeagueView.tsx`.
The football branch of `apps/web/src/app/leagues/[leagueId]/page.tsx` renders no
season control at all. Confirmed by counting `season-chip` elements in the
served HTML: **0 on `/leagues/football-main`**, 3 on `/leagues/baseball-dynasty`.

`configs/leagues.yaml` declares **12 seasons for `football-main` (2015–2026)** and
9 for `football-dynasty`. `?season=2015` renders correctly when typed by hand, so
the data and the routing both work — there is simply no link to it. The single
most valuable asset the group has, a decade of league history, is unreachable
through the UI.

<img src="/opt/cursor/artifacts/audit_football_no_season_switcher.webp" alt="Football league page with no season selector" />
<img src="/opt/cursor/artifacts/audit_baseball_has_season_switcher.webp" alt="Baseball league page showing 2026 2025 2024 season chips" />

### 7. Player tables have no search, sort, filter, or pagination

Every player in the league renders as one unbroken table: **192 rows** for
football, **300** for baseball. There is no search box, no sortable column, no
position filter, and no pagination. Finding a player means scrolling.

<img src="/opt/cursor/artifacts/audit_players_table_no_search_sort_filter.webp" alt="Players tab rendering 192 rows with no search sort or filter controls" />

Measured production response sizes:

| Route | HTML |
|---|---|
| `/leagues/football-main` (standings) | 15.8 KB |
| `/leagues/football-main?tab=players` | 86.5 KB |
| `/leagues/baseball-dynasty?tab=players` | **395.8 KB** |

396 KB of HTML to render one page is the direct cost of having no pagination.
Note this is a server-rendered table with zero client-side interactivity, so
the payload buys nothing.

### 8. The football and baseball league views have diverged

`BaseballLeagueView` is a genuinely nicer page than the football branch it sits
beside. Football is missing everything baseball gained: season chips, win
percentage, injury status dots, role filtering, per-stat columns, and horizontal
scroll containers on wide tables. Two independent implementations of the same
screen now exist, and the football one — covering 21 of the 24 league-seasons —
is the weaker of the two. Every future feature has to be built twice or it
diverges further.

### 9. The hub is missing almost everything a league hub is for

Today's snapshot is standings plus current rosters. Absent: **matchups and
schedule, weekly scores, box scores, playoff brackets, draft results,
transactions and trades, waiver activity, free agents, head-to-head history,
records and all-time leaderboards, per-week player stats.**

Some of this is nearly free. `src/sj/sync.py` already builds `league.draft` via a
dedicated HTTP call and then discards it, and `team.schedule` / `team.scores` /
`team.outcomes` are already populated in memory by the initial `mMatchup` fetch.
The data is fetched and thrown away before `serialize_league` runs.

Also missing: `format: dynasty` is a declaration in `configs/leagues.yaml`, not
something derived from ESPN keeper settings, so nothing in the product actually
behaves differently for a dynasty league.

### 10. No loading, error, or empty states

No `loading.tsx`, `error.tsx`, or custom `not-found.tsx` anywhere in
`apps/web/src/app`. A slow or failed Cloud Storage read surfaces as a blank
page or the framework's default error screen. `readJson()` in
`apps/web/src/lib/data.ts` swallows every exception into `null`, so a corrupt
snapshot is indistinguishable from a missing one — and a corrupt snapshot gets
cached as `null` for the full TTL. There is one empty state in the whole app,
on the leagues list.

Also cosmetic but worth clearing out: `apps/web/public/` still ships the
`create-next-app` boilerplate (`next.svg`, `vercel.svg`, `file.svg`,
`globe.svg`, `window.svg`), and there is no `robots.txt`, `manifest.json`, or
Open Graph image.

---

## P1 — Engineering practice

### 11. The web app has no CI whatsoever

`.github/workflows/tests.yml` runs `ruff` and `pytest`. It never enters
`apps/web`. There is no `tsc --noEmit`, no `eslint`, no `next build`, and no
frontend test of any kind in CI — **1,609 lines of TypeScript with zero
automated gate.** `npm run lint` also still uses `next lint`, which prints
`deprecated and will be removed in Next.js 16`.

Both checks pass today when run by hand, which is exactly why this is worth
wiring up now, while it is free.

### 12. The pipeline feeding the entire site is untested

Coverage measured with `pytest --cov`:

| Module | Coverage |
|---|---|
| `src/sj/sync.py` | **0%** |
| `src/sj/cli.py` | **0%** |
| `src/sj/serialize.py` | 94% |
| `src/sj/store.py` | 90% |
| `src/ffa/cli.py` | 0% |
| `src/ffa/dashboard.py` | 0% |
| **Total** | **67%** |

`sync.py` — credential handling, ESPN error classification, partial-failure
behavior, throttling — has no tests at all. Its failure mode is quiet: a bare
`except Exception` collects per-season errors into strings, and `sj sync` exits
`0` even when seasons were skipped, so a partial failure looks like a success to
Cloud Scheduler.

### 13. Nothing deploys automatically

`deploy-hub.yml`, `deploy-sync-job.yml`, and `deploy.yml` are all
`workflow_dispatch` only. Production drifts from `main` until a human clicks
"Run workflow", and no CI gate runs before a deploy. `deploy-hub.yml` also
deploys twice — once to create the service, then again to set `AUTH_URL` — which
leaves a window where OAuth can redirect to the container's bind address.

### 14. No observability

No health or readiness endpoint, no error tracking, no structured logging, no
alerting when the sync job fails, no uptime check, and `min-instances` unset so
every visit after idle pays a cold start. `refresh.yml` runs on a schedule,
uploads Parquet artifacts with 14-day retention, and **nothing consumes them.**
It is also cron'd Tue–Sat year-round for an NFL-season workload.

---

## P2 — Architecture and strategy

### 15. The analytics engine and the hub are two unrelated products

This is the biggest strategic finding in the audit.

| Component | Lines | Purpose |
|---|---|---|
| `src/ffa` | **4,712** | Projections, VOR, tiers, ILP optimizer, draft sim, backtesting |
| `src/sj` | 726 | ESPN snapshot sync |
| `apps/web` | 1,609 | Member hub UI |

Cross-references between them: **zero**. `grep` across `apps/web/src` for
`ffa`, `projection`, `vor`, `tier`, `simulate`, or `draft` returns nothing, and
neither Python package imports the other.

`README.md` documents 18 phases of serious modeling work — calibration
diagnostics, variance decomposition, a tier-conditioned role-collapse model that
took q05–q95 coverage from 0.30 to 0.80. That work reaches users only through a
separate, password-gated Streamlit app on a different Cloud Run service. The
hub, which is the thing members actually visit, is a read-only ESPN mirror that
tells them nothing ESPN's own site doesn't.

The engine is also NFL-only, while `baseball-dynasty` is the league with the
richest UI. And `LevelModel`, the best-calibrated configuration in the engine, is
still not wired through the `simulate`/`rank`/`draft-sim` CLI commands — the
README's own "what's next" names this as the missing plumbing.

### 16. Storage layout will not extend to weekly data

One JSON blob per league-season, and `getTeam()` parses the entire league
snapshot to render one team. At 195–464 KB that is fine. Adding box scores or
per-week player stats — the obvious next features — pushes seasons toward tens of
megabytes and breaks the pattern.

Separately, `FileStore._rewrite_index()` / `GcsStore._rewrite_index()` rebuild
the index by re-reading **every** snapshot on **every** write, so a backfill is
quadratic in snapshot count. Fine at 24; not fine once weekly snapshots exist.

### 17. The hub container installs the entire analytics stack

`apps/web/Dockerfile` runs `pip install -e .` in the runtime stage, pulling
duckdb, scikit-learn, and pandas into an image whose job is to serve Next.js.
`deploy-hub.yml` sets `SJ_SYNC_ON_START=0`, so the `sj` CLI it is installing for
is never invoked in production. Fixtures are copied twice, and there is no
non-root final stage.

### 18. Version skew between CI and production

`tests.yml` tests on Python **3.11**. The hub and sync containers run Python
**3.12**. `pyproject.toml` declares `>=3.10` and pins only lower bounds with no
lockfile, so CI and production resolve dependency versions independently at build
time. `@types/node` is `^20` against a Node 22 runtime. No Dependabot or Renovate.

---

## Summary

| # | Finding | Severity |
|---|---|---|
| 1 | Open redirect on `/login` (confirmed) | P0 |
| 2 | Auth enforced only in middleware | P0 |
| 3 | 14 dependency advisories; `next-auth` on prerelease | P0 |
| 4 | Long-lived SA key, over-broad IAM, root containers | P0 |
| 5 | `/` and `/leagues` frozen at build-time fixtures | P0 |
| 6 | Football history unreachable (12 seasons, no switcher) | P1 |
| 7 | Player tables: no search/sort/filter/pagination | P1 |
| 8 | Football and baseball views diverged | P1 |
| 9 | No matchups, draft, transactions, or history | P1 |
| 10 | No loading/error/empty states | P1 |
| 11 | Zero CI for `apps/web` | P1 |
| 12 | `sync.py` at 0% coverage | P1 |
| 13 | All deploys manual | P1 |
| 14 | No observability or alerting | P1 |
| 15 | `ffa` engine disconnected from the hub | P2 |
| 16 | Storage layout won't extend to weekly data | P2 |
| 17 | Hub image carries the analytics stack | P2 |
| 18 | CI/production version skew, no lockfile | P2 |

The through-line: the engineering that exists is careful and well-tested, but it
is pointed at the wrong surface. The hub is a thin shell over one ESPN endpoint,
guarded by a single middleware check, with a decade of league history sitting on
disk that no link reaches and a sophisticated projection engine that no page
calls. Sequencing for fixing that is in [ROADMAP.md](ROADMAP.md).
