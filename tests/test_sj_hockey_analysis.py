"""Season-points hockey analysis (roadmap 8.5 twin) — offline, no ESPN."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from sj.registry import LeagueSpec
from sj.season_points_analysis import (
    ANALYSIS_METHOD,
    HOCKEY_PROFILE,
    parse_mroster_period,
    period_date,
    sample_analysis_for_snapshot,
    slot_name_from_id,
    slot_row_totals,
    sync_season_points_analysis,
)
from sj.store import read_analysis


def _player(period: int, applied: float, *, source: int = 0, split: int = 5) -> dict:
    return {
        "id": 1,
        "stats": [
            {
                "statSourceId": source,
                "statSplitTypeId": split,
                "scoringPeriodId": period,
                "appliedTotal": applied,
            }
        ],
    }


def _entry(slot_id: int, applied: float, period: int, **stat_kw) -> dict:
    return {
        "lineupSlotId": slot_id,
        "playerPoolEntry": {
            "appliedStatTotal": applied * 1.7,  # must be ignored
            "player": _player(period, applied, **stat_kw),
        },
    }


def test_hockey_slot_names_collapse_wings_and_bench():
    assert slot_name_from_id(3, HOCKEY_PROFILE) == "Forward"
    assert slot_name_from_id(0, HOCKEY_PROFILE) == "Forward"  # Center
    assert slot_name_from_id(1, HOCKEY_PROFILE) == "Forward"  # LW
    assert slot_name_from_id(4, HOCKEY_PROFILE) == "Defense"
    assert slot_name_from_id(5, HOCKEY_PROFILE) == "Goalie"
    assert slot_name_from_id(6, HOCKEY_PROFILE) == "Util"
    assert slot_name_from_id(7, HOCKEY_PROFILE) == "BE"
    assert slot_name_from_id(8, HOCKEY_PROFILE) == "IR"
    assert slot_name_from_id("G", HOCKEY_PROFILE) == "Goalie"


def test_parse_mroster_credits_hockey_slots_not_ppe():
    payload = {
        "teams": [
            {
                "id": 2,
                "name": "Five Hole Heroes",
                "roster": {
                    "entries": [
                        _entry(3, 5.0, 1),  # Forward
                        _entry(4, 3.0, 1),  # Defense
                        _entry(5, 4.0, 1),  # Goalie
                        _entry(7, 9.0, 1),  # Bench
                    ]
                },
            }
        ]
    }
    parsed = parse_mroster_period(payload, 1, HOCKEY_PROFILE)
    assert parsed[2]["Forward"] == 5.0
    assert parsed[2]["Defense"] == 3.0
    assert parsed[2]["Goalie"] == 4.0
    assert parsed[2]["BE"] == 9.0
    derived = slot_row_totals(parsed[2], HOCKEY_PROFILE)
    assert derived["starters"] == 12.0
    assert derived["skaters"] == 8.0
    assert derived["goalies"] == 4.0
    assert derived["bench_il"] == 9.0
    assert "bats" not in derived
    assert "pitchers" not in derived


def test_hockey_period_date_uses_nhl_opening_night():
    assert period_date(2026, 1, profile=HOCKEY_PROFILE) == "2025-10-07"
    assert period_date(2027, 1, profile=HOCKEY_PROFILE) == "2026-10-07"
    assert period_date(2027, 2, profile=HOCKEY_PROFILE) == "2026-10-08"


def test_sync_hockey_writes_analysis(tmp_path: Path):
    spec = LeagueSpec(
        id="hockey-main",
        name="Hockey",
        short_name="Hockey",
        sport="hockey",
        format="redraft",
        platform="espn",
        espn_league_id=1023106173,
        seasons=[2026, 2027],
        current_season=2027,
    )
    snapshot = {
        "league_id": "hockey-main",
        "espn_league_id": 1023106173,
        "sport": "hockey",
        "season": 2027,
        "scoring_type": "TOTAL_SEASON_POINTS",
        "current_week": 2,
        "synced_at": "2026-09-28T00:00:00+00:00",
        "teams": [{"team_id": 1, "name": "Solo", "points_for": 20.0}],
    }

    def fetch_period(_league, period: int) -> dict:
        return {
            "teams": [
                {
                    "id": 1,
                    "name": "Solo",
                    "points": 20.0,
                    "roster": {"entries": [_entry(3, float(period), period)]},
                }
            ]
        }

    league = SimpleNamespace(
        year=2027,
        scoringPeriodId=2,
        finalScoringPeriod=2,
        espn_request=SimpleNamespace(league_get=lambda **_: {}),
    )
    written = sync_season_points_analysis(
        league,
        spec,
        2027,
        snapshot,
        store_dir=tmp_path,
        fetch_period=fetch_period,
        fetch_teams=lambda _l: None,
        throttle_seconds=0.0,
        profile=HOCKEY_PROFILE,
    )
    assert written == 2
    slot = read_analysis("hockey-main", 2027, "slot_points", store_dir=tmp_path)
    assert slot["sport"] == "hockey"
    assert slot["method"] == ANALYSIS_METHOD
    assert slot["slots"] == ["Forward", "Defense", "Goalie", "Util"]
    assert slot["teams"][0]["slots"]["Forward"] == 3.0
    assert slot["teams"][0]["skaters"] == 3.0
    assert slot["teams"][0]["goalies"] == 0.0
    series = read_analysis(
        "hockey-main", 2027, "points_timeseries", store_dir=tmp_path
    )
    assert series["teams"][0]["points"][-1]["cumulative_starters"] == 3.0
    assert series["teams"][0]["points"][0]["daily_skaters"] == 1.0
    assert "daily_bats" not in series["teams"][0]["points"][0]


def test_sync_hockey_skips_category_scoring(tmp_path: Path):
    spec = LeagueSpec(
        id="hockey-main",
        name="Hockey",
        short_name="Hockey",
        sport="hockey",
        format="redraft",
        platform="espn",
        espn_league_id=1023106173,
        seasons=[2027],
        current_season=2027,
    )
    n = sync_season_points_analysis(
        SimpleNamespace(),
        spec,
        2027,
        {"scoring_type": "H2H_CATEGORY", "current_week": 10, "teams": []},
        store_dir=tmp_path,
    )
    assert n == 0
    assert read_analysis("hockey-main", 2027, "slot_points", store_dir=tmp_path) is None


def test_sample_hockey_analysis_matches_snapshot_teams():
    snapshot = {
        "league_id": "hockey-main",
        "espn_league_id": 1023106173,
        "sport": "hockey",
        "season": 2027,
        "scoring_type": "TOTAL_SEASON_POINTS",
        "current_week": 8,
        "synced_at": "2026-09-28T00:00:00+00:00",
        "teams": [
            {"team_id": 1, "name": "Five Hole Heroes", "points_for": 2100.0},
            {"team_id": 2, "name": "Crease Crashers", "points_for": 1800.0},
        ],
    }
    slot_doc, series_doc = sample_analysis_for_snapshot(snapshot, HOCKEY_PROFILE)
    assert slot_doc["sport"] == "hockey"
    assert "period_slots" not in slot_doc
    top = slot_doc["teams"][0]
    assert top["starters"] > 0
    assert abs(top["starters"] - top["espn_points"]) / top["espn_points"] < 0.03
    assert top["skaters"] + top["goalies"] == pytest.approx(top["starters"], abs=0.2)
    last = series_doc["teams"][0]["points"][-1]
    assert last["period"] == 8
    assert last["cumulative_starters"] == pytest.approx(top["starters"], abs=0.2)


# --- H5b: games per starter slot (GP-cap pacing) ---------------------------


def _game_entry(slot_id: int, period: int, stats: dict | None, applied: float = 2.0) -> dict:
    line = {"statSourceId": 0, "statSplitTypeId": 5, "scoringPeriodId": period,
            "appliedTotal": applied}
    if stats is not None:
        line["stats"] = stats
    return {"lineupSlotId": slot_id, "playerPoolEntry": {"player": {"stats": [line]}}}


def test_daily_games_reads_gp_then_gs_then_line():
    from sj.season_points_analysis import daily_games

    def player(stats, period=3):
        return _game_entry(3, period, stats)["playerPoolEntry"]["player"]

    assert daily_games(player({"34": 1.0, "13": 1.0}), 3) == 1.0
    assert daily_games(player({"0": 1.0, "6": 30.0}), 3) == 1.0  # goalie GS
    assert daily_games(player({"34": 0.0}), 3) == 0.0
    assert daily_games(player(None), 3) == 1.0  # daily line, no GP key
    assert daily_games(player({"34": 1.0}), 3 + 1) == 0.0  # other day
    assert daily_games({"stats": []}, 3) == 0.0


def test_parse_mroster_games_counts_starter_slots_only():
    from sj.season_points_analysis import parse_mroster_games

    payload = {"teams": [{"id": 2, "roster": {"entries": [
        _game_entry(3, 1, {"34": 1.0}),  # Forward
        _game_entry(3, 1, {"34": 1.0}),  # Forward
        _game_entry(4, 1, {"34": 0.0}),  # Defense, did not play
        _game_entry(5, 1, {"0": 1.0}),   # Goalie start
        _game_entry(6, 1, {"34": 1.0}),  # Util
        _game_entry(7, 1, {"34": 1.0}),  # Bench: never counts
        _game_entry(8, 1, {"34": 1.0}),  # IR: never counts
    ]}}]}
    games = parse_mroster_games(payload, 1, HOCKEY_PROFILE)
    assert games[2] == {"Forward": 2.0, "Defense": 0.0, "Goalie": 1.0, "Util": 1.0}


def _hockey_spec() -> LeagueSpec:
    return LeagueSpec(
        id="hockey-main", name="Hockey", short_name="Hockey", sport="hockey",
        format="redraft", platform="espn", espn_league_id=1023106173,
        seasons=[2027], current_season=2027,
    )


def _hockey_snapshot(week: int) -> dict:
    return {
        "league_id": "hockey-main", "espn_league_id": 1023106173, "sport": "hockey",
        "season": 2027, "scoring_type": "TOTAL_SEASON_POINTS", "current_week": week,
        "synced_at": "2026-10-10T00:00:00+00:00",
        "teams": [{"team_id": 1, "name": "Solo", "points_for": 20.0}],
    }


def _league(week: int) -> SimpleNamespace:
    return SimpleNamespace(
        year=2027, scoringPeriodId=week, finalScoringPeriod=week,
        espn_request=SimpleNamespace(league_get=lambda **_: {}),
    )


def _games_payload(period: int) -> dict:
    return {"teams": [{"id": 1, "name": "Solo", "roster": {"entries": [
        _game_entry(3, period, {"34": 1.0}),
        _game_entry(5, period, {"0": 1.0} if period % 2 else {"0": 0.0}),
    ]}}]}


def test_sync_hockey_writes_games_and_reuses_them(tmp_path: Path):
    from sj.season_points_analysis import GAMES_METHOD

    calls: list[int] = []

    def fetch(_league, period: int) -> dict:
        calls.append(period)
        return _games_payload(period)

    kw = {"store_dir": tmp_path, "fetch_teams": lambda _l: None, "throttle_seconds": 0.0,
              "profile": HOCKEY_PROFILE}
    sync_season_points_analysis(_league(3), _hockey_spec(), 2027, _hockey_snapshot(3),
                                fetch_period=fetch, **kw)
    slot = read_analysis("hockey-main", 2027, "slot_points", store_dir=tmp_path)
    assert slot["games_method"] == GAMES_METHOD
    assert slot["teams"][0]["games"] == {"Forward": 3, "Defense": 0, "Goalie": 2, "Util": 0}
    assert sorted(calls) == [1, 2, 3]

    # Incremental: a new day only walks that day (plus nothing old).
    calls.clear()
    sync_season_points_analysis(_league(4), _hockey_spec(), 2027, _hockey_snapshot(4),
                                fetch_period=fetch, **kw)
    assert calls == [4]
    slot = read_analysis("hockey-main", 2027, "slot_points", store_dir=tmp_path)
    assert slot["teams"][0]["games"]["Forward"] == 4


def test_sync_hockey_rewalks_a_file_without_games(tmp_path: Path):
    from sj.store import write_analysis

    kw = {"store_dir": tmp_path, "fetch_teams": lambda _l: None, "throttle_seconds": 0.0,
              "profile": HOCKEY_PROFILE}
    sync_season_points_analysis(_league(2), _hockey_spec(), 2027, _hockey_snapshot(2),
                                fetch_period=lambda _l, p: _games_payload(p), **kw)
    old = read_analysis("hockey-main", 2027, "slot_points", store_dir=tmp_path)
    old.pop("period_games")
    old.pop("games_method")
    write_analysis(old, "slot_points", store_dir=tmp_path)

    calls: list[int] = []

    def fetch(_league, period: int) -> dict:
        calls.append(period)
        return _games_payload(period)

    sync_season_points_analysis(_league(2), _hockey_spec(), 2027, _hockey_snapshot(2),
                                fetch_period=fetch, **kw)
    assert sorted(calls) == [1, 2]
    slot = read_analysis("hockey-main", 2027, "slot_points", store_dir=tmp_path)
    assert slot["teams"][0]["games"]["Forward"] == 2


def test_baseball_analysis_has_no_games():
    from sj.season_points_analysis import BASEBALL_PROFILE, build_slot_points_document

    doc = build_slot_points_document(
        league_id="b", espn_league_id=1, season=2026, scoring_type="TOTAL_SEASON_POINTS",
        names={}, totals={}, espn_points={}, periods_ok=[], periods_failed=[],
        period_slots={}, synced_at=None, incremental=False, profile=BASEBALL_PROFILE,
        period_games={1: {}},
    )
    assert "games_method" not in doc and "period_games" not in doc


def test_sample_hockey_analysis_has_games():
    snapshot = _hockey_snapshot(20)
    snapshot["settings"] = {"position_slot_counts": {"F": 9, "D": 5, "G": 2, "UTIL": 1}}
    slot_doc, _ = sample_analysis_for_snapshot(snapshot, HOCKEY_PROFILE)
    games = slot_doc["teams"][0]["games"]
    assert set(games) == {"Forward", "Defense", "Goalie", "Util"}
    assert games["Forward"] > games["Defense"] > games["Goalie"] > 0


def test_analysis_never_walks_past_today():
    """ESPN finalScoringPeriod is the season's last day, not today."""
    from sj.season_points_analysis import analysis_periods, current_period

    mid = SimpleNamespace(scoringPeriodId=5, finalScoringPeriod=190)
    assert current_period(mid, {}) == 5
    assert analysis_periods(mid, {}) == [1, 2, 3, 4, 5]
    done = SimpleNamespace(scoringPeriodId=200, finalScoringPeriod=190)
    assert analysis_periods(done, {})[-1] == 190
    espn_api = SimpleNamespace(current_week=7, scoringPeriodId=7, finalScoringPeriod=190)
    assert analysis_periods(espn_api, {})[-1] == 7


def test_sync_hockey_records_season_length(tmp_path: Path):
    league = SimpleNamespace(
        year=2027, scoringPeriodId=2, finalScoringPeriod=190,
        espn_request=SimpleNamespace(league_get=lambda **_: {}),
    )
    calls: list[int] = []

    def fetch(_league, period: int) -> dict:
        calls.append(period)
        return _games_payload(period)

    sync_season_points_analysis(league, _hockey_spec(), 2027, _hockey_snapshot(2),
                                store_dir=tmp_path, fetch_period=fetch,
                                fetch_teams=lambda _l: None, throttle_seconds=0.0,
                                profile=HOCKEY_PROFILE)
    assert sorted(calls) == [1, 2]
    slot = read_analysis("hockey-main", 2027, "slot_points", store_dir=tmp_path)
    assert slot["periods"]["latest"] == 2
    assert slot["periods"]["final"] == 190
