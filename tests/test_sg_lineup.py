from datetime import datetime, timezone

from sg.lineup import (
    apply_locks,
    build_lineups_payload,
    default_lineup_from_roster,
    player_is_locked,
    validate_week_lineup,
)
from sg.schedule import FIXTURE_NOW, fixture_events
from sg.settings import GolfSettings
from sg.snapshot import build_golf_snapshot


def test_fixture_events_and_default_lineup():
    events = fixture_events(2026)
    assert events[0]["event_id"] == "2026-players"
    roster = [{"id": i, "slot": "GS" if i <= 5 else "BE"} for i in range(1, 16)]
    lineup = default_lineup_from_roster(
        roster,
        GolfSettings.model_validate({"missed_cut": {"mode": "alt1_2"}}),
        saved_at=FIXTURE_NOW,
    )
    assert lineup["starters"] == [1, 2, 3, 4, 5]
    assert lineup["captain"] == 1
    assert lineup["alt1"] == 6
    assert lineup["alt2"] == 7


def test_tee_time_lock_fail_closed():
    tee_times = {"1": "2026-03-12T12:00:00+00:00", "2": "2026-03-12T18:00:00+00:00"}
    now = datetime.fromisoformat(FIXTURE_NOW)
    assert player_is_locked(1, tee_times=tee_times, now=now) is True
    assert player_is_locked(2, tee_times=tee_times, now=now) is False


def test_validate_rejects_locked_player_swap():
    settings = GolfSettings()
    previous = {
        "starters": [1, 2, 3, 4, 5],
        "captain": 1,
        "alt1": 6,
        "alt2": None,
    }
    tee_times = {str(i): "2026-03-12T12:00:00+00:00" for i in range(1, 6)}
    tee_times["6"] = "2026-03-12T18:00:00+00:00"
    tee_times["7"] = "2026-03-12T18:30:00+00:00"
    errors = validate_week_lineup(
        {
            "starters": [1, 2, 3, 4, 7],  # swap locked 5 for 7
            "captain": 1,
            "alt1": 6,
            "alt2": None,
        },
        roster_ids=set(range(1, 16)),
        settings=settings,
        tee_times=tee_times,
        previous=previous,
        now=datetime.fromisoformat(FIXTURE_NOW),
    )
    assert any("locked" in err for err in errors)


def test_build_golf_snapshot_includes_lineups():
    snap = build_golf_snapshot(
        league_id="golf-test",
        name="Test",
        season=2026,
        format="h2h",
        team_count=8,
        golf={"roster": {"starters": 5, "bench": 10}, "missed_cut": {"mode": "alt1"}},
        synced_at="2026-07-27T00:00:00+00:00",
    )
    assert snap["lineups"]["current_event_id"] == "2026-players"
    assert len(snap["lineups"]["events"]) == 2
    team1 = snap["lineups"]["teams"]["1"]["2026-players"]
    assert len(team1["starters"]) == 5
    assert team1["captain"] == team1["starters"][0]
    assert team1["alt1"] is not None
    locked = apply_locks(
        team1,
        tee_times=snap["lineups"]["events"][0]["tee_times"],
        now=datetime.fromisoformat(FIXTURE_NOW).replace(tzinfo=timezone.utc),
    )
    assert locked["locks"]


def test_build_lineups_payload_empty_without_rosters():
    payload = build_lineups_payload(
        [{"team_id": 1, "roster": []}],
        None,
        season=2026,
        saved_at=FIXTURE_NOW,
        now_iso=FIXTURE_NOW,
    )
    assert payload["teams"] == {}
    assert payload["events"]
