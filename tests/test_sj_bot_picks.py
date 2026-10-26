"""Pick construction uses signals and stays inside 3–8 slips."""

from __future__ import annotations

from datetime import date, datetime, timezone

from sj.bot.odds import parse_espn_scoreboard
from sj.bot.picks import propose_picks
from sj.bot.sample import sample_espn_scoreboard, sample_group_sidecars
from sj.bot.signals import default_weights, evaluate_signals
from sj.bot.staking import StakeConfig


def _games(*sports: str):
    day = date(2026, 10, 25)
    games = []
    for sport in sports or ("NFL", "CFB", "NBA"):
        games.extend(parse_espn_scoreboard(sample_espn_scoreboard(sport, day, steam=1.0), sport))
    return games


def test_evaluate_signals_are_labeled_and_weighted():
    game = _games("NFL")[0]
    splits, tailing = sample_group_sidecars()
    signals = evaluate_signals(
        game=game,
        market="spread",
        side="away",
        open_line=-2.5,
        current_line=-3.5,
        american=-110,
        weights=default_weights(),
        scorecard={"rows": []},
        splits=splits,
        tailing=tailing,
    )
    ids = [row["id"] for row in signals]
    assert ids == [
        "line_move",
        "clv",
        "group_hot",
        "tail",
        "fade",
        "own_form",
        "team_form",
    ]
    steam = next(row for row in signals if row["id"] == "line_move")
    assert steam["value"] > 0
    assert "opened" in steam["note"]
    assert all("weight" in row for row in signals)


def test_propose_picks_caps_and_explains():
    games = _games("NFL", "CFB", "NBA")
    splits, tailing = sample_group_sidecars()
    picks = propose_picks(
        games,
        history=[],
        weights=default_weights(),
        scorecard={"rows": []},
        splits=splits,
        tailing=tailing,
        stake=StakeConfig(mode="flat", unit=1),
        min_picks=3,
        max_picks=8,
        now=datetime(2026, 10, 25, 12, tzinfo=timezone.utc),
    )
    assert 3 <= len(picks) <= 8
    assert all(p["who"] == "SJ Bot" for p in picks)
    assert all(p["result"] == "Pending" for p in picks)
    assert all(p["units"] == 1 for p in picks)
    assert all(p["reason"] for p in picks)
    assert all(p["signals"] for p in picks)
    keys = {(p["game_id"], p["market"]) for p in picks}
    assert len(keys) == len(picks)
    assert picks[0]["id"].startswith("BOT-20261025-")
