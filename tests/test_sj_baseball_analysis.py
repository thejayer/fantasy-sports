"""Season-points baseball analysis (roadmap 8.5) — offline, no ESPN."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from sj.baseball_analysis import (
    ANALYSIS_METHOD,
    add_slot_maps,
    build_team_slot_rows,
    build_timeseries_teams,
    daily_applied_total,
    existing_period_slots,
    parse_mroster_period,
    period_date,
    sample_baseball_analysis_for_snapshot,
    slot_name_from_id,
    slot_row_totals,
    sync_baseball_analysis,
)
from sj.registry import LeagueSpec
from sj.store import FileStore, read_analysis

ROOT = Path(__file__).resolve().parents[1]


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


def test_slot_name_from_id_collapses_flex_and_of():
    assert slot_name_from_id(0) == "C"
    assert slot_name_from_id(13) == "P"
    assert slot_name_from_id(15) == "RP"
    assert slot_name_from_id(16) == "BE"
    assert slot_name_from_id(8) == "OF"  # LF
    assert slot_name_from_id(14) == "P"  # SP
    assert slot_name_from_id(6) == "UTIL"  # 2B/SS
    assert slot_name_from_id("DH") == "DH"


def test_daily_applied_total_ignores_projected_and_wrong_period():
    player = {
        "stats": [
            {
                "statSourceId": 1,
                "statSplitTypeId": 5,
                "scoringPeriodId": 3,
                "appliedTotal": 99.0,
            },
            {
                "statSourceId": 0,
                "statSplitTypeId": 5,
                "scoringPeriodId": 2,
                "appliedTotal": 4.5,
            },
            {
                "statSourceId": 0,
                "statSplitTypeId": 5,
                "scoringPeriodId": 3,
                "appliedTotal": 12.0,
            },
        ]
    }
    assert daily_applied_total(player, 3) == 12.0
    assert daily_applied_total(player, 2) == 4.5
    assert daily_applied_total(player, 9) is None


def test_parse_mroster_credits_slot_not_applied_stat_total():
    payload = {
        "teams": [
            {
                "id": 4,
                "name": "Okiro",
                "roster": {
                    "entries": [
                        _entry(0, 5.0, 1),  # C
                        _entry(13, 10.0, 1),  # P
                        _entry(16, 7.0, 1),  # BE
                        _entry(17, 1.0, 1),  # IL
                    ]
                },
            }
        ]
    }
    parsed = parse_mroster_period(payload, 1)
    assert parsed[4]["C"] == 5.0
    assert parsed[4]["P"] == 10.0
    assert parsed[4]["BE"] == 7.0
    assert parsed[4]["IL"] == 1.0
    derived = slot_row_totals(parsed[4])
    assert derived["starters"] == 15.0
    assert derived["bats"] == 5.0
    assert derived["pitchers"] == 10.0
    assert derived["bench_il"] == 8.0


def test_parse_skips_ppe_applied_stat_total_when_no_daily_stat():
    payload = {
        "teams": [
            {
                "id": 1,
                "roster": {
                    "entries": [
                        {
                            "lineupSlotId": 0,
                            "playerPoolEntry": {
                                "appliedStatTotal": 400.0,
                                "player": {"id": 9, "stats": []},
                            },
                        }
                    ]
                },
            }
        ]
    }
    parsed = parse_mroster_period(payload, 1)
    assert parsed[1]["C"] == 0.0


def test_cumulative_series_and_bats_pitchers_split():
    day1 = {1: {"C": 2.0, "P": 3.0, "BE": 1.0, **{s: 0.0 for s in ("1B", "2B", "3B", "SS", "OF", "DH", "UTIL", "RP")}}}
    day2 = {1: {"C": 4.0, "P": 1.0, "BE": 0.0, **{s: 0.0 for s in ("1B", "2B", "3B", "SS", "OF", "DH", "UTIL", "RP")}}}
    series = build_timeseries_teams(
        {1: day1, 2: day2},
        names={1: "Solo"},
        season=2026,
    )
    assert series[0]["points"][0]["daily_starters"] == 5.0
    assert series[0]["points"][0]["cumulative_starters"] == 5.0
    assert series[0]["points"][1]["daily_starters"] == 5.0
    assert series[0]["points"][1]["cumulative_starters"] == 10.0
    assert series[0]["points"][0]["date"] == "2026-03-26"
    assert series[0]["points"][1]["date"] == "2026-03-27"
    assert series[0]["points"][0]["daily_bats"] == 2.0
    assert series[0]["points"][0]["daily_pitchers"] == 3.0


def test_reference_2026_slot_table_derivation():
    """Attached 2026-by-slot totals → starters / bench+IL / delta vs ESPN."""
    # From uploads/2026-daily-raw + 2026-by-slot.csv (Okiro / JUAN).
    totals = {
        4: {
            "C": 487.0,
            "1B": 412.0,
            "2B": 444.0,
            "3B": 424.0,
            "SS": 450.0,
            "OF": 1308.0,
            "DH": 448.0,
            "UTIL": 382.0,
            "P": 3555.0,
            "RP": 450.0,
            "BE": 1469.0,
            "IL": -4.0,
        },
        1: {
            "C": 432.0,
            "1B": 456.0,
            "2B": 334.0,
            "3B": 337.0,
            "SS": 274.0,
            "OF": 1332.0,
            "DH": 412.0,
            "UTIL": 396.0,
            "P": 3184.0,
            "RP": 402.0,
            "BE": 1931.0,
            "IL": 22.0,
        },
    }
    rows = build_team_slot_rows(
        totals,
        names={4: "Okiro", 1: "JUAN OF JUAN"},
        espn_points={4: 8443.0, 1: 7627.0},
    )
    okiro = next(r for r in rows if r["team_id"] == 4)
    juan = next(r for r in rows if r["team_id"] == 1)
    assert okiro["starters"] == 8360.0
    assert okiro["bench_il"] == 1465.0
    assert okiro["espn_points"] == 8443.0
    assert okiro["delta"] == -83.0
    assert okiro["bats"] == 4355.0
    assert okiro["pitchers"] == 4005.0
    assert juan["starters"] == 7559.0
    assert abs(okiro["starters"] - okiro["espn_points"]) / okiro["espn_points"] < 0.02
    # Sorted by starters descending.
    assert rows[0]["team_id"] == 4


def test_period_date_uses_opening_day_and_schedule():
    assert period_date(2026, 1) == "2026-03-26"
    assert period_date(2026, 2, {2: "2026-03-28"}) == "2026-03-28"


def test_sync_writes_analysis_incrementally(tmp_path: Path):
    spec = LeagueSpec(
        id="baseball-dynasty",
        name="BB",
        short_name="BB",
        sport="baseball",
        format="dynasty",
        platform="espn",
        espn_league_id=2499137,
        seasons=[2026],
        current_season=2026,
    )
    snapshot = {
        "league_id": "baseball-dynasty",
        "espn_league_id": 2499137,
        "sport": "baseball",
        "season": 2026,
        "scoring_type": "TOTAL_SEASON_POINTS",
        "current_week": 2,
        "synced_at": "2026-07-27T00:00:00+00:00",
        "teams": [
            {"team_id": 1, "name": "Solo", "points_for": 20.0},
        ],
    }

    calls: list[int] = []

    def fetch_period(_league, period: int) -> dict:
        calls.append(period)
        return {
            "teams": [
                {
                    "id": 1,
                    "name": "Solo",
                    "points": 20.0,
                    "roster": {
                        "entries": [_entry(0, float(period), period)]
                    },
                }
            ]
        }

    league = SimpleNamespace(
        year=2026,
        scoringPeriodId=2,
        finalScoringPeriod=2,
        espn_request=SimpleNamespace(league_get=lambda **_: {}),
    )
    written = sync_baseball_analysis(
        league,
        spec,
        2026,
        snapshot,
        store_dir=tmp_path,
        fetch_period=fetch_period,
        fetch_teams=lambda _l: None,
        throttle_seconds=0.0,
    )
    assert written == 2
    assert calls == [1, 2]
    slot = read_analysis("baseball-dynasty", 2026, "slot_points", store_dir=tmp_path)
    assert slot["method"] == ANALYSIS_METHOD
    assert slot["teams"][0]["slots"]["C"] == 3.0  # period 1 + 2
    series = read_analysis(
        "baseball-dynasty", 2026, "points_timeseries", store_dir=tmp_path
    )
    assert series["teams"][0]["points"][-1]["cumulative_starters"] == 3.0

    calls.clear()
    # Incremental: completed periods reused; latest in-progress period retried.
    snapshot["current_week"] = 2
    sync_baseball_analysis(
        league,
        spec,
        2026,
        snapshot,
        store_dir=tmp_path,
        fetch_period=fetch_period,
        fetch_teams=lambda _l: None,
        throttle_seconds=0.0,
    )
    assert calls == [2]


def test_sync_skips_category_scoring(tmp_path: Path):
    spec = LeagueSpec(
        id="baseball-dynasty",
        name="BB",
        short_name="BB",
        sport="baseball",
        format="dynasty",
        platform="espn",
        espn_league_id=2499137,
        seasons=[2026],
        current_season=2026,
    )
    n = sync_baseball_analysis(
        SimpleNamespace(),
        spec,
        2026,
        {"scoring_type": "H2H_CATEGORY", "current_week": 10, "teams": []},
        store_dir=tmp_path,
    )
    assert n == 0
    assert read_analysis("baseball-dynasty", 2026, "slot_points", store_dir=tmp_path) is None


def test_sample_analysis_matches_snapshot_teams():
    snapshot = {
        "league_id": "baseball-dynasty",
        "espn_league_id": 2499137,
        "season": 2026,
        "scoring_type": "TOTAL_SEASON_POINTS",
        "current_week": 8,
        "synced_at": "2026-07-27T00:00:00+00:00",
        "teams": [
            {"team_id": 1, "name": "Bat Flip Bandits", "points_for": 6505.8},
            {"team_id": 2, "name": "Diamond Dogs", "points_for": 5732.1},
        ],
    }
    slot_doc, series_doc = sample_baseball_analysis_for_snapshot(snapshot)
    assert "period_slots" not in slot_doc
    assert {t["name"] for t in slot_doc["teams"]} == {
        "Bat Flip Bandits",
        "Diamond Dogs",
    }
    top = slot_doc["teams"][0]
    assert top["starters"] > 0
    assert abs(top["starters"] - top["espn_points"]) / top["espn_points"] < 0.03
    assert top["bats"] + top["pitchers"] == pytest.approx(top["starters"], abs=0.2)
    last = series_doc["teams"][0]["points"][-1]
    assert last["period"] == 8
    assert last["cumulative_starters"] == pytest.approx(top["starters"], abs=0.2)


def test_existing_period_slots_rejects_other_methods():
    assert existing_period_slots({"method": "nope", "period_slots": {"1": {}}}) == {}
    restored = existing_period_slots(
        {
            "method": ANALYSIS_METHOD,
            "period_slots": {"1": {"4": {"C": 2.0, "P": 1.0}}},
        }
    )
    assert restored[1][4]["C"] == 2.0


def test_add_slot_maps_sums_teams():
    merged = add_slot_maps(
        {1: {"C": 1.0, "P": 2.0}},
        {1: {"C": 3.0, "P": 0.0}, 2: {"C": 4.0}},
    )
    assert merged[1]["C"] == 4.0
    assert merged[1]["P"] == 2.0
    assert merged[2]["C"] == 4.0


def test_file_store_analysis_round_trip(tmp_path: Path):
    store = FileStore(tmp_path)
    doc = {
        "league_id": "baseball-dynasty",
        "season": 2026,
        "teams": [],
    }
    path = store.write_analysis(doc, "slot_points")
    assert Path(path).name == "slot_points.json"
    loaded = store.read_analysis("baseball-dynasty", 2026, "slot_points")
    assert loaded["season"] == 2026
    # Must not upsert index.json.
    assert not (tmp_path / "index.json").exists()
