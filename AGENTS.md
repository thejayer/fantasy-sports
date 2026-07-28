# AGENTS.md

## Cursor Cloud specific instructions

This is a dual-product monorepo. See `README.md` (ffa engine) and `HUB.md` (member hub) for standard commands; only non-obvious startup/run caveats are captured here.

- **ffa** — Python NFL analytics engine + Streamlit dashboard (`src/ffa`, CLI `ffa`).
- **Strictly Jayers hub** — Next.js member hub (`apps/web`) plus the ESPN sync CLI `sj` (`src/sj`).

### Python env (venv)
- Dependencies install into a virtualenv at `/workspace/.venv`. The update script creates it and installs from `requirements-lock.txt` then `pip install -e . --no-deps` (CI parity). `/workspace/.venv/bin` is prepended to `PATH` via `~/.bashrc`, so `ffa`, `sj`, `pytest`, and `ruff` work directly in a login shell; otherwise call them as `.venv/bin/<cmd>`.
- The base image ships Python 3.12 without `ensurepip`; `python3.12-venv` was apt-installed during environment setup (captured in the snapshot). If `python3 -m venv` ever fails with an ensurepip error, reinstall it: `sudo apt-get install -y python3.12-venv`.
- After changing deps in `pyproject.toml`, regenerate the lockfile: `uv pip compile pyproject.toml --extra dev --extra dashboard --extra gcs --python-version 3.11 -o requirements-lock.txt` (3.11 floor so the same pins work on CI's 3.11 + 3.12 matrix).

### Lint (ruff)
- CI installs `ruff` from `requirements-lock.txt` and runs `ruff check .`; the code is kept clean under current `ruff` (0.16+). The only lint exemption is `[tool.ruff.lint] ignore = ["B008"]` in `pyproject.toml`, for Typer's documented `x: T = typer.Option(...)` default-argument pattern used by the `ffa`/`sj` CLIs — keep it. Run `ruff check .` for CI parity; if a new `ruff` release flags additional rules, fix the code (or add a narrow, justified `ignore`) rather than pinning `ruff` down.

### Tests
- `pytest` is fully offline (synthetic fixtures) — no `ffa ingest` needed. Run from repo root.

### ffa CLI / dashboard
- Most `ffa` commands (`score`, `project`, `simulate`, `rank`, `optimize`, `draft-sim`, `backtest`, `dashboard`) need ingested data first: `ffa ingest --season 2023 --season 2024` writes Parquet to `data/raw/` (requires network to nflverse via `nflreadpy`). `data/` is gitignored, so re-ingest after a fresh VM. Configs live in `configs/*.yaml`.
- Calibrated level path (roadmap 4.1): pass `--conditioned-level` on `simulate` / `rank` / `optimize` / `draft-sim` / `backtest` to use `LevelModel` with rosters `years_exp` (and per-tier collapse). Global `--level-sd` / `--level-mean` remain the scalar fallback.
- Projection snapshots (roadmap 4.2): `ffa export-projections --season YYYY` writes `{out_dir}/{scoring}/{season}.json` (default `data/sj/projections/`, `--conditioned-level` on by default). Hub reads via `getProjectionSnapshot(scoring, season)` — never invoke `ffa` from Next.js request handlers. Committed fixtures live under `fixtures/sj/projections/`. Nightly producer: `.github/workflows/refresh.yml` → `store/projections/` artifacts (promote into live store separately).
- ESPN↔nflverse map (roadmap 4.3): `ffa export-player-map --season YYYY` writes `data/sj/player_map/{season}.json` from `rosters.parquet` (+ optional `--ff-playerids`). Coverage = football hub roster ESPN ids resolved under `--sj-root`. Hub reads via `getPlayerMap(season)`. Use `--fail-below 0.95` in ops when live `data/sj` is present; fixture leagues use synthetic ESPN ids so hub coverage against fixtures alone is near zero — that is expected.
- `ffa dashboard` launches Streamlit (the `[dashboard]` extra is installed) and needs ingested data.

### Hub web app (`apps/web`)
- Run with `npm run dev` (Next.js + Turbopack on `http://localhost:3000`). See `HUB.md` for full setup.
- For local dev without Google OAuth, create `apps/web/.env.local` with `AUTH_DEV_BYPASS=1` (plus any `AUTH_SECRET`) to skip login entirely. With bypass off, only `ALLOWED_EMAILS` Google accounts can sign in.
- League pages render one sport-aware `LeagueView` (`apps/web/src/components/LeagueView.tsx`). Do not reintroduce a football-only branch on `leagues/[leagueId]/page.tsx`. Baseball roster team pages still use `BaseballRosterView`.
- Season chips are the shared `SeasonSwitcher` (`apps/web/src/components/SeasonSwitcher.tsx`) on league and team pages. Pass `hrefFor` so team URLs stay under `/leagues/{id}/teams/{teamId}?season=`.
- Players tab uses client `DataTable` / `PlayersDataTable` (roadmap 3.3). Keep `LeagueView` as a server component; do not pull standings/season chrome into the client bundle. Prefer pagination over new table libraries.
- Matchups tab (`?tab=matchups&view=week|schedule|playoffs&week=N`) uses server `MatchupsPanel` + `lib/matchups.ts` (roadmap 3.4). Pair from parallel `schedule`/`scores`/`outcomes` arrays (bye = opponent id equals self). Box scores are not in the snapshot — do not invent per-player lines.
- History tab (`?tab=history&view=standings|champions|records|h2h&a=&b=`) uses `getLeagueHistoryArchive` + `HistoryPanel` / `lib/history.ts` (roadmap 3.5). Loads standings + matchups across seasons only (skip rosters). Key franchises by `team_id`, not owner name. Committed fixtures are usually single-season — use `sj seed` for decade demos.
- Projections (roadmap 4.4): football-only `?tab=projections` (+ optional `&scoring=ppr|standard`) renders `ProjectionsBoard` (season VOR board). Roster + players tables show Floor/Med/Ceil via `lib/projection-join.ts` joining ESPN ids through `getPlayerMap` → `getProjectionSnapshot`. Snapshots are **season-level** — do not label them as weekly start/sit. Committed football fixtures use synthetic ESPN ids, so projection cells stay `—` offline unless you point `SJ_DATA_DIR` / `data/sj` at live sync + exported map/projections (or a local demo overlay with real ESPN ids).
- Decision tools (roadmap 4.5): football `?tab=tools&view=trade|waivers|strength|deferred`. Trade UI is client-side package selection over season quantile sums (`lib/decision-tools.ts` + `TradeAnalyzer`). Waivers = unrostered projections (not ESPN FA). Draft assistant / playoff odds stay on the deferred pane until offline exporters exist — do not call `ffa` from Next handlers.
- Baseball (roadmap 4.6): **projection-free by design.** `BASEBALL_TABS` includes `projections` / `tools` only so EmptyStates can state the NFL-only engine boundary — never load projection bundles for baseball (`wantsProjections` stays football-gated). Do not add MLB code to `src/ffa` without a real ingest/calibration plan. See `HUB.md` § Baseball scope.
- Hub Docker image (Phase 5 / AUDIT #17): runtime is **sj-only** — do not reintroduce `pip install -e .` into `apps/web/Dockerfile` (that pulls the ffa analytics stack). Optional startup sync is `python -m sj.cli` with `PYTHONPATH=/app/src`. `images` CI asserts analytics imports are absent.
- Deploy (roadmap 1.3): hub/sync/dashboard workflows use Workload Identity Federation (`permissions.id-token: write` + `google-github-actions/auth` with the `github` pool/provider). Do not reintroduce `credentials_json` / `GCP_SA_KEY`. Hub CD is push-to-`main` (path-filtered); `workflow_dispatch` remains for rollback.
- Hub entrypoint must `export HOSTNAME=0.0.0.0` (not `${HOSTNAME:-…}`). Cloud Run sets `HOSTNAME` to the instance id; Next standalone binds on that var and dies with `getaddrinfo EAI_AGAIN` if left alone. Public URL is `AUTH_URL` only.
- Production hub (`SJ_SYNC_ON_START=0`) must not `stat`/`test` the GCS-mounted `SJ_DATA_DIR` before listen — a slow FUSE mount hangs the entrypoint and Cloud Run fails the port probe. GCS volume mount options should include `uid=1001,gid=1001` for the non-root `sjhub` user.
- Snapshot reads: missing files (`ENOENT`) cache as `null`; corrupt JSON throws `CorruptSnapshotError` (not cached as missing) and surfaces via `error.tsx` (roadmap 3.6). Prefer `EmptyState` for intentional empties; wide tables should keep `table-cards` + `data-label` for mobile.
- Data source: the app reads `data/sj/` if present, otherwise falls back to committed `fixtures/sj/` sample snapshots — so the UI works offline with no ESPN sync. Live data requires the `sj sync` CLI with ESPN cookies (`ESPN_S2`/`ESPN_SWID`); not needed for browsing fixtures.
- Snapshot layout (schema_version 2): writers emit `{league}/{season}/manifest.json` plus per-concern files (`standings`, `rosters`, `matchups`, `draft`, `settings`, `transactions`). Legacy `{league}/{season}.json` monoliths (committed fixtures) remain readable. Prefer `sj seed` / `sj sync` over hand-editing JSON. After serializer changes, run `sj regenerate-fixtures` and `sj validate-fixtures` (roadmap 2.5) — do not hand-edit `fixtures/sj/`.
- ESPN sync resilience (roadmap 2.4): `sj.sync.espn_call` retries transient network/5xx with backoff; timeouts via `SJ_ESPN_TIMEOUT` (default 30s) and `SJ_ESPN_MAX_ATTEMPTS` (default 4). `recent_activity` is empty for seasons before 2019.
