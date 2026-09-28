"""Position aging curves — ported from Rinkside ``nhl.py``.

Typical year-over-year change in fantasy production by age, from public NHL
aging research: scoring rises through the early 20s, plateaus mid-20s
(forwards ~25–27, D ~27–28, goalies ~27–30), then declines ~1–10% a year after
28–29. Used to carry past NHL seasons forward to a player's current age.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

_AGE_F = {18: .15, 19: .12, 20: .10, 21: .08, 22: .06, 23: .04, 24: .02, 25: .01, 26: 0, 27: 0,
          28: -.01, 29: -.02, 30: -.03, 31: -.04, 32: -.05, 33: -.06, 34: -.08, 35: -.09, 36: -.10}
_AGE_D = {18: .15, 19: .12, 20: .10, 21: .08, 22: .07, 23: .05, 24: .03, 25: .02, 26: .01, 27: 0,
          28: 0, 29: -.01, 30: -.02, 31: -.03, 32: -.04, 33: -.05, 34: -.07, 35: -.08, 36: -.09}
_AGE_G = {20: .05, 21: .05, 22: .04, 23: .04, 24: .03, 25: .02, 26: .01, 27: 0, 28: 0, 29: 0,
          30: 0, 31: -.01, 32: -.02, 33: -.03, 34: -.04, 35: -.05, 36: -.06}


def yearly_change(age: int, group: str) -> float:
    """Expected change from age ``age`` to ``age + 1`` for group F / D / G."""
    table = _AGE_G if group == "G" else (_AGE_D if group == "D" else _AGE_F)
    lo, hi = min(table), max(table)
    return table[max(lo, min(hi, int(age)))]


def age_project(value: float | None, from_age: int | None, to_age: int | None,
                group: str) -> float | None:
    """Carry a past season's per-game value forward to his current age."""
    if value is None or from_age is None or to_age is None:
        return value
    out = float(value)
    for age in range(int(from_age), int(to_age)):
        out *= 1 + yearly_change(age, group)
    return out


def season_age(birth: Any, season_start_year: int) -> int | None:
    """Age on Oct 1 of the season's start year (NHL convention)."""
    try:
        born = dt.date.fromisoformat(str(birth)[:10])
    except (TypeError, ValueError):
        return None
    ref = dt.date(int(season_start_year), 10, 1)
    return ref.year - born.year - ((ref.month, ref.day) < (born.month, born.day))
