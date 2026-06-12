# ffa: fantasy football analytics, rebuilt

A modern replacement for the R scripts in this repo. The whole proposed
rebuild is in:

1. **Ingest + scoring engine** -- nflverse data and pure-function scoring
   driven by YAML league configs.
2. **Baseline projection model** -- recency-weighted per-game stats with
   optional depth-chart adjustment.
3. **Distributional projections** -- weighted block bootstrap over game
   rows produces a joint posterior over stats; risk and confidence
   intervals are quantiles of the resulting fantasy point distribution.
4. **VOR + tiers + roster optimizer + Monte Carlo draft sim** -- all
   consuming the posterior from phase 3.
5. **Learned per-stat generator** -- sklearn gradient boosting on
   prior-season features; drop-in replacement for the bootstrap with
   the same downstream contract.
6. **Quantile-calibrated generator** -- per-(position, stat, quantile)
   regressors plus PIT (probability integral transform) to calibrate
   marginal tails while preserving cross-stat correlations.
7. **Streamlit dashboard + GitHub Actions nightly refresh** -- one
   command to launch the UI; one workflow to keep the warehouse fresh.

## Why this exists

The legacy R pipeline depends on scraping ~15 projection sites whose HTML
shifts every season. This package replaces that with a single ingest from
[nflverse](https://github.com/nflverse) (via `nfl_data_py`) and a pure
scoring engine driven by a YAML league config -- so the data layer stops
breaking and league variants stop being code changes.

## Quick start

```bash
cd fantasy-sports
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
ffa rank --season 2025 --league configs/ppr.yaml --samples 1000 --tiers 5

# ILP-optimal lineup under an auction budget
ffa optimize --season 2025 --league configs/ppr.yaml --budget 200 --costs costs.csv

# Monte Carlo draft from slot 7 in a 12-team snake draft
ffa draft-sim --season 2025 --league configs/ppr.yaml --slot 7 --sims 500

# Streamlit dashboard (requires the dashboard extra)
pip install -e ".[dashboard]"
ffa dashboard --season 2025 --league configs/ppr.yaml
```

To host the dashboard for your league, see [DEPLOY.md](DEPLOY.md) -- one
URL, password-gated, Cloud Run, ~$0/month for a 10-15 person league.

## Layout

```
fantasy-sports/
  configs/            League scoring YAMLs (standard, ppr, half_ppr, ...)
  src/ffa/
    league.py         Pydantic schema; load_league(path) -> LeagueConfig
    scoring.py        Pure: score_player_weeks(stats_df, league) -> Series
    projection.py     project_per_game / project_season + depth-chart helpers
    simulation.py     simulate_seasons / summarize_seasons (bootstrap posterior)
    learned.py        LearnedGenerator + simulate_seasons_learned drop-in
    quantile.py       QuantileGenerator + simulate_seasons_quantile_calibrated
    ranking.py        compute_vor + assign_tiers
    optimize.py       optimize_lineup (PuLP ILP), greedy_lineup
    draft.py          simulate_draft (Monte Carlo snake) + summarize_user_picks
    dashboard.py      Streamlit UI (rankings, distributions, optimizer, draft)
    ingest.py         nfl_data_py -> Parquet; DuckDB views over the Parquet
    cli.py            `ffa ingest|score|project|simulate|rank|optimize|draft-sim|dashboard`
  tests/              Pytest; runs offline on synthetic frames
.github/workflows/
  refresh.yml         Scheduled nflverse ingest + posterior write
  tests.yml           Ruff + pytest on pushes to main and every PR
```

## Design notes

- **Scoring is a pure function.** `score_player_weeks` takes a DataFrame and a
  `LeagueConfig`, returns a Series, and never mutates its input. League
  variants (PPR, half-PPR, bonuses, 6pt pass TDs) are pure data; no `if
  league.name == "ppr"` branches anywhere in the code.
- **Stat column names match `nfl_data_py.import_weekly_data`.** Missing
  columns are silently treated as zero so the same engine scores both
  per-game actuals and projection frames that only carry a subset of stats.
- **Postseason rows are excluded from modeling.** When the weekly frame
  carries a `season_type` column, projections and simulations use `REG`
  rows only -- playoff games would otherwise skew recent-history weights
  for players on deep playoff runs. `ffa score` still scores any ingested
  week, playoffs included.
- **Storage is Parquet + DuckDB views.** The `.duckdb` file is tiny; the data
  lives in Parquet on disk, refreshable via `ffa ingest` and inspectable by
  any tool that speaks Parquet.

## Projection model (phase 2)

`project_per_game(weekly_df, target_season, lookback=3, decay=0.5)` returns
recency-weighted per-game stats. The weight for season `s` is
`exp(-decay * (target_season - s))`, applied to both the stat totals and the
game count -- so a player who only suited up for 5 games gets proportionally
less pull than someone who played a full year, but recent seasons still
dominate.

`apply_depth_multiplier(projections, depth_chart)` is an opt-in role shift:
multiply per-game stats by a position/depth-slot factor (e.g. WR4 -> 0.25).
Useful when a player's role is changing for the upcoming season; not a
default, because recency-weighted projections already reflect past roles.

`project_season(per_game, expected_games=17.0)` produces season totals;
`expected_games` may be a Series for per-player injury overrides.

## Distributional projections (phase 3)

`simulate_seasons(weekly, target_season, n_samples=1000, ...)` produces a
*joint* posterior over a player's stats by **weighted block bootstrap**:

1. Take the player's game-level rows from the lookback window.
2. Weight each row by `exp(-decay * age_in_seasons)`.
3. Sample `expected_games` rows with replacement, weighted by recency.
4. Sum each draw to get one simulated season total -- repeat `n_samples`
   times to fill the posterior.

Because the unit of sampling is a *whole game row*, cross-stat
correlations (pass yds <-> pass TDs, rush att <-> rush yds) are preserved
without estimating a covariance matrix or copula. Heavy-tailed stats
(TDs) come out skewed for free.

The output is a long DataFrame `(player_id, sample_idx, ...stats...)`
with one row per simulated season. The pure scoring engine
`score_player_weeks` runs on the whole frame in one call, so:

```python
summary = summarize_seasons(samples, league)
# columns: player_id, [meta], points_mean, points_sd, q05, q25, q50, q75, q95
```

Risk-style metrics (floor, ceiling, sharpe-of-points) are intentionally
*derivable* from those columns rather than pre-computed -- different
leagues weight downside vs upside differently.

### Why this and not LightGBM?

A learned per-stat model (LightGBM, hierarchical Bayes) is the natural
next upgrade. It would *condition* the sampling distribution on features
(age, team change, opponent strength, snap share). For now, the
nonparametric bootstrap:

- has no new heavy dependency,
- preserves correlations automatically,
- captures skewness from real game-level data,
- and produces the same downstream contract (long DataFrame of
  samples), so swapping in a learned generator later is a drop-in.

## VOR, tiers, and the ILP optimizer (phase 4)

`compute_vor(summary, roster)` makes points comparable across positions
by subtracting the replacement-level baseline. Replacement at position
`p` is the projection of the player whose within-position rank equals
`teams * (starters[p] + flex_share)`, so the math respects flex slots
without double-counting.

`assign_tiers(summary, n_tiers=5)` partitions each position's players
at the largest consecutive point gaps. Interpretable -- a tier always
corresponds to a visible step in the sorted projections -- and the only
parameter is the tier count.

`optimize_lineup(values, roster, costs=None, budget=None)` solves an
ILP via PuLP: maximize total `vor` (or any value column) subject to
slot counts, flex eligibility (RB/WR/TE), and an optional budget when
costs are supplied. With no budget the ILP collapses to "take the top
players at each slot" (and `greedy_lineup` does the same without PuLP).

`simulate_draft(values, roster, user_slot, n_sims=500)` Monte Carlo
snake draft. Opponents pick by ADP plus log-normal noise; the user
picks the highest-VOR player that fills a remaining roster slot. Returns
both the user's per-sim picks and the per-player availability matrix
("probability X is on the board at my next pick") -- the right input
for planning two picks ahead.

## Learned generator (phase 5)

The phase-3 bootstrap can't extrapolate: a player's projection is the
recency-weighted mean of their own past. The learned generator
addresses that by fitting per-(position, stat) regressors on prior-
season features:

    last_season_per_game[stat]    last_season_games_played
    two_seasons_ago_per_game      weighted_career_per_game
    career_games_in_window

At sample time, predict each player's per-game mean for the target
season, scale the player's historical game rows multiplicatively so
their mean matches the prediction, then bootstrap-sample as before.
This preserves the within-player variability structure (skewness,
inter-stat correlation) while letting the model pull predictions
toward what the cohort actually does after a feature profile like the
player's.

`simulate_seasons_learned` is a drop-in for `simulate_seasons`:

    samples = simulate_seasons_learned(weekly, target_season=2025, n_samples=1000)
    summary = summarize_seasons(samples, league_config)

CLI:

    ffa simulate --learned --season 2025 --league configs/ppr.yaml

**Honest caveat.** With just a few seasons of nflverse weekly data the
learned model has limited room to outperform the recency-weighted
bootstrap. The value is the *pattern*: with more features (snap share,
opponent rank, depth-chart shifts, age) the same architecture starts
beating the bootstrap. Multiplicative scaling means stats a player has
never produced stay at zero -- the right behavior unless and until you
add a feature that says otherwise.

## Quantile-calibrated generator (phase 6)

The phase-5 learned generator uses squared-error loss, so its sample
means are calibrated but its tails inherit whatever shape the player's
history happened to have. The phase-6 generator addresses that:

    1. Per (position, stat) and per quantile in (0.1, 0.5, 0.9), fit a
       sklearn `GradientBoostingRegressor(loss="quantile")`.
    2. Predict each player's marginal stat quantiles. Sort across
       quantile levels per player to enforce q10 <= q50 <= q90 (sklearn
       fits each level independently and they can cross with limited data).
    3. PIT-transform the player's historical game rows: each value is
       mapped to the linear interpolation of the predicted quantile
       function at its empirical CDF rank.
    4. Bootstrap-sample whole transformed rows as in phase 3.

PIT is rank-preserving within each stat and sampling is row-wise, so
cross-stat correlations (passing yds <-> passing TDs, rush att <-> rush
yds) survive from the player's own history. The *marginals* are
calibrated to the model's predicted quantiles; the *copula* is the
player's own.

CLI:

    ffa simulate --generator quantile --season 2025 --league configs/ppr.yaml

## Dashboard + scheduled refresh (phase 7)

A Streamlit dashboard sits on top of the same library:

    pip install -e ".[dashboard]"
    ffa dashboard --season 2025 --league configs/ppr.yaml

Tabs: ranked board (VOR + tiers, position filter); per-player
distribution (floor / median / ceiling + histogram); ILP lineup
optimizer with optional auction budget; Monte Carlo draft sim with
pick-rate table.

Two GitHub Actions workflows ship in `.github/workflows/`:

- `tests.yml`: runs `ruff` + `pytest` on pushes to main and every PR.
- `refresh.yml`: scheduled (weekday mornings during NFL season) and
  manual; ingests the current season + lookback from nflverse, computes
  the posterior summary under PPR and Standard, and uploads the Parquet
  files as build artifacts.

## What's next, post-phase-7

- Per-position joint-distribution learning (deep generator over stat
  vectors so the *copula* stops being purely the player's own).
- Schedule-aware adjustments: opponent defense rank, bye-week handling,
  injury-status updates from the rosters table.
- Pricing the dashboard's outputs against historical mocks so the
  optimizer's expected lineup gets calibrated against realized draft
  results, not just the model's posterior.
