"""League scoring configuration.

A ``LeagueConfig`` is a plain data container loaded from a YAML file. The
scoring engine in :mod:`ffa.scoring` is a pure function over a ``LeagueConfig``
and a stats DataFrame, so any league variant (standard, PPR, half-PPR, bonuses,
IDP) is expressed as data rather than code.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, Field, NonNegativeFloat, NonNegativeInt, PositiveInt


class YardageBonus(BaseModel):
    """A flat bonus when a stat crosses a threshold (e.g. 100+ rush yards)."""

    threshold: NonNegativeFloat
    points: float


class PassingRules(BaseModel):
    yards_per_point: NonNegativeFloat = 25.0
    td_points: float = 4.0
    int_points: float = -2.0
    two_point_conversion: float = 2.0
    bonuses: list[YardageBonus] = Field(default_factory=list)


class RushingRules(BaseModel):
    yards_per_point: NonNegativeFloat = 10.0
    td_points: float = 6.0
    two_point_conversion: float = 2.0
    bonuses: list[YardageBonus] = Field(default_factory=list)


class ReceivingRules(BaseModel):
    yards_per_point: NonNegativeFloat = 10.0
    td_points: float = 6.0
    reception_points: float = 0.0
    two_point_conversion: float = 2.0
    bonuses: list[YardageBonus] = Field(default_factory=list)


class MiscRules(BaseModel):
    fumble_lost: float = -2.0
    return_td: float = 6.0


class KickingRules(BaseModel):
    pat_made: float = 1.0
    fg_0_39: float = 3.0
    fg_40_49: float = 4.0
    fg_50_plus: float = 5.0
    fg_missed: float = 0.0


class RosterRules(BaseModel):
    """Roster slots per team and league size.

    ``flex`` is RB/WR/TE-eligible by convention. For VOR we split the flex
    pool evenly across those three positions (a common approximation; for a
    league with a TE-premium flex, edit ``flex_split`` accordingly).
    """

    teams: PositiveInt = 12
    qb: NonNegativeInt = 1
    rb: NonNegativeInt = 2
    wr: NonNegativeInt = 2
    te: NonNegativeInt = 1
    flex: NonNegativeInt = 1
    k: NonNegativeInt = 1
    dst: NonNegativeInt = 1
    bench: NonNegativeInt = 6
    flex_split: dict[str, float] = Field(
        default_factory=lambda: {"RB": 1 / 3, "WR": 1 / 3, "TE": 1 / 3}
    )

    def starters_at(self, position: str) -> float:
        """Per-team starter count at a position, including flex share."""
        pos = position.upper()
        base = {
            "QB": self.qb,
            "RB": self.rb,
            "WR": self.wr,
            "TE": self.te,
            "K": self.k,
            "DST": self.dst,
        }.get(pos, 0)
        return float(base) + self.flex * self.flex_split.get(pos, 0.0)

    def replacement_index(self, position: str) -> int:
        """0-indexed rank of the 'first non-starter' at this position.

        Across the whole league, ``teams * starters_at(pos)`` players are
        drafted as starters. The replacement-level player is the next one
        down -- so the index ``teams * starters_at(pos)`` (0-indexed) is
        what we compare against for VOR.
        """
        return int(round(self.teams * self.starters_at(position)))


class LeagueConfig(BaseModel):
    """Top-level league config.

    All sub-rule blocks have sensible defaults so YAML can stay minimal --
    only override what differs from a standard non-PPR league.
    """

    name: str = "standard"
    passing: PassingRules = Field(default_factory=PassingRules)
    rushing: RushingRules = Field(default_factory=RushingRules)
    receiving: ReceivingRules = Field(default_factory=ReceivingRules)
    misc: MiscRules = Field(default_factory=MiscRules)
    kicking: KickingRules = Field(default_factory=KickingRules)
    roster: RosterRules = Field(default_factory=RosterRules)


def load_league(path: str | Path) -> LeagueConfig:
    """Load and validate a league config from a YAML file."""
    raw = yaml.safe_load(Path(path).read_text())
    return LeagueConfig.model_validate(raw or {})
