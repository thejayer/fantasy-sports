# Strictly Jayers hub — site audit

Point-in-time audit of the member hub (`apps/web`), its data pipeline (`src/sj`),
the analytics engine (`src/ffa`), and the infrastructure around them. Every
finding below was reproduced against a locally running build, not inferred from
reading code alone. The plan that follows from it is in [ROADMAP.md](ROADMAP.md).

Audited at commit `fde0613` (merge of #22).

> **Status: findings 1–5 (all P0) are fixed** as of #26, and finding 11 as of
> #28 — see the summary table at the end for the current state of each finding.
> They are kept here in full, with their reproductions, because the evidence is
> what justifies the roadmap and what a regression would have to contradict.

---

## How this audit was run

The committed fixtures are 1.8–6.4 KB with 3–4 teams and 0–2 players per team,
which hides every problem that only appears at real scale. To audit honestly, a
schema-accurate dataset was generated at production shape. That generator is now
committed as `sj seed` (see [HUB.md](HUB.md)), so every measurement below is
reproducible:

```bash
sj seed          # 24 league-seasons of synthetic data into data/sj
```

| League | Seasons | Per-season snapshot | Players/season | Roster |
|---|---|---|---|---|
| `baseball-dynasty` | 2024–2026 | 540 KB | 348 | 29 |
| `football-main` | 2015–2026 | 196 KB | 192 | 16 |
| `football-dynasty` | 2018–2026 | 268 KB | 264 | 22 |

Total: **6.3 MB across 24 league-seasons**, generated in 0.6 s. Storage is a
non-issue; everything below is about correctness, security, and product surface.

Baseline health at audit time was genuinely good and worth stating up front:
`ruff check .` passed clean, **197 Python tests passed**, `tsc --noEmit` passed,
and `next lint` reported zero warnings. Nothing here is a fire caused by
sloppiness. The problems are gaps in coverage and scope, not rot.

(On `main` after phase 0 those figures are 221 Python tests and 26 web tests,
with `npm audit` at 0 vulnerabilities.)

---

## P0 — Security

### 1. Open redirect on `/login` (confirmed exploitable) — FIXED in #26

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

### 2. Auth is enforced in exactly one place — FIXED in #26

`apps/web/src/middleware.ts` is the only thing standing between an anonymous
request and league data. No page, layout, or data-layer function re-checks the
session. Gating itself works — verified anonymous requests return
`307 -> /login?callbackUrl=…` for both `/leagues` and `/leagues/football-main` —
but it is a single point of failure, which matters because of the next finding.

### 3. Dependencies are behind on security patches — FIXED in #26 (0 advisories)

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

### 4. Deployment credentials and container hardening — MOSTLY FIXED in #26

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

Resolved in #26 except the first bullet: containers run as uid 1001, the
deployer and bucket roles are narrowed, and the dashboard password moved to
Secret Manager. **The long-lived `GCP_SA_KEY` is still in use** — Workload
Identity Federation rewrites all three deploy workflows, so it is roadmap 1.3.

---

## P0 — Correctness

### 5. The home and leagues pages are frozen at build-time data — FIXED in #26

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

### 6. Football leagues have no way to reach their own history — FIXED

Was: season chips lived only on the baseball league view; football history
(12 seasons of `football-main`, 9 of `football-dynasty`) was reachable only by
hand-typing `?season=`. Fixed in roadmap 3.1 (shared `LeagueView` chips) and
3.2 (shared `SeasonSwitcher` on team pages too).

<img src="/opt/cursor/artifacts/audit_football_no_season_switcher.webp" alt="Football league page with no season selector" />
<img src="/opt/cursor/artifacts/audit_baseball_has_season_switcher.webp" alt="Baseball league page showing 2026 2025 2024 season chips" />

### 7. Player tables have no search, sort, filter, or pagination — FIXED

Was: every player rendered as one unbroken table (192 football / 348 baseball),
with no search, sort, filter, or pagination — baseball players HTML hit
**448 KB**. Fixed in roadmap 3.3 via a reusable client `DataTable` (25/page)
on the players tab.

<img src="/opt/cursor/artifacts/audit_players_table_no_search_sort_filter.webp" alt="Players tab rendering 192 rows with no search sort or filter controls" />

Measured production response sizes:

| Route | HTML |
|---|---|
| `/leagues/football-main` (standings) | 15.5 KB |
| `/leagues/football-main?tab=players` | 84.9 KB |
| `/leagues/baseball-dynasty?tab=players` | **448 KB** |

448 KB of HTML to render one page is the direct cost of having no pagination.
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

**Partly fixed.** Snapshots now persist draft, matchups, settings, and
transactions (roadmap 2.1 / 2.4); Matchups tab (3.4) and History tab (3.5 —
all-time standings, champions, record book, H2H) are in the hub. Still absent
from the product: **box scores, draft-results pages, transaction/waiver UI,
free agents, franchise/manager career pages, per-week player stats.**

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

### 11. The web app has no CI whatsoever — FIXED in #28 (branch protection still off)

`.github/workflows/tests.yml` runs `ruff` and `pytest`. It never enters
`apps/web`. There is no `tsc --noEmit`, no `eslint`, no `next build`, and no
frontend test of any kind in CI — **1,609 lines of TypeScript with zero
automated gate.** `npm run lint` also still uses `next lint`, which prints
`deprecated and will be removed in Next.js 16`.

Both checks pass today when run by hand, which is exactly why this is worth
wiring up now, while it is free.

Phase 0 sharpened this: it added `typecheck`, `test` (26 cases), and
`verify:prerender`, all passing, and CI ran none of them — so the green check on
#26 covered essentially nothing in that PR.

Resolved in #28 (roadmap 1.1). `tests.yml` now runs three parallel jobs: the
existing Python checks, a `web` job (typecheck, lint, 26 tests, build,
`verify:prerender`, `npm audit`), and an `images` job that builds the hub and
sync images and asserts neither runs as root. ~88s total.

**One piece is still outstanding and cannot be fixed by a PR:** none of these are
configured as required status checks, so a red run is still mergeable. Enabling
branch protection on `main` for `tests / python`, `tests / web`, and
`tests / images` is a repo setting.

### 12. The pipeline feeding the entire site is untested — closed for sync paths

Coverage at audit vs now (`pytest --cov=src`):

| Module | At audit | Now |
|---|---|---|
| `src/sj/sync.py` | **0%** | **100%** |
| `src/sj/cli.py` | **0%** | **80%** |
| `src/sj/serialize.py` | 94% | 94% |
| `src/sj/store.py` | 90% | 90% |
| `src/ffa/cli.py` | 0% | 0% |
| `src/ffa/dashboard.py` | 0% | 0% |
| **Total** | **67%** | **74%** |

`sync.py` failure paths are covered with mocked ESPN exceptions (no live
calls): missing credentials, `ESPNAccessDenied` / `ESPNInvalidLeague` /
network, partial-season failure, and throttle. `sj sync` exits non-zero on any
skipped season and emits `SYNC_SUMMARY` JSON; `sj backfill` still tolerates
`invalid_league`-only gaps. Remaining coverage drag is `ffa.cli` /
`ffa.dashboard`.

### 13. Nothing deploys automatically

`deploy-hub.yml`, `deploy-sync-job.yml`, and `deploy.yml` are all
`workflow_dispatch` only. Production drifts from `main` until a human clicks
"Run workflow", and no CI gate runs before a deploy. `deploy-hub.yml` also
deploys twice — once to create the service, then again to set `AUTH_URL` — which
leaves a window where OAuth can redirect to the container's bind address.

### 14. No observability — baseline landed

Public `/api/health` reports per-league `synced_at` age (HTTP 503 when empty or
stale). `scripts/setup-sync-alerting.sh` wires a Cloud Monitoring email alert on
`sj-sync` job failure. Route-level `error.tsx` / `not-found.tsx` log to stderr
for Cloud Logging. Still open from the original finding: uptime check on the
live hub URL (console), `min-instances`, and retiring unused `refresh.yml`.

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
snapshot to render one team. At 196–540 KB that is fine. Adding box scores or
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

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Open redirect on `/login` (confirmed) | P0 | Fixed (#26, roadmap 0.1) |
| 2 | Auth enforced only in middleware | P0 | Fixed (#26, roadmap 0.4) |
| 3 | 14 dependency advisories; `next-auth` on prerelease | P0 | Advisories cleared (#26, roadmap 0.3); prerelease remains, roadmap 1.7 |
| 4 | Long-lived SA key, over-broad IAM, root containers | P0 | Containers + IAM fixed (#26, roadmap 0.5); SA key → WIF, roadmap 1.3 |
| 5 | `/` and `/leagues` frozen at build-time fixtures | P0 | Fixed (#26, roadmap 0.2) |
| 6 | Football history unreachable (12 seasons, no switcher) | P1 | Fixed — roadmap 3.1 (league) + 3.2 (team pages) |
| 7 | Player tables: no search/sort/filter/pagination | P1 | Fixed — roadmap 3.3 (`DataTable`) |
| 8 | Football and baseball views diverged | P1 | Fixed — roadmap 3.1 (`LeagueView`) |
| 9 | No matchups, draft, transactions, or history | P1 | Partly — matchups (3.4) + history/records/H2H (3.5) in; draft/tx pages and box scores still open |
| 10 | No loading/error/empty states | P1 | Partly — `error.tsx` / `not-found.tsx` in 1.6; loading/empty remain roadmap 3.6 |
| 11 | Zero CI for `apps/web` | P1 | Fixed (#28, roadmap 1.1); branch protection requires `python` / `web` / `images` |
| 12 | `sync.py` at 0% coverage | P1 | Fixed — 100% + loud exits + `SYNC_SUMMARY` (roadmap 1.4) |
| 13 | All deploys manual | P1 | Open — roadmap 1.3 |
| 14 | No observability or alerting | P1 | Baseline fixed (roadmap 1.6); uptime check + min-instances still open |
| 15 | `ffa` engine disconnected from the hub | P2 | Open — roadmap phase 4 |
| 16 | Storage layout won't extend to weekly data | P2 | Open — roadmap 2.2, 2.3 |
| 17 | Hub image carries the analytics stack | P2 | Open — roadmap phase 5 |
| 18 | CI/production version skew, no lockfile | P2 | Open — roadmap 1.5 |

The through-line at audit time: the engineering that exists is careful and
well-tested, but it is pointed at the wrong surface. The hub is a thin shell over
one ESPN endpoint, guarded by a single middleware check, with a decade of league
history sitting on disk that no link reaches and a sophisticated projection
engine that no page calls.

Phase 0 fixed the parts that were actively wrong or unsafe. It did not change
that through-line — the hub is still a read-only ESPN mirror, and findings 6–18
are what stand between it and a product. Sequencing is in
[ROADMAP.md](ROADMAP.md).
