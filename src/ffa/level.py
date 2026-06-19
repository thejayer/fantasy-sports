"""Per-season level uncertainty: a log-normal multiplier on season totals.

Phase 14's variance decomposition showed that ~half the prediction-error
variance the bootstrap leaves unexplained is *level-misprediction*: a
player's true season level drifts from their historical mean (breakouts,
declines) by more than resampling their own games can express, and the
miss is roughly two-sided (both tails too thin).

This injects that as level uncertainty. For each simulated season, the
totals are multiplied by a factor drawn from a log-normal with log-space
spread ``level_sd``. The factor is multiplicative (so the season stays a
coherent stat line and the mechanism is league/position-agnostic) and
log-normal (so it is two-sided and bounded below by zero, never negative
production). ``mean`` sets the multiplier's expectation: ``1.0`` is
mean-preserving (adds spread without shifting the projection), and a
value below 1 also pulls the projection down -- the regression /
attrition drift the phase-12 bust mixture used to capture as a side
effect of its one-sided downside.

This unifies what were two ideas -- the bust mixture (downside only) and a
symmetric level jitter -- into one level distribution. ``level_sd=0`` is
the default and the RNG is not touched, so generators run with it off
reproduce prior output exactly. The parameters are tuned against the
backtest's tail coverage (see the README), not assumed.
"""

from __future__ import annotations

import numpy as np


def apply_level_jitter(
    season_totals: np.ndarray,
    level_sd: float,
    rng: np.random.Generator,
    mean: float = 1.0,
) -> np.ndarray:
    """Multiply each simulated season by a log-normal level factor.

    Args:
        season_totals: ``(n_samples, n_stats)`` simulated season totals.
        level_sd: log-space standard deviation of the per-season multiplier.
            ``0`` returns the input unchanged and draws nothing from ``rng``.
        rng: random generator (advanced in place only when ``level_sd > 0``).
        mean: target expectation of the multiplier. ``1.0`` is
            mean-preserving (spread only); ``< 1`` also drifts the
            projection down (regression / attrition).

    Returns:
        ``season_totals`` scaled per row by ``exp(N(log(mean) - level_sd**2/2,
        level_sd))``, whose expectation is ``mean``.
    """
    if level_sd < 0.0:
        raise ValueError(f"Require level_sd >= 0; got {level_sd}.")
    if mean <= 0.0:
        raise ValueError(f"Require mean > 0; got {mean}.")
    if level_sd == 0.0:
        return season_totals
    n = season_totals.shape[0]
    log_mu = np.log(mean) - 0.5 * level_sd**2
    factor = np.exp(rng.normal(log_mu, level_sd, size=n))
    return season_totals * factor[:, None]
