"""Value-over-replacement and tiering.

VOR makes points comparable across positions: a QB scoring 300 is not the
same asset as a WR scoring 300, because their replacement-level baselines
differ. Tiers group players whose VOR is close enough that the choice
between them is functionally a coin flip -- when a tier breaks, the
opportunity cost of *not* drafting from it spikes.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ffa.league import RosterRules


def compute_vor(
    summary: pd.DataFrame,
    roster: RosterRules,
    points_col: str = "points_mean",
    position_col: str = "position",
) -> pd.DataFrame:
    """Add a ``vor`` column = projected points minus replacement at position.

    Replacement at position ``p`` is the projection of the player whose
    rank-within-position equals ``teams * starters_at(p)`` (0-indexed). If
    fewer players exist at that position than there are starting slots,
    replacement falls back to the worst projected player at that position.

    Args:
        summary: per-player projections; must include ``points_col`` and
            ``position_col``.
        roster: league roster configuration.
        points_col: column containing each player's projected points.
        position_col: column containing each player's position.

    Returns:
        A copy of ``summary`` with a ``vor`` column appended. Replacement
        levels per position are also exposed in ``vor_replacement`` so
        downstream code (tiering, optimizer) can re-use them without
        recomputing.
    """
    if summary.empty:
        return summary.assign(vor=pd.Series(dtype=float), vor_replacement=pd.Series(dtype=float))

    out = summary.copy()
    replacement_by_pos: dict[str, float] = {}
    for pos, group in out.groupby(position_col, sort=False):
        sorted_points = group[points_col].sort_values(ascending=False).reset_index(drop=True)
        idx = roster.replacement_index(str(pos))
        idx = min(idx, len(sorted_points) - 1)
        replacement_by_pos[str(pos)] = float(sorted_points.iloc[idx])

    out["vor_replacement"] = out[position_col].astype(str).map(replacement_by_pos).fillna(0.0)
    out["vor"] = out[points_col] - out["vor_replacement"]
    return out


def assign_tiers(
    summary: pd.DataFrame,
    n_tiers: int = 5,
    points_col: str = "points_mean",
    position_col: str = "position",
) -> pd.DataFrame:
    """Within each position, partition players into ``n_tiers`` by largest gaps.

    The algorithm: sort players by points descending, compute consecutive
    point gaps, and place tier breaks at the ``n_tiers - 1`` largest gaps.
    This is interpretable -- a tier always corresponds to a visible step
    in the sorted projections -- and parameter-free beyond ``n_tiers``.

    Players in positions with fewer than ``n_tiers`` rows each get their
    own tier (rank-1 -> tier-1, etc.).

    Returns:
        Copy of ``summary`` with an integer ``tier`` column (1 = best tier
        at that position).
    """
    if summary.empty:
        return summary.assign(tier=pd.Series(dtype=int))

    out = summary.copy()
    out["tier"] = 0

    for _, group in out.groupby(position_col, sort=False):
        order = group[points_col].sort_values(ascending=False).index.to_numpy()
        n = len(order)
        if n == 0:
            continue
        if n <= n_tiers:
            tiers = np.arange(1, n + 1)
        else:
            points = out.loc[order, points_col].to_numpy(dtype=float)
            gaps = points[:-1] - points[1:]  # non-negative since sorted desc
            cuts = np.sort(np.argsort(gaps)[-(n_tiers - 1):])
            tiers = np.empty(n, dtype=int)
            current = 1
            cut_set = set(cuts.tolist())
            for i in range(n):
                tiers[i] = current
                if i in cut_set:
                    current += 1
        out.loc[order, "tier"] = tiers

    return out
