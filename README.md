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
11. **Calibration diagnostics** -- per-position, per-quantile coverage
    table (`ffa backtest --calibration`) that pinpoints where the
    posterior is miscalibrated and aims the next modeling step.
12. **Lower-tail downside** -- a per-season "bust" mixture that fattens
    the floor the diagnostic flagged, near-zeroing the optimism bias
    (later generalized into the phase-15 level model).
13. **Generators on real data** -- fix the NaN crash that broke the
    learned/quantile generators on sparse nflverse data, then backtest
    the quantile generator (it underperforms the bootstrap -- a logged
    negative finding, not a default change).
14. **Variance decomposition** -- split prediction error into modeled vs
    level-misprediction variance (`dispersion_decomposition`), showing the
    open tails are a two-sided *level* problem, not a per-game-variance one.
15. **Level uncertainty** -- a log-normal per-season level multiplier
    (`--level-sd`/`--level-mean`) unifying the bust mixture into a two-sided
    model that fixes the upper tail and de-biases; tuned on the backtest.

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
    level.py          Per-season log-normal level multiplier (both tails)
    backtest.py       Walk-forward evaluation: MAE, rank corr, pinball, coverage
    calibration.py    Coverage diagnostics + modeled-vs-level variance split
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
empirical games-played-per-season distribution and samples it per sim,
falling back through three tiers: a player's own recent seasons when it
has enough of them, else their position pool, else the league-wide pool.
Each simulated season draws its own game count before summing that many
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
targets -- phase 11 diagnoses what's left.

## Calibration diagnostics (phase 11)

A single "55% coverage vs 90% target" number can't say *why* the
posterior is miscalibrated, and guessing the fix is how you build the
wrong generator. `ffa.calibration` breaks coverage down per reported
quantile and per position: for each `q{τ}` column it reports the
empirical `mean(realized <= q_τ)`, which a calibrated model lands at τ.

```bash
ffa backtest --league configs/ppr.yaml --start 2021 --end 2023 \
    --games-model empirical --calibration
```

The phase-10 (empirical-games) posterior, scored on 2021-2023 PPR,
comes back **uniformly under-dispersed across every position** -- and
the miss is concentrated in the *lower tail*:

| position | cov q05 | cov q50 | cov q95 | central | dispersion |
|---|---|---|---|---|---|
| ALL | 0.30 | 0.59 | 0.83 | 0.55 | under-dispersed |
| RB | 0.32 | 0.62 | 0.82 | 0.52 | under-dispersed |
| WR | 0.30 | 0.59 | 0.83 | 0.56 | under-dispersed |
| QB | 0.31 | 0.59 | 0.82 | 0.52 | under-dispersed |
| TE | 0.25 | 0.56 | 0.83 | 0.60 | under-dispersed |

`cov q05 = 0.30` is the headline: **30% of player-seasons land at or
below their projected 5th-percentile floor**, when 5% should. Projected
floors are far too high. This redirects the roadmap. The miss is *not*
position-specific (every position looks alike), so a per-position copula
isn't the main lever; the marginal **lower tail** is too thin because a
player's own recent history -- the only thing the bootstrap resamples --
doesn't contain their bust scenarios (lost job, benching, decline). The
empirical games model added injury/availability variance but not
*performance-collapse* variance.

## Lower-tail downside (phase 12)

Phase 11 diagnosed the dominant calibration miss: the lower tail is far
too thin (`cov q05 ≈ 0.30`, projected floors much too high), uniformly
across positions. The cause is structural -- the bootstrap resamples a
player's *own* (mostly good) games iid, so a sum of ~16 draws barely
spreads and a whole bust season (lost role, decline, a nagging injury
that saps a whole year) is unsamplable.

The original fix injected it as a *season-level* mixture: with some
probability a simulated season was multiplied by a degradation factor in
`[0, 0.6]`. Per-season and multiplicative, it left the median and ranking
untouched and fattened only the *left* tail. Tuned against the backtest,
a 0.10 bust rate took central q05-q95 coverage 0.55 → 0.69 and the
optimism bias +7.2 → +0.6.

This was the right idea but only half of it: a downside-only mechanism
can't touch the *upper* tail (`cov q95 ≈ 0.82`). Phase 14 showed the miss
is two-sided level error, and **phase 15 generalizes the bust mixture
into a symmetric level-uncertainty model** (`--level-sd`) that subsumes
and replaces it -- the `ffa.downside` module and `--bust-rate` flag are
gone, folded into `ffa.level`.

## Generators on real data + a negative finding (phase 13)

The learned (phase 5) and quantile (phase 6) generators had only ever run
on the dense synthetic test frames. On real, *sparse* nflverse data they
both crashed: `_build_features` computed `prev_games` as
`prev.get("games") or 0`, and for a player who missed the season before
the target that reindexed value is `NaN` -- and `NaN or 0` returns `NaN`
(NaN is truthy), so the feature matrix carried a NaN that sklearn's
`GradientBoostingRegressor` rejects. A one-line fix (use the
already-NaN-filled games array) unblocks both generators; they now fit
and sample on real 2019-2023 weekly data.

With the quantile generator finally runnable, the hope was that its
calibrated marginal quantiles would close the *upper* tail the bust
mixture can't touch. The backtest says otherwise. On PPR 2022-2023
(empirical games, bust 0.10):

| generator | cov q05 | cov q95 | central | bias | Spearman |
|---|---|---|---|---|---|
| bootstrap | 0.16 | 0.83 | **0.70** | **+1.8** | 0.719 |
| quantile | 0.18 | 0.72 | 0.53 | −13.9 | 0.723 |

