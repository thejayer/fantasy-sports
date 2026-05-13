"""Baseline projection model: exponentially-weighted per-game stats.

This is the simplest defensible projection: for each player, take their last
``lookback`` seasons of per-game stats and combine them with an exponential
recency weight. It is the floor the next phase's learned model has to beat.

Pipeline:
    weekly stats DataFrame  --project_per_game-->  per-game projections
    per-game projections    --apply_depth_multiplier-->  role-adjusted
    role-adjusted           --project_season-->  full-season totals

All three are pure functions over DataFrames -- no I/O, no globals. Stat
column names match :data:`ffa.scoring.STAT_COLUMNS` so the same scoring
engine can be applied to either actuals or projections.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Final

import numpy as np
import pandas as pd

from ffa.scoring import STAT_COLUMNS


# Position -> depth slot -> share of starter workload. Coarse, but enough to
# zero out a deep backup and let the user override per league/situation.
DEFAULT_DEPTH_MULTIPLIERS: Final[Mapping[str, Mapping[int, float]]] = {
    "QB": {1: 1.0, 2: 0.05},
    "RB": {1: 1.0, 2: 0.55, 3: 0.20, 4: 0.05},
    "WR": {1: 1.0, 2: 0.85, 3: 0.55, 4: 0.25, 5: 0.10},
    "TE": {1: 1.0, 2: 0.40, 3: 0.10},
}

DEFAULT_EXPECTED_GAMES: Final[float] = 17.0

# Player metadata columns we carry through from weekly history if present.
_META_COLUMNS: Final[tuple[str, ...]] = (
    "player_name",
    "player_display_name",
    "position",
    "recent_team",
)


def _present_stats(df: pd.DataFrame, stats: Iterable[str]) -> list[str]:
    return [s for s in stats if s in df.columns]


def project_per_game(
    weekly: pd.DataFrame,
    target_season: int,
    lookback: int = 3,
    decay: float = 0.5,
    min_weighted_games: float = 4.0,
    stats: Iterable[str] = STAT_COLUMNS,
) -> pd.DataFrame:
    """Recency-weighted per-game projection for each player.

    For ``target_season``, look back ``lookback`` prior seasons. Each season
    is weighted by ``exp(-decay * (target_season - season))``. The result for
    every stat is a weighted-per-game mean::

        sum_s ( w_s * stat_s )  /  sum_s ( w_s * games_s )

    where the sum runs over seasons s in the lookback window. Players with
    fewer than ``min_weighted_games`` of weighted history are dropped, which
    suppresses noisy projections for cup-of-coffee NFL careers.

    Args:
        weekly: per-player per-game stats matching ``nfl_data_py`` weekly
            schema; must contain ``player_id``, ``season``, and ``week``.
        target_season: season being projected (excluded from history).
        lookback: number of prior seasons to use.
        decay: exponential decay rate; 0 = uniform, larger = sharper recency.
        min_weighted_games: drop players with less than this much weighted
            history. With ``decay=0.5`` and only last season, a 16-game player
            contributes ~9.7 weighted games -- pick a threshold below that.
        stats: stat columns to project. Missing columns are skipped.

    Returns:
        DataFrame with one row per qualified player and one column per stat,
        plus available metadata (position, recent_team, player name).
    """
    required = {"player_id", "season", "week"}
    missing = required - set(weekly.columns)
    if missing:
        raise ValueError(f"weekly is missing required columns: {sorted(missing)}")

    seasons = list(range(target_season - lookback, target_season))
    history = weekly[weekly["season"].isin(seasons)]
    if history.empty:
        return pd.DataFrame(columns=["player_id", *_present_stats(weekly, stats)])

    stat_cols = _present_stats(history, stats)

    # One row per (player, season): summed stats and games active.
    per_ps = (
        history.assign(_games=1)
        .groupby(["player_id", "season"], as_index=False)
        .agg({**{s: "sum" for s in stat_cols}, "_games": "sum"})
    )

    # Season weight; "age 0" is target_season, so prior seasons have age >= 1.
    per_ps["_weight"] = np.exp(-decay * (target_season - per_ps["season"]))

    weighted_stats = per_ps[stat_cols].mul(per_ps["_weight"], axis=0)
    weighted_games = per_ps["_games"] * per_ps["_weight"]
    accum = pd.concat(
        [per_ps[["player_id"]], weighted_stats, weighted_games.rename("_wg")],
        axis=1,
    )

    totals = accum.groupby("player_id", as_index=False).sum(numeric_only=True)
    totals = totals[totals["_wg"] >= min_weighted_games].copy()

    # Divide by weighted games to get per-game means.
    for s in stat_cols:
        totals[s] = totals[s] / totals["_wg"]
    totals = totals.drop(columns=["_wg"])

    # Attach the most recent metadata we observed for the player.
    meta_cols = _present_stats(history, _META_COLUMNS)
    if meta_cols:
        last_seen = (
            history.sort_values(["player_id", "season", "week"])
            .groupby("player_id", as_index=False)
            .last()
        )
        totals = totals.merge(last_seen[["player_id", *meta_cols]], on="player_id", how="left")

    return totals.reset_index(drop=True)


def latest_depth_chart(depth_chart: pd.DataFrame) -> pd.DataFrame:
    """Reduce a weekly depth chart to one row per player (latest week).

    Expected columns: ``player_id`` (or ``gsis_id``), ``season``, ``week``,
    ``position``, ``depth_team`` (the depth slot, may be string or int).
    """
    df = depth_chart.copy()
    if "player_id" not in df.columns and "gsis_id" in df.columns:
        df = df.rename(columns={"gsis_id": "player_id"})
    df["_depth_team"] = pd.to_numeric(df["depth_team"], errors="coerce")
    df = df.dropna(subset=["player_id", "_depth_team"])
    df = df.sort_values(["player_id", "season", "week"])
    latest = df.groupby("player_id", as_index=False).last()
    latest["depth_position"] = latest["_depth_team"].astype(int)
    return latest[["player_id", "position", "depth_position"]]


def apply_depth_multiplier(
    projections: pd.DataFrame,
    depth_chart: pd.DataFrame,
    multipliers: Mapping[str, Mapping[int, float]] = DEFAULT_DEPTH_MULTIPLIERS,
    stats: Iterable[str] = STAT_COLUMNS,
    drop_missing: bool = True,
) -> pd.DataFrame:
    """Scale per-game projections by a position-depth multiplier.

    This is a *role shift*, not a recalibration: a backup whose history was
    earned as a backup will get multiplied down further. Use it when you
    know a player's depth slot for the upcoming season has changed (e.g. a
    rookie RB1 taking over for a departed starter) -- not as a default.

    Args:
        projections: output of :func:`project_per_game`.
        depth_chart: output of :func:`latest_depth_chart` (one row per
            player with ``position`` and ``depth_position``).
        multipliers: ``{position: {depth_slot: multiplier}}``. Slots below
            the deepest configured entry get multiplier 0.0.
        stats: stat columns to scale.
        drop_missing: if True, players not on the depth chart are dropped;
            if False, they pass through unscaled.
    """
    merged = projections.merge(
        depth_chart[["player_id", "depth_position"]],
        on="player_id",
        how="left" if not drop_missing else "inner",
        suffixes=("", "_dc"),
    )

    def _factor(row: pd.Series) -> float:
        pos = row.get("position")
        slot = row.get("depth_position")
        if pd.isna(pos) or pd.isna(slot):
            return 1.0
        table = multipliers.get(str(pos))
        if table is None:
            return 1.0
        return float(table.get(int(slot), 0.0))

    factor = merged.apply(_factor, axis=1)
    stat_cols = _present_stats(merged, stats)
    merged[stat_cols] = merged[stat_cols].mul(factor, axis=0)
    return merged.drop(columns=["depth_position"], errors="ignore").reset_index(drop=True)


def project_season(
    per_game: pd.DataFrame,
    expected_games: float | pd.Series = DEFAULT_EXPECTED_GAMES,
    stats: Iterable[str] = STAT_COLUMNS,
) -> pd.DataFrame:
    """Convert per-game projections to season totals.

    ``expected_games`` may be a scalar (e.g. 17.0) or a Series indexed
    compatibly with ``per_game.index`` for per-player overrides (e.g. an
    injury-prone RB at 13.0).
    """
    out = per_game.copy()
    stat_cols = _present_stats(out, stats)
    if isinstance(expected_games, pd.Series):
        out[stat_cols] = out[stat_cols].mul(expected_games, axis=0)
    else:
        out[stat_cols] = out[stat_cols] * float(expected_games)
    return out
