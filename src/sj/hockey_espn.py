"""espn-api 0.46 hockey shims for incomplete schedule rows.

Hockey ``BoxScore`` and ``Matchup`` both do ``data['winner']``. BYE,
preseason, and TOTAL_SEASON_POINTS scoreboard rows often omit that key,
which raised ``KeyError: 'winner'`` and failed ``sj-sync`` after #159
stopped passing football's ``week=`` into ``box_scores``.
"""

from __future__ import annotations

from typing import Any

UNDECIDED_WINNER = "UNDECIDED"

_installed = False
_orig_box_score_init: Any = None
_orig_matchup_fetch: Any = None


def is_missing_winner_error(exc: BaseException) -> bool:
    """True when espn-api raised ``KeyError('winner')`` on a schedule row."""
    return isinstance(exc, KeyError) and exc.args[:1] == ("winner",)


def with_default_winner(data: Any) -> Any:
    """Copy an ESPN schedule dict and default a missing ``winner``.

    Leaves non-dicts and rows that already have ``winner`` unchanged so we
    do not mutate the live ESPN payload.
    """
    if not isinstance(data, dict) or "winner" in data:
        return data
    return {**data, "winner": UNDECIDED_WINNER}


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


def install_matchup_guards() -> None:
    """Teach hockey BoxScore/Matchup to default a missing ``winner``.

    Patching the class is enough: ``league.py`` and ``team.py`` hold the
    same class objects. Idempotent.
    """
    global _installed, _orig_box_score_init, _orig_matchup_fetch
    if _installed:
        return

    from espn_api.hockey.box_score import BoxScore
    from espn_api.hockey.matchup import Matchup

    _orig_box_score_init = BoxScore.__init__
    _orig_matchup_fetch = Matchup._fetch_matchup_info

    def box_init(self: Any, data: Any, pro_schedule: Any, by_matchup: Any) -> None:
        _orig_box_score_init(
            self, with_default_winner(data), pro_schedule, by_matchup
        )

    def fetch_info(self: Any, data: Any) -> None:
        _orig_matchup_fetch(self, with_default_winner(data))

    BoxScore.__init__ = box_init  # type: ignore[method-assign]
    Matchup._fetch_matchup_info = fetch_info  # type: ignore[method-assign]
    _installed = True
