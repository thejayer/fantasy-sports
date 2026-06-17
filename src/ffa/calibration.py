"""Calibration diagnostics for the posterior's fantasy-point quantiles.

The backtest reports one interval-coverage number (q05-q95) that has sat
well below its 0.90 target. That single number can't say *why*: is every
position uniformly under-dispersed (a global variance problem), or is the
miss concentrated in a few positions (a copula / per-stat problem)? This
module breaks the coverage down per reported quantile and per position so
the next modeling step is aimed, not guessed.

For a projected quantile column ``q{τ}`` and realized season points, the
empirical coverage is ``mean(realized <= q_τ)``. A calibrated model gives
≈ τ. The shape of the deviation is the diagnosis:

- coverage at q05 *above* 0.05 and at q95 *below* 0.95 -> the central
  interval is too narrow (under-dispersed): reality spills out both tails.
- coverage uniformly shifted up (or down) -> a location bias: projections
  sit too low (or too high), independent of spread.

Everything here is a pure function over the player-level frame
:class:`ffa.backtest.BacktestResult` already returns, so it adds no new
modeling and is trivially testable.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Final

import numpy as np
import pandas as pd

DEFAULT_QUANTILES: Final[tuple[float, ...]] = (0.05, 0.25, 0.5, 0.75, 0.95)


def _qcol(q: float) -> str:
    return f"q{int(round(q * 100)):02d}"


def quantile_calibration(
    players: pd.DataFrame,
    quantiles: Iterable[float] = DEFAULT_QUANTILES,
    by: str = "position",
    realized_col: str = "points_realized",
) -> pd.DataFrame:
    """Empirical coverage of each projected quantile, overall and per group.

    Args:
        players: player-level backtest rows; must contain ``realized_col``
            and a ``q{τ}`` column for each quantile in ``quantiles``.
        quantiles: reported quantile levels to score (their columns must
            exist, named ``q05``, ``q25``, ...).
        by: column to group on (``"position"``); an ``"ALL"`` row is always
            included first. Pass ``None`` for the overall row only.
        realized_col: column holding the realized season points.

    Returns:
        One row per group with: the group label, ``n`` players, a
        ``cov_q{τ}`` column per quantile (empirical ``mean(realized <=
        q_τ)``), ``central`` (coverage of the outer ``[q_lo, q_hi]``
        interval), its ``central_nominal`` target, and ``cal_mae`` (mean
        absolute gap between empirical and nominal coverage across the
        quantiles -- a single 'how miscalibrated' score, lower is better).
        Sorted worst-calibrated group first (after ``ALL``).
    """
    qs = sorted(quantiles)
    present = [q for q in qs if _qcol(q) in players.columns]
    if players.empty or not present or realized_col not in players.columns:
        return pd.DataFrame()

    group_col = by if (by and by in players.columns) else None
    groups: list[tuple[str, pd.DataFrame]] = [("ALL", players)]
    if group_col is not None:
        groups += [(str(g), grp) for g, grp in players.groupby(group_col, sort=True)]

    lo, hi = present[0], present[-1]
    label_col = group_col or "group"

    rows: list[dict] = []
    for label, grp in groups:
        realized = grp[realized_col].to_numpy(dtype=float)
        rec: dict[str, object] = {label_col: label, "n": int(len(grp))}
        gaps: list[float] = []
        for q in present:
            cov = float(np.mean(realized <= grp[_qcol(q)].to_numpy(dtype=float)))
            rec[f"cov_{_qcol(q)}"] = cov
            gaps.append(abs(cov - q))
        within = (realized >= grp[_qcol(lo)].to_numpy(dtype=float)) & (
            realized <= grp[_qcol(hi)].to_numpy(dtype=float)
        )
        rec["central"] = float(np.mean(within))
        rec["central_nominal"] = round(hi - lo, 4)
        rec["cal_mae"] = float(np.mean(gaps))
        rows.append(rec)

    out = pd.DataFrame(rows)
    # Keep ALL first, then worst-calibrated groups next.
    if group_col is not None and len(out) > 1:
        head, tail = out.iloc[:1], out.iloc[1:]
        tail = tail.sort_values("cal_mae", ascending=False)
        out = pd.concat([head, tail], ignore_index=True)
    return out


def dispersion_direction(calibration_row: pd.Series, tol: float = 0.05) -> str:
    """Label a calibration row as under-/over-dispersed, biased, or ok.

    Heuristic from the central interval and the median coverage:

    - central coverage well below nominal -> ``"under-dispersed"`` (too narrow);
    - well above -> ``"over-dispersed"`` (too wide);
    - central near nominal but median coverage far from 0.5 -> ``"biased"``;
    - otherwise -> ``"calibrated"``.
    """
    central = float(calibration_row.get("central", np.nan))
    nominal = float(calibration_row.get("central_nominal", np.nan))
    if np.isnan(central) or np.isnan(nominal):
        return "unknown"
    if central < nominal - tol:
        return "under-dispersed"
    if central > nominal + tol:
        return "over-dispersed"
    median_cov = float(calibration_row.get("cov_q50", 0.5))
    if abs(median_cov - 0.5) > 2 * tol:
        return "biased"
    return "calibrated"
