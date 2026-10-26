"""Configurable paper staking: 1u flat or capped fractional Kelly."""

from __future__ import annotations

from dataclasses import dataclass

from sj.bets import american_to_decimal
from sj.bot import (
    DEFAULT_BANKROLL,
    DEFAULT_KELLY_CAP,
    DEFAULT_KELLY_FRACTION,
    DEFAULT_UNIT,
    env_float,
    staking_mode,
)
from sj.bot.odds import implied_prob


@dataclass(frozen=True)
class StakeConfig:
    mode: str = "flat"
    unit: float = DEFAULT_UNIT
    bankroll: float = DEFAULT_BANKROLL
    kelly_fraction: float = DEFAULT_KELLY_FRACTION
    kelly_cap: float = DEFAULT_KELLY_CAP

    @classmethod
    def from_env(cls) -> StakeConfig:
        return cls(
            mode=staking_mode(),
            unit=env_float("SJ_BOT_UNIT", DEFAULT_UNIT),
            bankroll=env_float("SJ_BOT_BANKROLL", DEFAULT_BANKROLL),
            kelly_fraction=env_float("SJ_BOT_KELLY_FRACTION", DEFAULT_KELLY_FRACTION),
            kelly_cap=env_float("SJ_BOT_KELLY_CAP", DEFAULT_KELLY_CAP),
        )


def kelly_full(american: float, p_win: float) -> float:
    """Full Kelly fraction of bankroll. Negative when there is no edge."""
    dec = american_to_decimal(float(american))
    if dec is None or dec <= 1 or p_win <= 0 or p_win >= 1:
        return 0.0
    b = dec - 1.0
    q = 1.0 - p_win
    return (b * p_win - q) / b


def clamp_units(value: float, *, cap: float, floor: float = 0.25) -> float:
    if value <= 0:
        return 0.0
    return round(min(cap, max(floor, value)), 2)


def stake_units(config: StakeConfig, american: float, p_win: float) -> float:
    """Units to put on a paper bet. Flat ignores ``p_win``."""
    if config.mode != "kelly":
        return round(max(config.unit, 0.0), 2)
    full = kelly_full(american, p_win)
    if full <= 0:
        return 0.0
    raw = full * config.kelly_fraction * config.bankroll
    return clamp_units(raw, cap=config.kelly_cap, floor=config.unit * 0.25)


def score_to_p_win(score: float, american: float | None = None) -> float:
    """Map a blended signal score in [-1, 1] onto a win probability.

    Starts at the market implied price (or 0.5) and shifts by up to ±12
    percentage points so the bot stays explainable and never claims 90%.
    """
    base = implied_prob(american) if american is not None else None
    if base is None:
        base = 0.5
    shift = max(-1.0, min(1.0, score)) * 0.12
    return max(0.05, min(0.95, base + shift))
