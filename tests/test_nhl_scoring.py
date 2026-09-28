"""Hockey league scoring (HOCKEY-PORT.md H0)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from nhl.scoring import (
    STAT_IDS,
    compare_scoring,
    league_scoring,
    load_scoring_override,
    resolve_scoring,
    score_line,
)

ROOT = Path(__file__).resolve().parents[1]

SJ_HOCKEY = {
    "G": 2, "A": 1, "PPG": 1, "PPA": 0.5, "SHG": 1, "SHA": 0.5, "SHP": 0.5, "GWG": 1,
    "HAT": 2, "SOG": 0.5, "HIT": 0.1, "BLK": 0.5,
    "W": 4, "L": -2, "GA": -2, "SV": 0.35, "SO": 3,
}


def test_override_is_sj_hockey():
    rules = load_scoring_override()
    assert rules.source == "override"
    assert rules.weights == SJ_HOCKEY
    assert rules.lineup == {"F": 9, "D": 5, "UTIL": 1, "G": 2, "BE": 7, "IR": 3}
    assert rules.gp_caps == {"F": 855, "D": 475, "UTIL": 95, "G": 164}


def test_override_stat_ids_match_espn_api():
    from espn_api.hockey.constant import STATS_MAP

    for abbr in SJ_HOCKEY:
        assert STATS_MAP[str(STAT_IDS[abbr])] == abbr


def test_fixture_snapshot_scoring_comes_from_espn_settings():
    snapshot = json.loads(
        (ROOT / "fixtures" / "sj" / "hockey-main" / "2027.json").read_text(encoding="utf-8")
    )
    rules = league_scoring(snapshot)
    assert rules is not None and rules.source == "espn"
    assert rules.weights == SJ_HOCKEY
    assert rules.lineup == {"F": 9, "D": 5, "UTIL": 1, "G": 2, "BE": 7, "IR": 3}
    assert rules.gp_caps == {"F": 855, "D": 475, "UTIL": 95, "G": 164}
    assert compare_scoring(rules.weights, load_scoring_override().weights) == []


def test_fixture_league_is_season_points_without_weekly_matchups():
    """SJ Hockey: total points for the whole regular season, no H2H."""
    snapshot = json.loads(
        (ROOT / "fixtures" / "sj" / "hockey-main" / "2027.json").read_text(encoding="utf-8")
    )
    assert snapshot["scoring_type"] == "TOTAL_SEASON_POINTS"
    assert snapshot["settings"]["playoff_team_count"] == 0
    teams = sorted(snapshot["teams"], key=lambda t: t["standing"])
    assert all(not t["schedule"] and t["wins"] == 0 and t["losses"] == 0 for t in teams)
    points = [t["points_for"] for t in teams]
    assert points == sorted(points, reverse=True)


def test_resolve_prefers_espn_and_falls_back_to_override():
    snapshot = {"settings": {"categories": [{"abbr": "G", "points": 5}]}}
    assert resolve_scoring(snapshot).weights == {"G": 5.0}
    assert resolve_scoring(snapshot, use_override=True).source == "override"
    assert resolve_scoring({"settings": {}}).source == "override"
    assert resolve_scoring(None).source == "override"


def test_league_scoring_skips_unweighted_categories():
    snapshot = {"settings": {"categories": [
        {"abbr": "G", "points": 2}, {"abbr": "SV%", "points": None}, {"points": 1},
    ]}}
    assert league_scoring(snapshot).weights == {"G": 2.0}
    assert league_scoring({"settings": {"categories": []}}) is None


def test_score_line_skater_and_goalie():
    skater = {"G": 30, "A": 40, "PPG": 10, "PPA": 15, "SOG": 240, "HIT": 45, "BLK": 20}
    # 60 + 40 + 10 + 7.5 + 120 + 4.5 + 10
    assert score_line(skater, SJ_HOCKEY) == pytest.approx(252.0)
    goalie = {"W": 30, "L": 15, "GA": 140, "SV": 1400, "SO": 4}
    # 120 - 30 - 280 + 490 + 12
    assert score_line(goalie, SJ_HOCKEY) == pytest.approx(312.0)


def test_score_line_missing_data_is_null_not_zero():
    assert score_line(None, SJ_HOCKEY) is None
    assert score_line({}, SJ_HOCKEY) is None
    assert score_line({"PIM": 40}, SJ_HOCKEY) is None
    assert score_line({"G": 0}, SJ_HOCKEY) == 0.0  # a real zero stays zero


def test_compare_scoring_lists_differences():
    assert compare_scoring({"G": 3, "A": 1}, {"G": 2, "A": 1, "SO": 3}) == [
        ("G", 2, 3),
        ("SO", 3, None),
    ]
