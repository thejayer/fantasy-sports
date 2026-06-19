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

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Final

import numpy as np

# Tier multipliers: the phase-16 diagnostic measured a ~2x realized-spread
# gap (fringe vs stars), but per-tier *coverage* (phase 17) showed stars are
# already well-covered, so narrowing them hurts -- the tuned shape is gentle.
_DEFAULT_TIER_MULT: Final[dict[str, float]] = {"low": 1.25, "mid": 1.00, "high": 0.80}


def _experience_score(years_exp: float | None) -> float:
    """Monotone experience signal in [-1, 1]: rookies high, veterans low.

    Matches the diagnostic's drift shape (rookie ~1.05 down to 8+ vet ~0.50).
    ``None`` / NaN (no roster match) -> 0, the neutral middle.
    """
    if years_exp is None or (isinstance(years_exp, float) and np.isnan(years_exp)):
        return 0.0
    y = float(years_exp)
    if y <= 1:
        return 1.0
    if y <= 3:
        return 0.2
    if y <= 7:
        return -0.2
    return -1.0


@dataclass(frozen=True)
class LevelModel:
    """Per-player ``(level_sd, level_mean)`` from projected tier + experience.

    The phase-16 diagnostic showed the level error is not uniform: its spread
    runs ~2x wider for fringe players than stars (by projected tier), and its
    optimism drift deepens monotonically with experience. This conditions the
    global level knobs on those two signals, with the *shape* fixed from the
    diagnostic and only three scalars tuned on the backtest:

        level_sd   = base_sd * tier_mult[tier]
        level_mean = base_mean + mean_slope * experience_score(years_exp)

    ``base_sd``/``base_mean`` are the global center (cf. phase-15's 0.45/0.90);
    ``mean_slope`` is how hard experience pulls the drift.
    """

    base_sd: float = 0.60
    base_mean: float = 0.90
    mean_slope: float = 0.15
    tier_mult: Mapping[str, float] = field(default_factory=lambda: dict(_DEFAULT_TIER_MULT))
    mean_bounds: tuple[float, float] = (0.5, 1.1)

    def level_for(self, tier: str | None, years_exp: float | None) -> tuple[float, float]:
        """Return ``(level_sd, level_mean)`` for one player."""
        sd = self.base_sd * float(self.tier_mult.get(str(tier), 1.0))
        mean = self.base_mean + self.mean_slope * _experience_score(years_exp)
        lo, hi = self.mean_bounds
        return max(0.0, sd), float(np.clip(mean, lo, hi))


def projected_tier(points: "np.ndarray | object", n_tiers: int = 3) -> object:
    """Tercile labels (``low``/``mid``/``high``) for a projected-points Series.

    Lives here so the caller (which has scored projections) computes the tier
    and the league-agnostic generator just consumes the labels.
    """
    import pandas as pd

    s = pd.Series(points)
    if s.empty:
        return pd.Series(dtype=object)
    labels = ["low", "mid", "high"][:n_tiers]
    try:
        return pd.qcut(s.rank(method="first"), n_tiers, labels=labels).astype(object)
    except ValueError:
        # Too few distinct values to form n_tiers; fall back to all-mid.
        return pd.Series(["mid"] * len(s), index=s.index, dtype=object)


def resolve_level(
    player_id: object,
    player_level: Mapping[object, tuple[float, float]] | None,
    level_sd: float,
    level_mean: float,
) -> tuple[float, float]:
    """Per-player ``(level_sd, level_mean)``, falling back to the globals.

    ``player_level`` maps ``player_id -> (sd, mean)`` (built by the caller
    from a :class:`LevelModel`). A player absent from it -- or ``None``
    entirely -- uses the scalar ``level_sd``/``level_mean``, so the
    conditioned path and the global path share one code path in the
    generators.
    """
    if player_level is not None:
        pair = player_level.get(player_id)
        if pair is not None:
            return float(pair[0]), float(pair[1])
    return float(level_sd), float(level_mean)


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
