"""Per-player games-played model.

Every generator builds a season total by summing a fixed ``expected_games``
(default 17) bootstrapped game rows. Projecting every player for a full
17-game season is the single clearest bias the backtest exposes: a positive
mean error (players miss time) and intervals far too narrow to cover reality
(a season cut short by injury is a real downside the posterior never samples).

This module makes season length stochastic. ``GamesModel`` learns an
empirical games-played-per-season distribution -- a player's own recent
seasons when it has enough of them, otherwise the player's position pool --
and ``bootstrap_season_totals`` sums a *per-sample-variable* number of rows
using it. A sim where the player suits up 7 times and one where they play 17
both appear, so the floor widens and the mean drifts down toward reality.

The default stays ``"fixed"`` everywhere: with a constant games count the
masked sum reduces to the old ``matrix[idx].sum(axis=1)`` bit-for-bit, so
turning the model off reproduces prior behavior exactly.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final

import numpy as np
import pandas as pd

from ffa.projection import regular_season_only

DEFAULT_MAX_GAMES: Final[int] = 17
DEFAULT_POSITIONS: Final[tuple[str, ...]] = ("QB", "RB", "WR", "TE")

GAMES_MODELS: Final[tuple[str, ...]] = ("fixed", "empirical")


def bootstrap_season_totals(
    stat_matrix: np.ndarray,
    n_samples: int,
    games_counts: np.ndarray,
    rng: np.random.Generator,
    weights: np.ndarray | None = None,
) -> np.ndarray:
    """Sum a per-sample-variable number of bootstrapped game rows.

    Args:
        stat_matrix: ``(n_rows, n_stats)`` pool of game-row stat vectors.
        n_samples: number of simulated seasons to produce.
        games_counts: ``(n_samples,)`` integer game count for each sim.
        rng: random generator (advanced in place).
        weights: optional ``(n_rows,)`` sampling probabilities (recency).

    Returns:
        ``(n_samples, n_stats)`` array of simulated season totals.

    When every entry of ``games_counts`` equals its max (the ``"fixed"``
    games model), this draws ``rng.choice(n_rows, size=(n_samples, n_games),
    p=weights)`` and sums -- identical to the pre-games-model code path.
    """
    counts = np.asarray(games_counts, dtype=int)
    max_g = int(counts.max())
    idx = rng.choice(len(stat_matrix), size=(n_samples, max_g), replace=True, p=weights)
    gathered = stat_matrix[idx]  # (n_samples, max_g, n_stats)
    if bool((counts == max_g).all()):
        return gathered.sum(axis=1)
    keep = np.arange(max_g) < counts[:, None]  # (n_samples, max_g)
    return (gathered * keep[:, :, None]).sum(axis=1)


@dataclass
class GamesModel:
    """Empirical games-played-per-season distributions from weekly history.

    Sampling for a player uses their own per-season game counts when they
    have at least ``min_own_seasons`` of history, else their position's pool,
    else the league-wide pool. Counts are clipped to ``[1, max_games]``.
    """

    by_player: dict[str, np.ndarray]
    by_position: dict[str, np.ndarray]
    overall: np.ndarray
    min_own_seasons: int = 2
    max_games: int = DEFAULT_MAX_GAMES

    @classmethod
    def from_history(
        cls,
        history: pd.DataFrame,
        positions: Iterable[str] = DEFAULT_POSITIONS,
        min_own_seasons: int = 2,
        max_games: int = DEFAULT_MAX_GAMES,
    ) -> "GamesModel":
        """Build from a weekly frame (regular-season rows; one row per game).

        ``history`` is expected to already be the lookback window the caller
        is projecting from, so the model never sees the target season.
        """
        reg = regular_season_only(history)
        needed = {"player_id", "season"}
        if reg.empty or needed - set(reg.columns):
            return cls({}, {}, np.array([], dtype=int), min_own_seasons, max_games)

        counts = (
            reg.groupby(["player_id", "season"], sort=False).size().reset_index(name="g")
        )
        counts["g"] = counts["g"].clip(1, max_games).astype(int)
        by_player = {
            str(pid): grp["g"].to_numpy() for pid, grp in counts.groupby("player_id", sort=False)
        }

        by_position: dict[str, np.ndarray] = {}
        if "position" in reg.columns:
            pos = (
                reg.dropna(subset=["position"])
                .groupby("player_id", sort=False)["position"]
                .agg(lambda s: s.mode().iloc[0] if not s.mode().empty else s.iloc[0])
            )
            tagged = counts.merge(pos.rename("position"), on="player_id", how="left")
            tagged = tagged[tagged["position"].isin(tuple(positions))]
            by_position = {
                str(p): grp["g"].to_numpy() for p, grp in tagged.groupby("position", sort=False)
            }

        return cls(by_player, by_position, counts["g"].to_numpy(), min_own_seasons, max_games)

    def sample(
        self,
        player_id: str,
        position: str | None,
        n_samples: int,
        rng: np.random.Generator,
    ) -> np.ndarray | None:
        """Draw ``n_samples`` season game counts for one player.

        Returns ``None`` when no pool is available, letting the caller fall
        back to a fixed count rather than fabricating a distribution.
        """
        pool = self.by_player.get(str(player_id))
        if pool is None or len(pool) < self.min_own_seasons:
            pool = self.by_position.get(str(position)) if position is not None else None
        if pool is None or len(pool) == 0:
            pool = self.overall
        if pool is None or len(pool) == 0:
            return None
        return rng.choice(pool, size=n_samples, replace=True).astype(int)


def resolve_games_counts(
    games_model: GamesModel | None,
    player_id: str,
    position: str | None,
    n_games: int,
    n_samples: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Per-sample game counts: empirical when a model is given, else fixed.

    In the fixed case (``games_model is None``) the RNG is *not* touched, so
    a generator run with the games model off matches its prior output.
    """
    if games_model is not None:
        counts = games_model.sample(player_id, position, n_samples, rng)
        if counts is not None:
            return counts
    return np.full(n_samples, n_games, dtype=int)
