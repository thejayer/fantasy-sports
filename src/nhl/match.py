"""ESPN → NHL player matching — ported from Rinkside ``nhl.Matcher``.

Order (HOCKEY-PORT.md H1):

1. normalized full name + position group (F / D / G)
2. first initial + last name ("J.T. Miller" vs "JT Miller", nicknames)
3. NHL player search (active, then inactive) — done by :mod:`nhl.export`

Duplicate names are broken by the ESPN team, mapped through the explicit
:mod:`nhl.teams` table. A name that stays ambiguous is left unmatched rather
than guessed.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from nhl.teams import nhl_abbrev

_SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv)\b")


def norm(name: str | None) -> str:
    """Lowercase ASCII, no punctuation or suffixes: ``'Tim Stützle'`` → ``'tim stutzle'``."""
    text = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    text = re.sub(r"[^a-z ]", " ", text.replace("-", " ").replace("'", "").replace(".", ""))
    return " ".join(_SUFFIX.sub(" ", text).split())


def grp(position: Any) -> str:
    """Position group: ``G`` / ``D`` / ``F``.

    Works on NHL codes (``C``, ``L``, ``R``, ``D``, ``G``), ESPN fixture codes
    (``LW``, ``F``), and espn-api hockey names (``Center``, ``Defense``,
    ``Goalie``).
    """
    p = str(position or "").upper()
    return "G" if p.startswith("G") else ("D" if p.startswith("D") else "F")


class Matcher:
    """Match an ESPN name + position group (+ ESPN team for duplicates) to an NHL player."""

    def __init__(self, nhl_players: dict[int, dict[str, Any]]) -> None:
        self.full: dict[str, list[dict[str, Any]]] = {}
        self.last: dict[str, list[dict[str, Any]]] = {}
        for player in nhl_players.values():
            self.add(player)

    def add(self, player: dict[str, Any]) -> None:
        self.full.setdefault(norm(f"{player.get('first')} {player.get('last')}"), []).append(
            player
        )
        self.last.setdefault(norm(player.get("last")), []).append(player)

    @staticmethod
    def by_team(cands: list[dict[str, Any]], team_hint: Any) -> list[dict[str, Any]]:
        """Narrow duplicates to the ESPN team's NHL club; keep all if that finds none."""
        if len(cands) < 2:
            return cands
        team = nhl_abbrev(team_hint)
        if team is None:
            return cands
        hit = [p for p in cands if p.get("team") == team]
        return hit or cands

    def match(
        self, name: str | None, group: str, team_hint: Any = None
    ) -> tuple[dict[str, Any] | None, str | None]:
        """``(nhl player, method)`` where method is ``name`` / ``initial_last``."""
        n = norm(name)
        if not n:
            return None, None
        cands = self.full.get(n, [])
        cands = [p for p in cands if grp(p.get("pos")) == group] or cands
        cands = self.by_team(cands, team_hint)
        if len(cands) == 1:
            return cands[0], "name"
        if len(cands) > 1:
            return None, None  # same full name, still ambiguous: do not guess
        parts = n.split()
        team = nhl_abbrev(team_hint)
        for k in range(1, len(parts)):
            last = " ".join(parts[k:])
            first = "".join(parts[:k])
            found = [
                p
                for p in self.last.get(last, [])
                if grp(p.get("pos")) == group
                and norm(p.get("first"))[:1] == first[:1]
                # Same initial is not enough: "Patrick Rogers" must not become
                # "Peter Rogers" (or Jared → Jordan Staal) when the real player
                # is off every NHL roster. Needs a compatible first name
                # (Mitch/Mitchell, J.T./JT) or the ESPN team agreeing (Mike/Michael).
                and (_first_names_compatible(first, p.get("first")) or p.get("team") == team)
            ]
            found = self.by_team(found, team_hint)
            if len(found) == 1:
                return found[0], "initial_last"
        return None, None


def _first_names_compatible(espn_first: str, nhl_first: str | None) -> bool:
    """Initials or one name a prefix of the other ("mitch" / "mitchell", "jt" / "j")."""
    a = espn_first.replace(" ", "")
    b = norm(nhl_first).replace(" ", "")
    if not a or not b:
        return False
    return len(a) <= 2 or len(b) <= 2 or a.startswith(b) or b.startswith(a)


def pick_search_hit(
    hits: list[dict[str, Any]], name: str | None, group: str, team_hint: Any = None
) -> dict[str, Any] | None:
    """The one NHL search hit with this exact name + group (team breaks ties)."""
    wanted = norm(name)
    exact = [
        h
        for h in hits
        if norm(str(h.get("name", ""))) == wanted and grp(h.get("positionCode")) == group
    ]
    if len(exact) > 1:
        team = nhl_abbrev(team_hint)
        if team is not None:
            narrowed = [
                h for h in exact if team in (h.get("teamAbbrev"), h.get("lastTeamAbbrev"))
            ]
            exact = narrowed or exact
    return exact[0] if len(exact) == 1 else None