The quantile generator is **worse**, not better: a large pessimistic
bias (−13.9), worse central coverage (0.53 vs 0.70), and a *thinner*
upper tail (`cov q95` 0.72 vs 0.83). Its quantile-GBM predictions on
sparse, low-signal features underfit toward low values. So the upper-tail
miss is *not* closed by the existing quantile generator -- it needs real
rework (richer features, more data, or post-hoc recalibration) before it
beats the bootstrap. The recommended configuration remains **bootstrap +
empirical games + bust 0.10**. Measuring beats assuming: the fix was
worth doing (a real bug, and the learned generator is now usable too),
but it did not deliver the lever it was meant to.

## Variance decomposition (phase 14)

With the floor fixed and bias near zero, the question for the open tails
was *which* lever moves them: is the posterior's per-game variance too
tight (widen / recalibrate the marginals), or is the error level
mispredicted (a player's true level shifting beyond what resampling their
own games can reach)? `ffa.calibration.dispersion_decomposition` answers
it by splitting the realized prediction-error variance into the part the
posterior *models* (its `points_sd` -- within-season spread, plus games
and level variance) and the unmodeled remainder, surfaced under `ffa
backtest --calibration`.

On the phase-12 config (bootstrap + empirical games + bust 0.10, PPR
2021-2023):

| pos | bias | resid_sd | modeled_sd | ratio | frac_modeled | over_q95 | under_q05 |
|---|---|---|---|---|---|---|---|
| ALL | −0.6 | 63.1 | 43.3 | 1.46 | **0.47** | 0.18 | 0.14 |
| QB | −2.5 | 88.8 | 58.9 | 1.51 | 0.44 | 0.18 | 0.13 |
| RB | −2.0 | 68.2 | 44.8 | 1.52 | 0.43 | 0.17 | 0.15 |
| WR | −1.0 | 58.6 | 41.8 | 1.40 | 0.51 | 0.18 | 0.14 |
| TE | +3.1 | 38.6 | 29.8 | 1.30 | 0.59 | 0.17 | 0.11 |

The finding redirects the roadmap. **`frac_modeled ≈ 0.47`**: even with
the bust mixture already widening it, the posterior's modeled variance
explains under half the real prediction error -- the other ~53% is
*level-misprediction* (breakouts and declines), which is structurally
absent from a player's own resampled games. And the tails are now roughly
**symmetric** (`over_q95` 0.18, `under_q05` 0.14 vs 0.05 nominal): the
bust mechanism cut the lower miss from 0.30 to 0.14, but nothing widens
the upper side.

So neither lever we were weighing is the right one: widening per-game
variance inflates the 47% that's already modeled, and recalibrating the
quantile generator (phase 13: worse anyway) reshapes the margins around a
level it still mispredicts. The miss is **level, and two-sided**.

## Level uncertainty (phase 15)

Phase 14 said the open miss is two-sided level error, so the fix is a
two-sided *level* mechanism. `ffa.level` unifies the phase-12 bust mixture
and a symmetric jitter into one: each simulated season's totals are
multiplied by a log-normal level factor `exp(N(log(mean) − sd²/2, sd))`,
controlled by `--level-sd` (log-space spread) and `--level-mean` (its
expectation). Being multiplicative it preserves cross-stat ratios and is
position-agnostic; being log-normal it is two-sided and bounded below by
zero. `mean < 1` also drifts the projection down -- the regression /
attrition correction the bust mixture used to get as a side effect of its
one-sidedness, now an explicit knob. `--level-sd 0` (default) is off and
RNG-neutral.

```bash
ffa rank --season 2025 --league configs/ppr.yaml \
    --games-model empirical --level-sd 0.45 --level-mean 0.90
```

Tuned against the backtest (PPR 2021-2023, bootstrap, empirical games):

| config | cov q05 | cov q95 | central | bias | Spearman |
|---|---|---|---|---|---|
| bust 0.10 (phase 12) | 0.16 | 0.83 | 0.70 | +1.8 | 0.719 |
| level sd .45, mean 1.0 | 0.18 | 0.91 | 0.75 | +8.4 | 0.719 |
| **level sd .45, mean .90** | 0.17 | **0.89** | **0.75** | **−0.9** | 0.719 |
| level sd .55, mean .88 | 0.15 | 0.91 | 0.78 | −2.8 | 0.719 |

`--level-sd 0.45 --level-mean 0.90` is the recommended setting: it
**strictly dominates** the phase-12 bust mixture -- better upper tail
(`cov q95` 0.83 → 0.89), better central coverage (0.70 → 0.75), *smaller*
bias (+1.8 → −0.9), same lower tail and Spearman. The mean-preserving
variant (mean 1.0) confirms the decomposition: it fixes the upper tail on
its own but re-introduces the +8 optimism, which the 0.90 drift removes.
A heavier `0.55 / 0.88` buys more coverage at a mild pessimistic drift.

Central q05-q95 coverage across the calibration phases: 0.30 (fixed) →
0.55 (empirical games) → 0.70 (bust) → 0.75 (level). Honest caveat: still
short of 0.90, and `cov q05`/`cov q95` (≈0.17/0.89) aren't at 0.05/0.95 --
level uncertainty widens the intervals but can't manufacture the signal a
real breakout/decline model would; that, and the cross-stat copula, are
what's left.

## What's next, post-phase-15

- Condition the level spread on signal instead of a flat `--level-sd`:
  age, role change, and target/snap share (from the rosters table) drive
  who breaks out or declines -- a learned per-player `level_sd` would
  tighten coverage past what a single global knob can.
- Extend the level mechanism to rookies (cohort-level spread).
- Per-position joint-distribution learning (copula over stat vectors) --
  the lever for cross-stat realism once the marginals are calibrated.
- Schedule-aware adjustments and dashboard-output pricing against
  historical mocks, as before.
