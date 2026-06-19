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


def dispersion_decomposition(
    players: pd.DataFrame,
    by: str = "position",
    mean_col: str = "points_mean",
    sd_col: str = "points_sd",
    realized_col: str = "points_realized",
) -> pd.DataFrame:
    """Split realized prediction error into modeled vs unmodeled variance.

    The posterior's ``points_sd`` is the spread the generator actually
    produces -- the within-season variance from resampling a player's own
    games (plus games-played and bust variance). The *realized residual*
    ``realized - mean`` carries the full prediction error, which also
    includes the player's true level shifting season to season (breakouts,
    declines) -- something resampling a player's own history cannot express.

    Comparing the two says which lever moves calibration:

    - ``ratio`` = residual SD / modeled SD. ``> 1`` means the posterior is
      too narrow overall.
    - ``frac_modeled`` = modeled variance / residual variance. If this is
      *high* (most of the error is modeled within-season noise), widening
      or recalibrating the per-game distribution will help. If it is *low*,
      the error is dominated by level-misprediction, and no amount of
      per-game variance fixes it -- the lever is an upside/downside *level*
      mechanism (or a model that predicts the level shift).
    - ``over_q95`` / ``under_q05`` give the asymmetry: an upper-tail-only
      miss points at a missing *boom* component specifically.

    Columns also include ``bias`` (mean residual) and the raw SDs. Grouped
    like :func:`quantile_calibration` (``"ALL"`` plus each position).
    """
    need = {mean_col, sd_col, realized_col}
    if players.empty or need - set(players.columns):
        return pd.DataFrame()

    group_col = by if (by and by in players.columns) else None
    groups: list[tuple[str, pd.DataFrame]] = [("ALL", players)]
    if group_col is not None:
        groups += [(str(g), grp) for g, grp in players.groupby(group_col, sort=True)]
    label_col = group_col or "group"
    has_q = "q05" in players.columns and "q95" in players.columns

    rows: list[dict] = []
    for label, grp in groups:
        resid = (grp[realized_col] - grp[mean_col]).to_numpy(dtype=float)
        modeled_var = float(np.mean(np.square(grp[sd_col].to_numpy(dtype=float))))
        resid_sd = float(np.std(resid))
        modeled_sd = float(np.sqrt(modeled_var))
        rec: dict[str, object] = {
            label_col: label,
            "n": int(len(grp)),
            "bias": float(np.mean(resid)),
            "resid_sd": resid_sd,
            "modeled_sd": modeled_sd,
            "ratio": resid_sd / modeled_sd if modeled_sd > 0 else float("nan"),
            "frac_modeled": modeled_var / (resid_sd**2) if resid_sd > 0 else float("nan"),
        }
        if has_q:
            rec["over_q95"] = float(np.mean(grp[realized_col].to_numpy() > grp["q95"].to_numpy()))
            rec["under_q05"] = float(np.mean(grp[realized_col].to_numpy() < grp["q05"].to_numpy()))
        rows.append(rec)

    return pd.DataFrame(rows)


def level_error_by_cohort(
    players: pd.DataFrame,
    cohort_col: str,
    mean_col: str = "points_mean",
    realized_col: str = "points_realized",
    clip: tuple[float, float] = (0.05, 20.0),
    min_n: int = 20,
) -> pd.DataFrame:
    """Empirical level-error spread and drift per cohort.

    The phase-15 level mechanism injects a single *global* log-normal level
    multiplier (``--level-sd`` / ``--level-mean``). This estimates, per
    cohort, the multiplier that cohort would actually want from the realized
    error: the spread ``level_sd = std(log(realized / projected))`` and the
    center ``drift = exp(mean(log(realized / projected)))`` (``< 1`` = that
    cohort's projections run optimistic). If these vary materially across
    cohorts, conditioning the level knobs on that signal tightens calibration
    past one global value; if they're flat, the global knob is already right
    and conditioning is a dead end.

    Args:
        players: player-level backtest rows; needs ``cohort_col``,
            ``mean_col``, ``realized_col``.
        cohort_col: column to group on (e.g. an experience bucket or tier).
        clip: floor/ceiling on the ``realized/projected`` ratio before the
            log, so a near-zero bust or a freak outlier can't dominate the SD.
        min_n: cohorts with fewer rows than this are dropped (noise).

    Returns:
        One row per cohort (``ALL`` first) with ``n``, ``level_sd``, ``drift``.
    """
    need = {cohort_col, mean_col, realized_col}
    if players.empty or need - set(players.columns):
        return pd.DataFrame()

    df = players[[cohort_col, mean_col, realized_col]].copy()
    df = df[(df[mean_col] > 0) & df[cohort_col].notna()]
    if df.empty:
        return pd.DataFrame()
    ratio = (df[realized_col] / df[mean_col]).clip(*clip)
    df["_logr"] = np.log(ratio)

    def _row(label: str, sub: pd.DataFrame) -> dict:
        return {
            cohort_col: label,
            "n": int(len(sub)),
            "level_sd": float(sub["_logr"].std()),
            "drift": float(np.exp(sub["_logr"].mean())),
        }

    rows = [_row("ALL", df)]
    for label, sub in df.groupby(cohort_col, sort=True):
        if len(sub) >= min_n:
            rows.append(_row(str(label), sub))
    return pd.DataFrame(rows)
