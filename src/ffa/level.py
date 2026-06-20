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

# Per-tier role-collapse rate (phase 18): the share of seasons that crater to
# near-replacement -- ~21/13/5% realized by tier; the model rate is tuned.
_DEFAULT_COLLAPSE_BY_TIER: Final[dict[str, float]] = {"low": 0.20, "mid": 0.12, "high": 0.04}


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
    """Per-player ``(level_sd, level_mean, collapse_rate)`` from tier + experience.

    The phase-16/18 diagnostics showed the level error is not uniform: its
    spread runs ~2x wider for fringe players than stars, its optimism drift
    deepens monotonically with experience, and a tier-dependent share of
    seasons (~21/13/5% low/mid/high) *collapse* to near-replacement. This
    conditions all three level knobs on those signals, with the *shape* fixed
    from the diagnostics and only a few scalars tuned on the backtest:

        level_sd     = base_sd * tier_mult[tier]
        level_mean   = base_mean + mean_slope * experience_score(years_exp)
        collapse_rate = collapse_scale * collapse_by_tier[tier]

    Phase 17 found tier/experience conditioning of the smooth log-normal alone
    only marginal; phase 18 added the ``collapse_rate`` (zero-inflation) knob,
    which a *global* collapse can't supply without a large pessimistic bias --
    it must be conditioned, since stars rarely collapse.
    """

    base_sd: float = 0.55
    base_mean: float = 1.0
    mean_slope: float = 0.12
    collapse_scale: float = 1.3
    tier_mult: Mapping[str, float] = field(default_factory=lambda: dict(_DEFAULT_TIER_MULT))
    collapse_by_tier: Mapping[str, float] = field(
        default_factory=lambda: dict(_DEFAULT_COLLAPSE_BY_TIER)
    )
    mean_bounds: tuple[float, float] = (0.5, 1.1)

    def level_for(self, tier: str | None, years_exp: float | None) -> tuple[float, float, float]:
        """Return ``(level_sd, level_mean, collapse_rate)`` for one player."""
        key = str(tier)
        sd = self.base_sd * float(self.tier_mult.get(key, 1.0))
        mean = self.base_mean + self.mean_slope * _experience_score(years_exp)
        collapse = self.collapse_scale * float(
            self.collapse_by_tier.get(key, self.collapse_by_tier.get("mid", 0.0))
        )
        lo, hi = self.mean_bounds
        return max(0.0, sd), float(np.clip(mean, lo, hi)), float(np.clip(collapse, 0.0, 1.0))


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
    player_level: Mapping[object, tuple[float, ...]] | None,
    level_sd: float,
    level_mean: float,
    collapse_rate: float = 0.0,
) -> tuple[float, float, float]:
    """Per-player ``(level_sd, level_mean, collapse_rate)``, else the globals.

    ``player_level`` maps ``player_id -> (sd, mean[, collapse])`` (built by
    the caller from a :class:`LevelModel`). A 2-tuple entry uses the global
    ``collapse_rate``. A player absent from the table -- or ``None`` entirely
    -- uses the scalars, so the conditioned and global paths share one code
    path in the generators.
    """
    if player_level is not None:
        pair = player_level.get(player_id)
        if pair is not None:
            if len(pair) < 2:
                raise ValueError(
                    "player_level entries must be (level_sd, level_mean[, collapse_rate]); "
                    f"got {pair!r}."
                )
            coll = float(pair[2]) if len(pair) > 2 else float(collapse_rate)
            return float(pair[0]), float(pair[1]), coll
    return float(level_sd), float(level_mean), float(collapse_rate)


def apply_level_jitter(
    season_totals: np.ndarray,
    level_sd: float,
    rng: np.random.Generator,
    mean: float = 1.0,
    collapse_rate: float = 0.0,
    collapse_floor: float = 0.15,
) -> np.ndarray:
    """Multiply each simulated season by a (zero-inflated) log-normal factor.

    The smooth component is the log-normal level multiplier (phase 15). The
    optional zero-inflation (phase 18) is the *role* component: with
    probability ``collapse_rate`` the season instead collapses to ``U(0,
    collapse_floor)`` of its projection -- the near-binary "never got a role"
    outcome the log-normal cannot express, which the phase-16/17 diagnostics
    found concentrated in low/mid-tier players.

    Args:
        season_totals: ``(n_samples, n_stats)`` simulated season totals.
        level_sd: log-space spread of the smooth multiplier.
        rng: random generator (advanced only when there is work to do).
        mean: expectation of the smooth multiplier (``< 1`` drifts down).
        collapse_rate: per-season probability of a role collapse. ``0`` (the
            default) leaves the smooth log-normal untouched.
        collapse_floor: collapsed seasons scale by ``U(0, collapse_floor)``.

    Returns:
        ``season_totals`` scaled per row. With ``level_sd == 0`` and
        ``collapse_rate == 0`` the input is returned and the RNG untouched.
    """
    if level_sd < 0.0:
        raise ValueError(f"Require level_sd >= 0; got {level_sd}.")
    if mean <= 0.0:
        raise ValueError(f"Require mean > 0; got {mean}.")
    if not 0.0 <= collapse_rate <= 1.0:
        raise ValueError(f"Require 0 <= collapse_rate <= 1; got {collapse_rate}.")
    if not 0.0 <= collapse_floor <= 1.0:
        raise ValueError(f"Require 0 <= collapse_floor <= 1; got {collapse_floor}.")
    if level_sd == 0.0 and collapse_rate == 0.0:
        return season_totals

    n = season_totals.shape[0]
    if level_sd > 0.0:
        log_mu = np.log(mean) - 0.5 * level_sd**2
        factor = np.exp(rng.normal(log_mu, level_sd, size=n))
    else:
        factor = np.ones(n)
    if collapse_rate > 0.0:
        collapsed = rng.random(n) < collapse_rate
        crushed = rng.uniform(0.0, collapse_floor, size=n)
        factor = np.where(collapsed, crushed, factor)
    return season_totals * factor[:, None]
