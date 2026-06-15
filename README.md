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
8. **Walk-forward backtesting** -- project each holdout season from
   strictly-prior data and score accuracy (MAE, rank correlation) and
   calibration (pinball loss, interval coverage) per generator.
9. **Rookie cohort projections** -- draft-capital block bootstrap so
   first-year players stop being invisible; opt in with `--include-rookies`.
10. **Empirical games-played model** -- sample each sim's game count from
    a player's history instead of assuming 17, cutting the optimism bias;
    opt in with `--games-model empirical`.

## Why this exists

The legacy R pipeline depends on scraping ~15 projection sites whose HTML
shifts every season. This package replaces that with a single ingest from
[nflverse](https://github.com/nflverse) (via `nflreadpy`, the maintained
client) and a pure scoring engine driven by a YAML league config -- so the
data layer stops breaking and league variants stop being code changes.
Ingest normalizes nflverse's column names to a canonical schema and
validates them, so an upstream rename fails loudly at the boundary instead
of silently scoring a stat as zero.

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

# Walk-forward backtest: how good are the projections, really?
ffa backtest --league configs/ppr.yaml --start 2023 --end 2024 \
    --generator bootstrap --generator learned

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
    rookies.py        Draft-cohort block bootstrap for first-year players
    games.py          Empirical games-played model + masked season bootstrap
    backtest.py       Walk-forward evaluation: MAE, rank corr, pinball, coverage
    dashboard.py      Streamlit UI (rankings, distributions, optimizer, draft)
    ingest.py         nflreadpy -> normalize + validate -> Parquet; DuckDB views
    cli.py            `ffa ingest|score|project|simulate|rank|optimize|draft-sim|backtest|dashboard`
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
- **Stat column names are the canonical nflverse names**, normalized at
  ingest from `nflreadpy.load_player_stats` (which renamed e.g.
  `interceptions` -> `passing_interceptions` and `recent_team` -> `team`).
  Missing columns are silently treated as zero *in scoring* so the same
  engine scores both per-game actuals and projection frames that carry only
  a subset of stats -- but `ffa.ingest.validate_weekly_schema` rejects a
  full pull that's missing them, so a future rename surfaces at ingest.
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

## Backtesting (phase 8)

Every modeling claim above is testable one way: project a season using
only data available beforehand, compare against what happened. `ffa
backtest` walks forward over holdout seasons doing exactly that:

    ffa backtest --league configs/ppr.yaml --start 2023 --end 2024 \
        --generator bootstrap --generator learned --generator quantile

For each (generator, holdout season) it slices history strictly before
the holdout, runs the generator, and joins the posterior summary against
realized regular-season totals. Metrics per season and per position:

- **mae / rmse / bias** -- error of the posterior mean in fantasy
  points. Positive bias = optimistic: the fixed `--expected-games 17`
  assumption shows up here, since real players miss games.
- **spearman** -- rank correlation of projected vs realized points.
  Drafts consume ranks, so this is the headline accuracy number.
- **pinball_qXX** -- quantile loss per reported quantile column; the
  proper score for whether `q95` behaves like a real 95th percentile.
- **cover_q05_q95 / cover_q25_q75** -- fraction of players whose
  realized points landed inside the interval (nominal 90% / 50%).
- **n_unprojected** -- players who scored in the holdout season but
  were never projected (no history: rookies, mostly). The size of the
  model's blind spot, reported instead of silently dropped.

`--min-games` defaults to 1: injury-shortened seasons are real downside
outcomes the posterior should cover, so excluding them inflates
calibration. `--out` writes the player-level projected-vs-realized rows
to Parquet for deeper slicing; the same machinery is available as
`ffa.run_backtest(...)` for notebooks.

Note the learned/quantile generators need `lookback + 2` seasons of
ingested history before the first holdout season (the pad covers their
training pairs); the CLI computes and reports the required range.

## Rookie projections (phase 9)

