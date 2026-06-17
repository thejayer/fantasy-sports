"""Lower-tail downside: a per-season "bust" mixture.

Phase 11's calibration diagnostic found the posterior uniformly
under-dispersed across every position, concentrated in the *lower tail*:
~30% of player-seasons land at or below their projected 5th percentile
(nominal 5%). Projected floors are far too high.

The cause is structural. The bootstrap resamples a player's *own* game
rows iid, so the season total concentrates near the player's mean (a sum
of ~16 iid draws has little spread), and a whole bust season -- lost job,
benching, decline, a nagging injury that saps production all year -- is
essentially unsamplable, because the player's own recent history (earned
while they were good enough to have history) does not contain it.

This module injects that downside without disturbing the center. For each
simulated season, with probability ``bust_rate`` the season total is
multiplied by a degradation factor drawn from ``[severity_low,
severity_high]`` (a fraction of the player's normal output). Because:

- it is a *season-level* Bernoulli, the median season is untouched (most
  seasons aren't busts), so projected medians and cross-player ranking
  are preserved;
- the factor is multiplicative, the bust season stays a coherent stat
  line (ratios preserved) and the mechanism is league- and
  position-agnostic -- matching the diagnostic's uniform-across-positions
  shape;
- the factor is always < 1, only the *left* tail fattens; the ceiling is
  left alone.

``bust_rate=0.0`` is the default and the RNG is not touched in that case,
so generators run with downside off reproduce prior output exactly.
``bust_rate`` is the one knob; it is tuned against the backtest's
``cov_q05`` (see the README) rather than assumed.
"""

from __future__ import annotations

from typing import Final

import numpy as np

# A bust season lands at this fraction of the player's normal output:
# uniform on [0, 0.6] -> on average ~30%, ranging from a near-total
# washout to a mild down year.
DEFAULT_SEVERITY_LOW: Final[float] = 0.0
DEFAULT_SEVERITY_HIGH: Final[float] = 0.6


def apply_downside(
    season_totals: np.ndarray,
    bust_rate: float,
    rng: np.random.Generator,
    severity_low: float = DEFAULT_SEVERITY_LOW,
    severity_high: float = DEFAULT_SEVERITY_HIGH,
) -> np.ndarray:
    """Degrade a ``bust_rate`` fraction of simulated seasons multiplicatively.

    Args:
        season_totals: ``(n_samples, n_stats)`` simulated season totals.
        bust_rate: probability a given simulated season is a bust. ``<= 0``
            returns the input unchanged and draws nothing from ``rng``.
        rng: random generator (advanced in place only when ``bust_rate > 0``).
        severity_low, severity_high: bust seasons are scaled by a factor
            drawn uniformly from this range (a fraction of normal output).

    Returns:
        ``season_totals`` with the bust rows scaled down. Non-bust rows are
        returned untouched, so the median and the upper tail are unchanged.
    """
    if bust_rate <= 0.0:
        return season_totals
    if not 0.0 <= severity_low <= severity_high <= 1.0:
        raise ValueError(
            f"Require 0 <= severity_low <= severity_high <= 1; got "
            f"({severity_low}, {severity_high})."
        )
    n = season_totals.shape[0]
    bust = rng.random(n) < bust_rate
    severity = rng.uniform(severity_low, severity_high, size=n)
    factor = np.where(bust, severity, 1.0)
    return season_totals * factor[:, None]
