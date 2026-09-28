"""Expected share of remaining games played (HOCKEY-PORT.md H3).

Ported from Rinkside ``recommend.games_rate``. Skaters blend ESPN's projected
GP (weight 1.5) with the last three NHL seasons' GP rate (1 / 0.6 / 0.35,
pulled 40% toward 90% because injuries are partly luck), clamped to 50–100%.
Rookies without history default to 90%. Goalies use their share of the club's
starts. Iron man = 95%+.

Later: port the backtested ``ffa.games`` GamesModel (the better version).
"""

from __future__ import annotations

from dataclasses import dataclass

SEASON_GAMES = 82
DEFAULT_RATE = 0.90
IRON_MAN = 0.95
FLOOR, CEILING = 0.50, 1.00
ESPN_WEIGHT = 1.5
HISTORY_WEIGHT = 1.0
DECAY = {1: 1.0, 2: 0.6, 3: 0.35}
PULL_TO_TYPICAL = 0.4


@dataclass(frozen=True)
class Durability:
    rate: float
    basis: str
    iron_man: bool

    def as_dict(self) -> dict[str, object]:
        return {"rate": self.rate, "basis": self.basis, "iron_man": self.iron_man}


def skater_rate(
    espn_projected_gp: float | None,
    history: list[tuple[int, int]],
) -> Durability:
    """``history`` is ``[(games played, seasons ago)]`` for prior NHL seasons."""
    parts: list[tuple[float, float]] = []
    notes: list[str] = []
    if espn_projected_gp is not None and 20 <= espn_projected_gp <= 84:
        parts.append((min(espn_projected_gp / SEASON_GAMES, 1.0), ESPN_WEIGHT))
        notes.append(f"ESPN projects {espn_projected_gp:g} GP")
    played = sorted(((gp, ago) for gp, ago in history if gp > 0), key=lambda x: x[1])
    if len(played) >= 2 or (played and played[0][1] == 1 and played[0][0] >= 60):
        weight = sum(DECAY.get(ago, 0.3) for _, ago in played)
        rate_h = sum(min(gp / SEASON_GAMES, 1.0) * DECAY.get(ago, 0.3) for gp, ago in played) / weight
        rate_h = (1 - PULL_TO_TYPICAL) * rate_h + PULL_TO_TYPICAL * DEFAULT_RATE
        parts.append((rate_h, HISTORY_WEIGHT))
        notes.append("played " + ", ".join(str(gp) for gp, _ in played) + " GP in recent seasons")
    if not parts:
        return Durability(DEFAULT_RATE, "no durability history; assuming 90% of games", False)
    rate = sum(v * w for v, w in parts) / sum(w for _, w in parts)
    rate = round(max(FLOOR, min(CEILING, rate)), 3)
    return Durability(rate, "; ".join(notes), rate >= IRON_MAN)


def goalie_rate(start_share: float | None, basis: str | None) -> Durability:
    """A goalie's games are his share of the club's starts."""
    if start_share is None:
        return Durability(DEFAULT_RATE, "no start share yet; assuming 90% of games", False)
    rate = round(max(0.0, min(CEILING, float(start_share))), 3)
    return Durability(rate, f"{rate:.0%} of starts ({basis or 'NHL'})", rate >= IRON_MAN)
