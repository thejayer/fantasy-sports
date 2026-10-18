"""Hockey analysis must keep updating and stay dated to the sync day.

Reproduces the live symptoms on gs://…-sj-data/hockey-main/2027/analysis/:
slot_points starters identical across syncs, undercounting standings
``points_for`` by 15-25%, and a time-series dated ahead of the sync date.
Offline — no ESPN.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from sj.registry import LeagueSpec
from sj.season_points_analysis import HOCKEY_PROFILE, sync_season_points_analysis
from sj.store import read_analysis

LEAGUE = "hockey-main"


def _spec() -> LeagueSpec:
    return LeagueSpec(
        id=LEAGUE, name="Hockey", short_name="Hockey", sport="hockey",
        format="redraft", platform="espn", espn_league_id=1023106173,
        seasons=[2027], current_season=2027,
    )


def _snapshot(week: int, synced_at: str) -> dict:
    return {
        "league_id": LEAGUE, "espn_league_id": 1023106173, "sport": "hockey",
        "season": 2027, "scoring_type": "TOTAL_SEASON_POINTS", "current_week": week,
        "synced_at": synced_at,
        "teams": [{"team_id": 1, "name": "Solo", "points_for": 100.0}],
    }


def _league(week: int) -> SimpleNamespace:
    return SimpleNamespace(
        year=2027, scoringPeriodId=week, current_week=week, finalScoringPeriod=190,
        espn_request=SimpleNamespace(league_get=lambda **_: {}),
    )


def _payload(period: int, points: float) -> dict:
    line = {"statSourceId": 0, "statSplitTypeId": 5, "scoringPeriodId": period,
            "appliedTotal": points, "stats": {"34": 1.0}}
    return {"teams": [{"id": 1, "name": "Solo", "roster": {"entries": [{
        "lineupSlotId": 3,
        "playerPoolEntry": {"player": {"id": 9, "stats": [line]}},
    }]}}]}


class _Espn:
    """ESPN stand-in: a day's points ramp up while games finish, then settle."""

    def __init__(self) -> None:
        self.final = {1: 10.0, 2: 10.0, 3: 10.0, 4: 10.0}
        self.partial_for: set[int] = set()  # periods still mid-slate when fetched
        self.calls: list[int] = []

    def fetch(self, _league, period: int) -> dict:
        self.calls.append(period)
        pts = self.final[period]
        return _payload(period, pts * 0.4 if period in self.partial_for else pts)


def _sync(tmp_path: Path, espn: _Espn, week: int, synced_at: str, **kw) -> dict:
    sync_season_points_analysis(
        _league(week), _spec(), 2027, _snapshot(week, synced_at),
        store_dir=tmp_path, fetch_period=espn.fetch, fetch_teams=lambda _l: None,
        throttle_seconds=0.0, profile=HOCKEY_PROFILE, **kw,
    )
    return read_analysis(LEAGUE, 2027, "slot_points", store_dir=tmp_path)


def test_in_progress_day_is_corrected_on_later_syncs(tmp_path: Path):
    """A day fetched mid-slate must not stay frozen at its partial total."""
    espn = _Espn()
    # Sync 1 runs while day 3's games are still being played.
    espn.partial_for = {3}
    first = _sync(tmp_path, espn, 3, "2026-10-09T15:00:00+00:00")
    assert first["teams"][0]["starters"] == 24.0  # 10 + 10 + 4

    # Sync 2, next day: day 3 is final (30 total), day 4 is mid-slate.
    espn.partial_for = {4}
    second = _sync(tmp_path, espn, 4, "2026-10-10T15:00:00+00:00")
    assert second["teams"][0]["starters"] == 10 + 10 + 10 + 4  # day 3 repaired
    assert second["teams"][0]["starters"] != first["teams"][0]["starters"]

    # Sync 3: day 4 final. Totals keep moving instead of freezing.
    espn.partial_for = set()
    third = _sync(tmp_path, espn, 4, "2026-10-10T23:00:00+00:00")
    assert third["teams"][0]["starters"] == 40.0


