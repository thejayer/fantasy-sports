"""Pure scoring engine: stats + LeagueConfig -> fantasy points.

The expected stat column names are the canonical nflverse names produced by
:mod:`ffa.ingest` (which normalizes ``nflreadpy.load_player_stats`` output):

    passing_yards, passing_tds, interceptions, passing_2pt_conversions,
    rushing_yards, rushing_tds, rushing_2pt_conversions,
    receptions, receiving_yards, receiving_tds, receiving_2pt_conversions,
    sack_fumbles_lost, rushing_fumbles_lost, receiving_fumbles_lost,
    special_teams_tds

Any missing columns are treated as zero so this works on both per-game
actuals and on projection DataFrames that only carry a subset of stats.
"""

from __future__ import annotations

from typing import Iterable

import pandas as pd

from ffa.league import LeagueConfig, YardageBonus

STAT_COLUMNS: tuple[str, ...] = (
    "passing_yards",
    "passing_tds",
    "interceptions",
    "passing_2pt_conversions",
    "rushing_yards",
    "rushing_tds",
    "rushing_2pt_conversions",
    "receptions",
    "receiving_yards",
    "receiving_tds",
    "receiving_2pt_conversions",
    "sack_fumbles_lost",
    "rushing_fumbles_lost",
    "receiving_fumbles_lost",
    "special_teams_tds",
)


def _col(df: pd.DataFrame, name: str) -> pd.Series:
    """Return a stat column as float, or zeros if the column is absent."""
    if name in df.columns:
        return df[name].fillna(0).astype(float)
    return pd.Series(0.0, index=df.index)


def _apply_bonuses(yards: pd.Series, bonuses: Iterable[YardageBonus]) -> pd.Series:
    """Sum every bonus whose threshold is met by ``yards`` (vectorized)."""
    total = pd.Series(0.0, index=yards.index)
    for bonus in bonuses:
        total = total + (yards >= bonus.threshold).astype(float) * bonus.points
    return total


def score_player_weeks(stats: pd.DataFrame, league: LeagueConfig) -> pd.Series:
    """Compute fantasy points for each row of ``stats``.

    Returns a Series aligned with ``stats.index``. Does not mutate ``stats``.
    """
    pts = pd.Series(0.0, index=stats.index)

    pass_yds = _col(stats, "passing_yards")
    pts += pass_yds / league.passing.yards_per_point
    pts += _col(stats, "passing_tds") * league.passing.td_points
    pts += _col(stats, "interceptions") * league.passing.int_points
    pts += _col(stats, "passing_2pt_conversions") * league.passing.two_point_conversion
    pts += _apply_bonuses(pass_yds, league.passing.bonuses)

    rush_yds = _col(stats, "rushing_yards")
    pts += rush_yds / league.rushing.yards_per_point
    pts += _col(stats, "rushing_tds") * league.rushing.td_points
    pts += _col(stats, "rushing_2pt_conversions") * league.rushing.two_point_conversion
    pts += _apply_bonuses(rush_yds, league.rushing.bonuses)

    rec_yds = _col(stats, "receiving_yards")
    pts += rec_yds / league.receiving.yards_per_point
    pts += _col(stats, "receiving_tds") * league.receiving.td_points
    pts += _col(stats, "receptions") * league.receiving.reception_points
    pts += _col(stats, "receiving_2pt_conversions") * league.receiving.two_point_conversion
    pts += _apply_bonuses(rec_yds, league.receiving.bonuses)

    fumbles_lost = (
        _col(stats, "sack_fumbles_lost")
        + _col(stats, "rushing_fumbles_lost")
        + _col(stats, "receiving_fumbles_lost")
    )
    pts += fumbles_lost * league.misc.fumble_lost
    pts += _col(stats, "special_teams_tds") * league.misc.return_td

    return pts


def score_stat_line(stat_line: dict[str, float], league: LeagueConfig) -> float:
    """Score a single stat line. Convenience wrapper for tests and notebooks."""
    df = pd.DataFrame([stat_line])
    return float(score_player_weeks(df, league).iloc[0])
