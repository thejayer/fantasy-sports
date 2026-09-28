"""NHL franchises and the ESPN → NHL team code table.

espn-api hockey reports ``proTeam`` as a full name ("Los Angeles Kings",
"Montréal Canadiens", "Utah Hockey Club"); ESPN's own site and the committed
fixtures use short codes ("LA", "NJ", "TB"). The NHL API uses three-letter
codes ("LAK", "NJD", "TBL"). Rinkside guessed with fuzzy word overlap; an
explicit table is easier to test and never matches the wrong club.
"""

from __future__ import annotations

import re
import unicodedata

# (NHL abbrev, current full name, other names / ESPN codes that mean this club)
_FRANCHISES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("ANA", "Anaheim Ducks", ()),
    ("BOS", "Boston Bruins", ()),
    ("BUF", "Buffalo Sabres", ()),
    ("CGY", "Calgary Flames", ("CAL",)),
    ("CAR", "Carolina Hurricanes", ()),
    ("CHI", "Chicago Blackhawks", ()),
    ("COL", "Colorado Avalanche", ()),
    ("CBJ", "Columbus Blue Jackets", ("CLB", "CLS")),
    ("DAL", "Dallas Stars", ()),
    ("DET", "Detroit Red Wings", ()),
    ("EDM", "Edmonton Oilers", ()),
    ("FLA", "Florida Panthers", ()),
    ("LAK", "Los Angeles Kings", ("LA",)),
    ("MIN", "Minnesota Wild", ()),
    ("MTL", "Montreal Canadiens", ("MON",)),
    ("NSH", "Nashville Predators", ("NAS",)),
    ("NJD", "New Jersey Devils", ("NJ",)),
    ("NYI", "New York Islanders", ()),
    ("NYR", "New York Rangers", ()),
    ("OTT", "Ottawa Senators", ()),
    ("PHI", "Philadelphia Flyers", ()),
    ("PIT", "Pittsburgh Penguins", ()),
    ("SJS", "San Jose Sharks", ("SJ",)),
    ("SEA", "Seattle Kraken", ()),
    ("STL", "St. Louis Blues", ("Saint Louis Blues",)),
    ("TBL", "Tampa Bay Lightning", ("TB",)),
    ("TOR", "Toronto Maple Leafs", ()),
    ("UTA", "Utah Mammoth", ("Utah Hockey Club", "UTAH")),
    ("VAN", "Vancouver Canucks", ()),
    ("VGK", "Vegas Golden Knights", ("VEG", "LV")),
    ("WSH", "Washington Capitals", ("WAS",)),
    ("WPG", "Winnipeg Jets", ("WIN",)),
)

NHL_ABBREVS: tuple[str, ...] = tuple(sorted(abbrev for abbrev, _, _ in _FRANCHISES))
NHL_NAMES: dict[str, str] = {abbrev: name for abbrev, name, _ in _FRANCHISES}


def _key(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", text.lower())


_LOOKUP: dict[str, str] = {}
for _abbrev, _name, _aliases in _FRANCHISES:
    for _alias in (_abbrev, _name, *_aliases):
        _LOOKUP[_key(_alias)] = _abbrev


def nhl_abbrev(team: object) -> str | None:
    """NHL three-letter code for an ESPN team name/code, or None if unknown.

    Defunct clubs ("Arizona Coyotes") and ESPN's "Unknown Team" / "FA" map to
    None — a missing team is a gap, not a guess.
    """
    if team is None:
        return None
    key = _key(str(team))
    return _LOOKUP.get(key) if key else None


def last_team(teams: object) -> str | None:
    """``'TOR,DAL'`` or ``'TOR, DAL'`` (NHL stats ``teamAbbrevs``) → ``'DAL'``."""
    parts = [t.strip() for t in str(teams or "").split(",") if t.strip()]
    return parts[-1] if parts else None