def test_old_method_files_are_rebuilt_not_reused(tmp_path: Path):
    """Files written by the buggy incremental logic are discarded once."""
    espn = _Espn()
    espn.partial_for = {1, 2, 3, 4}
    _sync(tmp_path, espn, 4, "2026-10-10T15:00:00+00:00")
    stale = read_analysis(LEAGUE, 2027, "slot_points", store_dir=tmp_path)
    stale["method"] = "player.stats appliedTotal (statSourceId=0, statSplitTypeId=5) attributed to that day's lineupSlotId"
    from sj.store import write_analysis

    write_analysis(stale, "slot_points", store_dir=tmp_path)
    espn.partial_for = set()
    espn.calls.clear()
    fixed = _sync(tmp_path, espn, 4, "2026-10-10T23:00:00+00:00")
    assert sorted(set(espn.calls)) == [1, 2, 3, 4]
    assert fixed["teams"][0]["starters"] == 40.0


def test_timeseries_dates_follow_sync_date_not_opening_night(tmp_path: Path):
    """ESPN's period 15 on Oct 18 means period 1 was Oct 4 — not Oct 7."""
    espn = _Espn()
    espn.final = {p: 5.0 for p in range(1, 16)}
    _sync(tmp_path, espn, 15, "2026-10-18T16:00:00+00:00")
    series = read_analysis(LEAGUE, 2027, "points_timeseries", store_dir=tmp_path)
    points = series["teams"][0]["points"]
    assert points[-1]["period"] == 15
    assert points[-1]["date"] == "2026-10-18"  # was 2026-10-21 (3 days ahead)
    assert points[0]["date"] == "2026-10-04"
    assert max(p["date"] for p in points) <= "2026-10-18"


def test_finished_season_keeps_opening_day_dates(tmp_path: Path):
    """A backfill of an ended season must not pin its last day to 'today'."""
    espn = _Espn()
    espn.final = {p: 1.0 for p in range(1, 191)}
    league = SimpleNamespace(
        year=2026, scoringPeriodId=190, current_week=190, finalScoringPeriod=190,
        espn_request=SimpleNamespace(league_get=lambda **_: {}),
    )
    snap = _snapshot(190, "2026-10-18T16:00:00+00:00")
    snap["season"] = 2026
    spec = _spec()
    spec = LeagueSpec(**{**spec.__dict__, "seasons": [2026, 2027]})
    sync_season_points_analysis(
        league, spec, 2026, snap, store_dir=tmp_path, fetch_period=espn.fetch,
        fetch_teams=lambda _l: None, throttle_seconds=0.0, profile=HOCKEY_PROFILE,
    )
    series = read_analysis(LEAGUE, 2026, "points_timeseries", store_dir=tmp_path)
    assert series["teams"][0]["points"][0]["date"] == "2025-10-07"
    assert series["teams"][0]["points"][-1]["date"] == "2026-04-14"


def test_week_box_failure_does_not_starve_analysis(tmp_path: Path, monkeypatch):
    """sync_league_season runs analysis even when an earlier side concern raises."""
    from sj import sync as sj_sync
    from sj.sample import sample_league

    spec = _spec()
    monkeypatch.setenv("ESPN_S2", "s2")
    monkeypatch.setenv("ESPN_SWID", "{swid}")
    sample = sample_league(spec, 2027, teams=4)
    monkeypatch.setattr("sj.sync.open_espn_league", lambda *a, **k: sample)

    def boom(*_a, **_k):
        raise TypeError("box_scores() got an unexpected keyword argument 'week'")

    monkeypatch.setattr("sj.sync.sync_hockey_week_boxes", boom)
    ran: list[str] = []
    monkeypatch.setattr(
        "sj.season_points_analysis.sync_season_points_analysis",
        lambda *a, **k: ran.append("analysis") or 2,
    )
    with pytest.raises(sj_sync.SideConcernError) as err:
        sj_sync.sync_league_season(spec, 2027, store_dir=tmp_path)
    assert ran == ["analysis"]  # analysis still ran
    assert "hockey_week_boxes" in str(err.value)  # and the failure is still loud
