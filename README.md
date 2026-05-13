# fantasy-sports

A posterior-driven fantasy analytics pipeline. The first sport in is
**football** (`ffa` package), built end-to-end from nflverse ingest
through draft simulation. The repo is named `fantasy-sports` because the
plan is to factor out a sport-agnostic core when sport #2 arrives --
until then the football pieces stay at the root, no premature
abstraction.

## What's in

1. **Ingest + scoring engine** -- nflverse data via `nfl_data_py`, written
   to Parquet, registered as DuckDB views. Pure-function scoring from a
   YAML league config.
2. **Baseline projection** -- recency-weighted per-game stats with
   optional depth-chart role shift.
3. **Distributional projections** -- weighted block bootstrap over game
   rows produces a joint posterior over stats; risk and confidence
   intervals fall out as quantiles.
4. **VOR + tiers + ILP roster optimizer + Monte Carlo draft sim** -- all
   consuming the same posterior.
5. **Learned generator** -- sklearn gradient-boosted regressors over
   prior-season features; drop-in replacement for the bootstrap.
6. **Quantile-calibrated generator** -- per-(position, stat, quantile)
   regressors + probability integral transform so marginal tails are
   calibrated while cross-stat correlations are preserved.
7. **Streamlit dashboard + GitHub Actions nightly refresh.**

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# Run the test suite (no network required)
pytest

# Pull two seasons of weekly stats
ffa ingest --season 2023 --season 2024

# Score 2024 week 5 under PPR rules, top 25
ffa score --league configs/ppr.yaml --season 2024 --week 5

# Baseline 2025 projection from the last 3 seasons, scored under PPR
ffa project --season 2025 --lookback 3 --league configs/ppr.yaml

# Distributional projection: mean / sd / 5-95 quantiles per player
ffa simulate --season 2025 --league configs/ppr.yaml --samples 1000

# Pick a generator: bootstrap (phase 3), learned (phase 5), quantile (phase 6)
ffa simulate --season 2025 --league configs/ppr.yaml --generator quantile

# VOR + tiers across positions, posterior-driven
ffa rank --season 2025 --league configs/ppr.yaml --tiers 5

# ILP-optimal lineup under an auction budget
ffa optimize --season 2025 --league configs/ppr.yaml --budget 200 --costs costs.csv

# Monte Carlo draft from slot 7 in a 12-team snake draft
ffa draft-sim --season 2025 --league configs/ppr.yaml --slot 7 --sims 500

# Streamlit dashboard
pip install -e ".[dashboard]"
ffa dashboard --season 2025 --league configs/ppr.yaml
```

## Layout

```
configs/             League scoring YAMLs (standard, ppr, half_ppr, ...)
src/ffa/
  league.py          Pydantic schema; load_league(path) -> LeagueConfig
  scoring.py         Pure: score_player_weeks(stats_df, league) -> Series
  projection.py      project_per_game / project_season + depth-chart helpers
  simulation.py      simulate_seasons / summarize_seasons (bootstrap posterior)
  learned.py         LearnedGenerator + simulate_seasons_learned drop-in
  quantile.py        QuantileGenerator + simulate_seasons_quantile_calibrated
  ranking.py         compute_vor + assign_tiers
  optimize.py        optimize_lineup (PuLP ILP), greedy_lineup
  draft.py           simulate_draft (Monte Carlo snake) + summarize_user_picks
  dashboard.py       Streamlit UI
  ingest.py          nfl_data_py -> Parquet; DuckDB views over the Parquet
  cli.py             `ffa ingest|score|project|simulate|rank|optimize|draft-sim|dashboard`
tests/               Pytest; runs offline on synthetic frames
.github/workflows/
  tests.yml          Run pytest on push/PR
  refresh.yml        Scheduled nflverse ingest + posterior write
```

## Adding a new sport

When sport #2 arrives (NBA, MLB, ...), the plan is to:

1. Carve out the sport-agnostic core: `scoring`, `ranking`, `optimize`,
   `draft`, `simulation`, `learned`, `quantile`. The math doesn't change
   across sports -- only the stat columns and ingest source do.
2. Move the football-specific bits (stat names, nflverse ingest,
   `LeagueConfig.passing/rushing/receiving` blocks) into `sports/football/`.
3. Add `sports/basketball/` (or whichever) with the same interface:
   an ingest module, a stat-name registry, and league config rules.

Not doing that today because the right abstraction is hard to guess from
one example. Two real sports is when the boundary becomes obvious.

## Design notes

- **Scoring is a pure function.** `score_player_weeks(stats_df, league)`
  takes a DataFrame and returns a Series. No mutation, no I/O.
- **All three generators emit the same long DataFrame.** Same downstream
  pipeline (`summarize_seasons`, `compute_vor`, `optimize_lineup`,
  `simulate_draft`) works on bootstrap / learned / quantile output.
- **Storage is Parquet + DuckDB views.** The `.duckdb` file is tiny;
  data lives in Parquet on disk, rebuildable from `ffa ingest`.
- **`ffa dashboard` is a thin presentation layer.** All analysis logic
  lives in the library, not the UI.

## License

GPL-3.0 (inherited from the original FantasyFootballAnalyticsR work
this rebuild was inspired by).
