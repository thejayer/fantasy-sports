"""espn-api 0.46 hockey shims for incomplete schedule rows.

Hockey ``BoxScore``, ``Matchup``, and ``Team._fetch_schedule`` index
schedule dicts with bare ``data['…']``. BYE, preseason, and
TOTAL_SEASON_POINTS scoreboard rows omit those keys, which failed
``sj-sync`` one KeyError at a time (#160 was ``winner``; next was
``home``).

Audited constructor keys (0.46):

* ``BoxScore.__init__``: ``winner``, ``home``, ``home['teamId']``.
  ``away`` is already optional (BYE).
* ``Matchup._fetch_matchup_info``: ``home['teamId']``,
  ``home['totalPoints']``, ``away['teamId']``, ``away['totalPoints']``,
  ``winner``. Nested ``cumulativeScore`` is gated on the key existing.
* ``Team._fetch_schedule``: ``match['away']['teamId']`` then
  ``match['home']['teamId']`` after an ``'away' in match`` check — a
  row with away and no home raises ``KeyError('home')`` during
  ``League()``.
"""

from __future__ import annotations

from typing import Any

UNDECIDED_WINNER = "UNDECIDED"
EMPTY_SIDE: dict[str, Any] = {"teamId": 0, "totalPoints": 0}

# Bare keys the 0.46 hockey schedule constructors require.
INCOMPLETE_MATCHUP_KEYS = frozenset(
    {"winner", "home", "away", "teamId", "totalPoints"}
)

_installed = False
_orig_box_score_init: Any = None
_orig_matchup_fetch: Any = None
_orig_team_fetch_schedule: Any = None


def is_incomplete_matchup_error(exc: BaseException) -> bool:
    """True when espn-api raised ``KeyError`` on a schedule-row key."""
    if not isinstance(exc, KeyError) or not exc.args:
        return False
    return exc.args[0] in INCOMPLETE_MATCHUP_KEYS


def is_missing_winner_error(exc: BaseException) -> bool:
    """Backward-compatible alias for :func:`is_incomplete_matchup_error`."""
    return is_incomplete_matchup_error(exc)


def _coerce_side(side: Any) -> dict[str, Any]:
    """Copy a home/away payload so ``teamId`` / ``totalPoints`` exist."""
    if not isinstance(side, dict):
        return dict(EMPTY_SIDE)
    if "teamId" in side and "totalPoints" in side:
        return side
    filled = dict(side)
    filled.setdefault("teamId", 0)
    filled.setdefault("totalPoints", 0)
    return filled


def coerce_schedule_row(data: Any, *, require_away: bool = False) -> Any:
    """Defensive copy filling keys espn-api 0.46 hockey constructors require.

    Leaves the input untouched. Non-dicts pass through. ``BoxScore`` treats
    a missing ``away`` as BYE, so we only invent an away side when
    ``require_away`` (Matchup / team schedule) or the row already has one.
    """
    if not isinstance(data, dict):
        return data

    home = _coerce_side(data.get("home"))
    winner = data.get("winner", UNDECIDED_WINNER)
    has_away = "away" in data
    need_away = require_away or has_away
    away = _coerce_side(data.get("away")) if need_away else None

    home_changed = home is not data.get("home")
    winner_changed = "winner" not in data
    if need_away:
        away_changed = (not has_away) or (away is not data.get("away"))
    else:
        away_changed = False
    if not (home_changed or winner_changed or away_changed):
        return data

    out = dict(data)
    out["winner"] = winner
    out["home"] = home
    if need_away:
        out["away"] = away
    return out


def with_default_winner(data: Any) -> Any:
    """Fill ``winner`` plus any other BoxScore-required schedule keys."""
    return coerce_schedule_row(data, require_away=False)


def box_has_team(box: Any) -> bool:
    """False for a dummy box invented from an empty schedule row."""

    def _id(value: Any) -> int | None:
        if value is None:
            return None
        tid = getattr(value, "team_id", None)
        if tid is not None:
            try:
                return int(tid)
            except (TypeError, ValueError):
                return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    return bool(_id(getattr(box, "home_team", None))) or bool(
        _id(getattr(box, "away_team", None))
    )


def unpatched_box_score_init() -> Any:
    """espn-api ``BoxScore.__init__`` from before :func:`install_matchup_guards`."""
    if _orig_box_score_init is not None:
        return _orig_box_score_init
    from espn_api.hockey.box_score import BoxScore

    return BoxScore.__init__


def unpatched_matchup_fetch() -> Any:
    """espn-api ``Matchup._fetch_matchup_info`` from before the guard."""
    if _orig_matchup_fetch is not None:
        return _orig_matchup_fetch
    from espn_api.hockey.matchup import Matchup

    return Matchup._fetch_matchup_info


def unpatched_team_fetch_schedule() -> Any:
    """espn-api ``Team._fetch_schedule`` from before the guard."""
    if _orig_team_fetch_schedule is not None:
        return _orig_team_fetch_schedule
    from espn_api.hockey.team import Team

    return Team._fetch_schedule


def install_matchup_guards() -> None:
    """Teach hockey BoxScore/Matchup/Team to tolerate incomplete rows.

    Patching the class is enough: ``league.py`` holds the same objects.
    Idempotent. Copies payloads — never mutates the ESPN response.
    """
    global _installed, _orig_box_score_init, _orig_matchup_fetch
    global _orig_team_fetch_schedule
    if _installed:
        return

    from espn_api.hockey.box_score import BoxScore
    from espn_api.hockey.matchup import Matchup
    from espn_api.hockey.team import Team

    _orig_box_score_init = BoxScore.__init__
    _orig_matchup_fetch = Matchup._fetch_matchup_info
    _orig_team_fetch_schedule = Team._fetch_schedule

    def box_init(self: Any, data: Any, pro_schedule: Any, by_matchup: Any) -> None:
        _orig_box_score_init(
            self,
            coerce_schedule_row(data, require_away=False),
            pro_schedule,
            by_matchup,
        )

    def fetch_info(self: Any, data: Any) -> None:
        _orig_matchup_fetch(self, coerce_schedule_row(data, require_away=True))

    def fetch_schedule(self: Any, data: Any) -> None:
        for match in data or []:
            if not isinstance(match, dict) or "away" not in match:
                continue
            safe = coerce_schedule_row(match, require_away=True)
            away_id = (safe.get("away") or {}).get("teamId")
            home_id = (safe.get("home") or {}).get("teamId")
            if away_id == self.team_id:
                new_match = Matchup(safe)
                new_match.away_team = self
                self.schedule.append(new_match)
            elif home_id == self.team_id:
                new_match = Matchup(safe)
                new_match.home_team = self
                self.schedule.append(new_match)

    BoxScore.__init__ = box_init  # type: ignore[method-assign]
    Matchup._fetch_matchup_info = fetch_info  # type: ignore[method-assign]
    Team._fetch_schedule = fetch_schedule  # type: ignore[method-assign]
    _installed = True
