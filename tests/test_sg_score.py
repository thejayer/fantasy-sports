"""Unit tests for golf EOD scorer (roadmap 6.3 / 6.4d)."""

from sg.rounds import fixture_event_rounds, fixture_player_rounds
from sg.score import (
    build_scoreboard_payload,
    compare_h2h,
    score_round_slots,
    score_team_week,
    to_par_points,
)
from sg.settings import GolfSettings
from sg.snapshot import build_golf_snapshot


def test_neg_to_par_points():
    assert to_par_points(-3) == 3.0
    assert to_par_points(2) == -2.0
    assert to_par_points(None) == 0.0


def test_midweek_keeps_best_four():
    settings = GolfSettings()
    by_player = {
        pid: {
            1: {
                "player_id": pid,
                "round": 1,
                "to_par": -pid,
                "status": "active",
            }
        }
        for pid in range(1, 6)
    }
    # to_par -1..-5 → points 1..5; keep best four (2+3+4+5), drop 1.
    result = score_round_slots(
        starters=[1, 2, 3, 4, 5],
        alt1=6,
        alt2=None,
        round_num=1,
        by_player=by_player,
        settings=settings,
    )
    assert result["points"] == 5 + 4 + 3 + 2
    assert 1 in result["dropped_player_ids"]
    assert set(result["counted_player_ids"]) == {2, 3, 4, 5}


def test_weekend_alt_replaces_mc():
    settings = GolfSettings.model_validate({"missed_cut": {"mode": "alt1"}})
    by_player = {
        1: {3: {"player_id": 1, "round": 3, "to_par": None, "status": "mc"}},
        2: {3: {"player_id": 2, "round": 3, "to_par": -1, "status": "active"}},
        3: {3: {"player_id": 3, "round": 3, "to_par": 0, "status": "active"}},
        4: {3: {"player_id": 4, "round": 3, "to_par": 1, "status": "active"}},
        5: {3: {"player_id": 5, "round": 3, "to_par": 2, "status": "active"}},
        6: {3: {"player_id": 6, "round": 3, "to_par": -4, "status": "active"}},
    }
    result = score_round_slots(
        starters=[1, 2, 3, 4, 5],
        alt1=6,
        alt2=None,
        round_num=3,
        by_player=by_player,
        settings=settings,
    )
    assert result["points"] == 4 + 1 + 0 + (-1) + (-2)
    alt_slot = next(s for s in result["slots"] if s["starter_id"] == 1)
    assert alt_slot["source"] == "alt1"
    assert alt_slot["player_id"] == 6
    assert alt_slot["points"] == 4.0


def test_week_total_applies_multiplier_and_captain_tb():
    settings = GolfSettings()
    lineup = {
        "starters": [1, 2, 3, 4, 5],
        "captain": 5,
        "alt1": 6,
        "alt2": None,
    }
    rounds = fixture_event_rounds("test", list(range(1, 7)), miss_cut_every=0)
    scored = score_team_week(lineup, rounds, settings, multiplier=1.5)
    assert scored["week_total"] == scored["week_raw"] * 1.5
    assert scored["captain"] == 5
    home = scored
    away = {**scored, "week_total": scored["week_total"], "captain_week": scored["captain_week"] - 1}
    assert compare_h2h(home, away) == "W"
    assert compare_h2h(home, {**home, "week_total": home["week_total"] + 1}) == "L"


def test_build_golf_snapshot_includes_scoreboard():
    snap = build_golf_snapshot(
        league_id="golf-test",
        name="Test",
        season=2026,
        format="h2h",
        team_count=8,
        synced_at="2026-07-27T00:00:00+00:00",
    )
    board = snap["scoreboard"]
    assert board["current_event_id"] == "2026-players"
    assert len(board["events"]) == 2
    players = board["events"][0]
    assert players["multiplier"] == 1.5
    assert "1" in players["teams"]
    assert players["teams"]["1"]["week_total"] == players["teams"]["1"]["week_raw"] * 1.5
    assert len(players["pairings"]) == 4
    masters = board["events"][1]
    assert masters["multiplier"] == 2.0


def test_fixture_player_rounds_marks_cut():
    rows = fixture_player_rounds(7, miss_cut=True)
    assert rows[0]["status"] == "active"
    assert rows[2]["status"] == "mc"
    assert rows[3]["to_par"] is None
