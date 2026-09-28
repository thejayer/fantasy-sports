# Hockey value model backtest (HOCKEY-PORT.md H2b)

Regenerate with `sj nhl-backtest` (NHL API responses cached under `data/nhl_cache`).
The tables below describe the **shipped** model: the H2b-tuned weights. The first run,
which compared Rinkside's original weights with the tuned ones, is kept at the end.

Seasons: 20222023, 20232024, 20242025, 20252026 · checkpoints: preseason, dec1, feb1 · scored under SJ Hockey rules.
Every NHL player with enough games in the scored window (preseason/Dec 1: 20+ GP, Feb 1: 15+). Errors are fantasy points per game, games-weighted. Bias = predicted − actual (positive = optimistic).

ESPN's historical projections are not available, so the ESPN-projection
input (30% of the live blend) is not measured here.

## Shipped defaults vs tuned

| slice | n | MAE (default) | MAE (tuned) | bias (default) | bias (tuned) | Spearman (default) | Spearman (tuned) |
|---|---|---|---|---|---|---|---|
| all | 8491 | 0.371 | 0.371 | 0.049 | 0.049 | 0.843 | 0.843 |
| preseason | 3084 | 0.383 | 0.383 | 0.054 | 0.054 | 0.830 | 0.830 |
| dec1 | 2876 | 0.353 | 0.353 | 0.045 | 0.045 | 0.857 | 0.857 |
| feb1 | 2531 | 0.373 | 0.373 | 0.040 | 0.040 | 0.843 | 0.843 |
| F | 5204 | 0.343 | 0.343 | 0.018 | 0.018 | 0.834 | 0.834 |
| D | 2699 | 0.283 | 0.283 | 0.051 | 0.051 | 0.811 | 0.811 |
| G | 588 | 1.312 | 1.312 | 0.432 | 0.432 | 0.338 | 0.338 |
| tier top 50 | 600 | 1.059 | 1.059 | 0.574 | 0.574 | 0.397 | 0.397 |
| tier 51–150 | 1200 | 0.421 | 0.421 | 0.095 | 0.095 | 0.490 | 0.490 |
| tier 151+ | 6691 | 0.314 | 0.314 | 0.004 | 0.004 | 0.731 | 0.731 |

## Leave-one-season-out

| held-out season | MAE (default) | MAE (tuned on the others) |
|---|---|---|
| 20222023 | 0.370 | 0.370 |
| 20232024 | 0.374 | 0.374 |
| 20242025 | 0.367 | 0.368 |
| 20252026 | 0.372 | 0.372 |

**Decision:** keep shipped defaults (average held-out gain -0.1%, improved 0/4 seasons; needs 2%+ and 3 of 4).

## Config

| knob | shipped | tuned |
|---|---|---|
| `recent` | 0.25 | 0.25 |
| `trailing_scale` | 0.50 | 0.50 |
| `season_base` | 0.50 | 0.50 |
| `season_full_gp` | 40 | 40 |
| `history_full_gp` | 80 | 80 |
| `history_decay` | [1.0, 0.5, 0.25] | [1.0, 0.5, 0.25] |
| `prospect_base` | 0.15 | 0.15 |
| `aging` | True | True |
| `role_adjust` | False | False |
| `durability_pull` | 0.40 | 0.40 |

## Durability (H3, preseason)

2016 player-seasons (2023–24 on; skaters with 40+ GP last season, goalies with a prior start share). Error is share of the season played.

| pull toward 90% | MAE |
|---|---|
| 0.0 | 0.162 |
| 0.2 | 0.159 |
| 0.4 (shipped, best) | 0.156 |
| 0.6 | 0.156 |
| 0.8 | 0.159 |

Bias at the shipped pull: 0.043 (positive = expects more games than were played).

In-season roles use each player's team for that season (the stats API does not
report team inside a date range), a small leak for players traded mid-season.

## Before H2b: the first run

Run on the same data with Rinkside's original weights as the defaults. The tuned
config won on every held-out season (−15% error on average) and was adopted.

### Rinkside originals (default) vs tuned

| slice | n | MAE (default) | MAE (tuned) | bias (default) | bias (tuned) | Spearman (default) | Spearman (tuned) |
|---|---|---|---|---|---|---|---|
| all | 8491 | 0.438 | 0.371 | 0.094 | 0.049 | 0.835 | 0.843 |
| preseason | 3084 | 0.440 | 0.383 | 0.122 | 0.054 | 0.824 | 0.830 |
| dec1 | 2876 | 0.438 | 0.353 | 0.064 | 0.045 | 0.842 | 0.857 |
| feb1 | 2531 | 0.431 | 0.373 | 0.070 | 0.040 | 0.843 | 0.843 |
| F | 5204 | 0.417 | 0.343 | 0.109 | 0.018 | 0.834 | 0.834 |
| D | 2699 | 0.326 | 0.283 | 0.053 | 0.051 | 0.800 | 0.811 |
| G | 588 | 1.438 | 1.312 | 0.158 | 0.432 | 0.272 | 0.338 |
| tier top 50 | 600 | 1.157 | 1.059 | 0.915 | 0.574 | 0.456 | 0.397 |
| tier 51–150 | 1200 | 0.613 | 0.421 | 0.401 | 0.095 | 0.374 | 0.490 |
| tier 151+ | 6691 | 0.348 | 0.314 | -0.029 | 0.004 | 0.718 | 0.731 |

### Leave-one-season-out

| held-out season | MAE (default) | MAE (tuned on the others) |
|---|---|---|
| 20222023 | 0.425 | 0.371 |
| 20232024 | 0.437 | 0.374 |
| 20242025 | 0.442 | 0.369 |
| 20252026 | 0.447 | 0.372 |

**Decision:** adopt tuned config (average held-out gain 15.0%, improved 4/4 seasons; needs 2%+ and 3 of 4).

### Config

| knob | shipped | tuned |
|---|---|---|
| `recent` | 0.50 | 0.25 |
| `trailing_scale` | 1.00 | 0.50 |
| `season_base` | 0.35 | 0.50 |
| `season_full_gp` | 25 | 40 |
| `history_full_gp` | 120 | 80 |
| `history_decay` | [1.0, 0.6, 0.35] | [1.0, 0.5, 0.25] |
| `prospect_base` | 0.15 | 0.15 |
| `aging` | True | True |
| `role_adjust` | True | False |
| `durability_pull` | 0.40 | 0.40 |