The veteran generators project a player from their own past, so a
first-year player with no NFL history is dropped -- the draft tool can't
see exactly the players a draft turns on. `ffa.rookies` fills that hole
with the same block bootstrap, sourced from a *draft cohort* instead of
the player's own history:

1. Bucket the incoming rookie by position and draft round (R1, R2, R3, R4+).
2. Pool every prior-class rookie-season game row in that cohort.
3. Bootstrap-sample whole rows and sum -- one simulated season.

Whole-row sampling preserves cross-stat correlation and skew, and the
spread across a cohort (busts next to breakouts) becomes the rookie's
floor-to-ceiling range. Output is the same long sample contract every
generator returns, so rookie samples concatenate onto veteran samples
and flow through scoring / VOR / tiers / draft-sim unchanged. Add them
anywhere with `--include-rookies`:

```bash
ffa rank --season 2025 --league configs/ppr.yaml --include-rookies
ffa backtest --league configs/ppr.yaml --start 2023 --include-rookies
```

Draft capital is the only signal -- coarse, but the one that most
separates rookie outcomes and the only one available before a snap.
Backtested on 2023 (PPR), turning rookies on cut the unprojected blind
spot from 131 players to 63 with no loss of aggregate accuracy; the
high-capital rookies land close (C.J. Stroud projected 239 vs 276
realized, Bijan Robinson 254 vs 246), while a fifth-round Puka Nacua
gets a sensible cohort baseline and his historic breakout stays
(correctly) unforecast. Cohort pools for a target season use only prior
draft classes, so the backtest stays leakage-free.

## Games-played model (phase 10)

Every generator builds a season by summing a fixed `expected_games`
(default 17) bootstrapped game rows -- it projects a full healthy season
for everyone. That is the single clearest bias the backtest exposes: a
large positive mean error (real players miss time) and intervals far too
narrow to cover reality (a season cut short by injury is a downside the
posterior never samples).

`ffa.games` makes season length stochastic. `GamesModel` learns an
empirical games-played-per-season distribution -- a player's own recent
seasons when it has enough of them, else their position pool -- and each
simulated season draws its own game count before summing that many
bootstrapped rows (`bootstrap_season_totals` does the masked sum). Turn
it on with `--games-model empirical`:

```bash
ffa rank --season 2025 --league configs/ppr.yaml --games-model empirical
ffa backtest --league configs/ppr.yaml --start 2021 --end 2023 \
    --generator bootstrap --games-model empirical
```

It is orthogonal to the generator choice (bootstrap / learned /
quantile all take `games_model`) and to rookies. The default stays
`"fixed"`: with a constant game count the masked sum reduces to the old
`matrix[idx].sum(axis=1)` bit-for-bit, so prior behavior is reproduced
exactly when the model is off.

Backtested on 2021-2023 (PPR, bootstrap), switching from fixed to
empirical games:

| metric | fixed | empirical |
|---|---|---|
| MAE | 63.4 | **46.4** |
| bias | +46.5 | **+7.2** |
| q05-q95 coverage | 0.30 | **0.55** |
| q25-q75 coverage | 0.14 | **0.29** |

The optimism bias nearly vanishes, MAE drops ~27%, and interval coverage
almost doubles toward nominal. Coverage still sits below the 90% / 50%
targets -- the remaining gap is per-game stat variance, which the joint
generator below is meant to address -- but the season-length fix is the
large first step.

## What's next, post-phase-10

- Per-position joint-distribution learning (deep generator over stat
  vectors so the *copula* stops being purely the player's own) -- the
  main lever left on interval coverage.
- Extend the empirical games model to rookies (cohort games-played) and
  blend it with snap-share / injury-status signals from the rosters and
  injuries tables.
- Schedule-aware adjustments: opponent defense rank, bye-week handling,
  injury-status updates from the rosters table.
- Pricing the dashboard's outputs against historical mocks so the
  optimizer's expected lineup gets calibrated against realized draft
  results, not just the model's posterior.
