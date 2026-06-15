"""Distributional projections via weighted block bootstrap.

For each player, treat their last ``lookback`` seasons of game-level stat
rows as the empirical sampling distribution. To simulate one season:

    1. Compute exponential recency weight per historical game row.
    2. Sample ``expected_games`` rows with replacement, weighted by recency.
    3. Sum stats across the sampled rows -> one simulated season total.

Repeat ``n_samples`` times per player to get a joint posterior over all
stats. Because we sample whole game rows, correlation between stats
(e.g. passing yards <-> passing TDs) is preserved automatically -- no
covariance matrix or copula is estimated.

Output is a "long" DataFrame: one row per (player, sample) so the
existing pure :func:`ffa.scoring.score_player_weeks` engine scores every
sample in one vectorized call.

This is the simplest model that produces honest stat distributions. The
natural next upgrade is to replace the empirical sampling distribution
with a learned one (LightGBM per stat, hierarchical Bayes, ...) while
keeping the same downstream contract.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Final

import numpy as np
import pandas as pd

from ffa.league import LeagueConfig
from ffa.projection import regular_season_only
from ffa.scoring import STAT_COLUMNS, score_player_weeks


_META_COLUMNS: Final[tuple[str, ...]] = (
    "player_name",
    "player_display_name",
    "position",
    "recent_team",
)

DEFAULT_QUANTILES: Final[tuple[float, ...]] = (0.05, 0.25, 0.5, 0.75, 0.95)


def _present(df: pd.DataFrame, cols: Iterable[str]) -> list[str]:
    return [c for c in cols if c in df.columns]


def simulate_seasons(
    weekly: pd.DataFrame,
    target_season: int,
    n_samples: int = 1000,
    lookback: int = 3,
    decay: float = 0.5,
    expected_games: float = 17.0,
    min_history_games: int = 4,
    stats: Iterable[str] = STAT_COLUMNS,
    seed: int | None = None,
) -> pd.DataFrame:
    """Bootstrap simulated season totals for every qualified player.

    Args:
        weekly: per-player per-game stats matching the canonical nflverse
            schema; must contain ``player_id``, ``season``, and ``week``.
        target_season: season being projected (excluded from history).
        n_samples: number of season simulations per player. 1000 is enough
            for stable 5/95 quantiles; bump to 5000+ for tail quantiles.
        lookback, decay: same semantics as :func:`ffa.projection.project_per_game`.
        expected_games: games to sample per simulated season; the integer
            ``round(expected_games)`` is used since it must be a sample count.
        min_history_games: drop players with fewer than this many history
            rows (recency-weighted history isn't used for filtering here --
            simply requiring N raw games avoids degenerate sampling pools).
        stats: stat columns to bootstrap. Missing columns are skipped.
        seed: pass an int for reproducible samples.

    Returns:
        Long DataFrame with columns ``player_id``, ``sample_idx``, each
        stat column carrying that sample's season total, plus available
        metadata (position, recent_team, player name).
    """
    required = {"player_id", "season", "week"}
    missing = required - set(weekly.columns)
    if missing:
        raise ValueError(f"weekly is missing required columns: {sorted(missing)}")

    weekly = regular_season_only(weekly)
    seasons = list(range(target_season - lookback, target_season))
    history = weekly[weekly["season"].isin(seasons)]
    stat_cols = _present(history, stats)
    if history.empty or not stat_cols:
        return pd.DataFrame(columns=["player_id", "sample_idx", *stat_cols])

    n_games = max(1, int(round(expected_games)))
    rng = np.random.default_rng(seed)

    meta_cols = _present(history, _META_COLUMNS)
    if meta_cols:
        meta_lookup = (
            history.sort_values(["player_id", "season", "week"])
            .groupby("player_id", as_index=False)
            .last()
            .set_index("player_id")[meta_cols]
        )
    else:
        meta_lookup = None

    out_frames: list[pd.DataFrame] = []
    for player_id, group in history.groupby("player_id", sort=False):
        if len(group) < min_history_games:
            continue
        weights = np.exp(-decay * (target_season - group["season"].to_numpy(dtype=float)))
        weights = weights / weights.sum()
        stat_matrix = group[stat_cols].fillna(0).to_numpy(dtype=float)
        idx = rng.choice(
            len(stat_matrix), size=(n_samples, n_games), replace=True, p=weights
        )
        # shape (n_samples, n_games, n_stats) -> (n_samples, n_stats)
        season_totals = stat_matrix[idx].sum(axis=1)
        frame = pd.DataFrame(season_totals, columns=stat_cols)
        frame["player_id"] = player_id
        frame["sample_idx"] = np.arange(n_samples, dtype=np.int32)
        out_frames.append(frame)

    if not out_frames:
        return pd.DataFrame(columns=["player_id", "sample_idx", *stat_cols])

    samples = pd.concat(out_frames, ignore_index=True)
    samples = samples[["player_id", "sample_idx", *stat_cols]]

    if meta_lookup is not None:
        samples = samples.join(meta_lookup, on="player_id")

    return samples


def summarize_seasons(
    samples: pd.DataFrame,
    league: LeagueConfig,
    quantiles: Iterable[float] = DEFAULT_QUANTILES,
) -> pd.DataFrame:
    """Reduce simulated samples to a per-player fantasy point posterior.

    Returns columns:
        player_id, [metadata], points_mean, points_sd, q05, q25, q50, q75, q95

    The quantile column names are formatted ``q{int(q*100):02d}``.
    Risk-style downstream metrics (floor, ceiling, sharpe-of-points) are
    derivable from these columns -- they're intentionally not pre-computed
    so leagues with different risk preferences can pick their own.
    """
    if samples.empty:
        return pd.DataFrame()

    scored = samples.copy()
    scored["fantasy_points"] = score_player_weeks(scored, league)

    grouped = scored.groupby("player_id", sort=False)
    summary = grouped["fantasy_points"].agg(points_mean="mean", points_sd="std")
    for q in quantiles:
        summary[f"q{int(round(q * 100)):02d}"] = grouped["fantasy_points"].quantile(q)

    meta_cols = _present(scored, _META_COLUMNS)
    if meta_cols:
        meta = grouped[meta_cols].first()
        summary = meta.join(summary)

    return (
        summary.reset_index()
        .sort_values("points_mean", ascending=False)
        .reset_index(drop=True)
    )
