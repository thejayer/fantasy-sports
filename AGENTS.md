# AGENTS.md

## Cursor Cloud specific instructions

This is a dual-product monorepo. See `README.md` (ffa engine) and `HUB.md` (member hub) for standard commands; only non-obvious startup/run caveats are captured here.

- **ffa** — Python NFL analytics engine + Streamlit dashboard (`src/ffa`, CLI `ffa`).
- **Strictly Jayers hub** — Next.js member hub (`apps/web`) plus the ESPN sync CLI `sj` (`src/sj`).

### Python env (venv)
- Dependencies install into a virtualenv at `/workspace/.venv`. The update script creates it and installs `-e ".[dev,dashboard]"`. `/workspace/.venv/bin` is prepended to `PATH` via `~/.bashrc`, so `ffa`, `sj`, `pytest`, and `ruff` work directly in a login shell; otherwise call them as `.venv/bin/<cmd>`.
- The base image ships Python 3.12 without `ensurepip`; `python3.12-venv` was apt-installed during environment setup (captured in the snapshot). If `python3 -m venv` ever fails with an ensurepip error, reinstall it: `sudo apt-get install -y python3.12-venv`.

### Lint (ruff version pin — important)
- `ruff` is pinned to the `0.5.x` line in `pyproject.toml` (`ruff>=0.5,<0.6`). The code lints clean under `0.5.x`, but `ruff` 0.6+/0.16 expands the default ruleset and flags ~77 stylistic issues (B/I/UP/SIM/RUF) that are version drift, not real regressions (this once broke CI). Run `ruff check .` (CI parity). Do not "fix" those by editing code or by loosening the pin.

### Tests
- `pytest` is fully offline (synthetic fixtures) — no `ffa ingest` needed. Run from repo root.

### ffa CLI / dashboard
- Most `ffa` commands (`score`, `project`, `simulate`, `rank`, `optimize`, `draft-sim`, `backtest`, `dashboard`) need ingested data first: `ffa ingest --season 2023 --season 2024` writes Parquet to `data/raw/` (requires network to nflverse via `nflreadpy`). `data/` is gitignored, so re-ingest after a fresh VM. Configs live in `configs/*.yaml`.
- `ffa dashboard` launches Streamlit (the `[dashboard]` extra is installed) and needs ingested data.

### Hub web app (`apps/web`)
- Run with `npm run dev` (Next.js + Turbopack on `http://localhost:3000`). See `HUB.md` for full setup.
- For local dev without Google OAuth, create `apps/web/.env.local` with `AUTH_DEV_BYPASS=1` (plus any `AUTH_SECRET`) to skip login entirely. With bypass off, only `ALLOWED_EMAILS` Google accounts can sign in.
- Data source: the app reads `data/sj/` if present, otherwise falls back to committed `fixtures/sj/` sample snapshots — so the UI works offline with no ESPN sync. Live data requires the `sj sync` CLI with ESPN cookies (`ESPN_S2`/`ESPN_SWID`); not needed for browsing fixtures.
