"""H6 injury log — offline, synthetic statuses."""

from __future__ import annotations

from pathlib import Path

from nhl.injuries import (
    DAY_TO_DAY,
    HEALTHY,
    OUT,
    combined_level,
    current_statuses,
    dfo_level,
    espn_level,
    transition,
    update_injury_log,
)

ROOT = Path(__file__).resolve().parents[1]
HEADER = {"league_id": "hockey-main", "season": 2027, "sport": "hockey", "nhl_season": "20262027"}


def test_levels_from_each_source():
    assert espn_level("ACTIVE") == HEALTHY
    assert espn_level("QUESTIONABLE") == DAY_TO_DAY
    assert espn_level("DAY_TO_DAY") == DAY_TO_DAY
    assert espn_level("INJURY_RESERVE") == OUT
    assert espn_level(None) is None
    assert dfo_level({"injury": "ltir"}) == OUT
    assert dfo_level({"injury": "dtd"}) == DAY_TO_DAY
    assert dfo_level({"injury": None, "gtd": True}) == DAY_TO_DAY
    assert dfo_level({"injury": None, "gtd": False}) == HEALTHY
    assert dfo_level(None) is None
    assert combined_level(HEALTHY, OUT) == OUT
    assert combined_level(None, None) == HEALTHY


def test_transitions():
    assert transition(HEALTHY, DAY_TO_DAY) == "hurt"
    assert transition(DAY_TO_DAY, OUT) == "hurt"
    assert transition(OUT, DAY_TO_DAY) == "nearing_return"
    assert transition(OUT, HEALTHY) == "back"
    assert transition(DAY_TO_DAY, HEALTHY) == "back"
    assert transition(OUT, OUT) is None


def _snapshot(statuses: dict[int, str | None]) -> dict:
    return {
        "teams": [{"team_id": 1, "roster": [
            {"id": pid, "name": f"P{pid}", "slot": "F", "pro_team": "BOS", "injury_status": s}
            for pid, s in statuses.items()
        ]}],
        "free_agents": [{"id": 99, "name": "FA", "injury_status": "OUT"}],
    }


PLAYER_MAP = {"players": {"1": {"nhl_id": 801, "nhl_team": "BOS"}, "2": {"nhl_id": 802}}}


def test_current_statuses_merge_espn_and_dfo():
    lines = {"players": {"801": {"injury": "dtd"}, "802": {"injury": None, "gtd": False}}}
    now = current_statuses(_snapshot({1: "ACTIVE", 2: "OUT"}), PLAYER_MAP, lines)
    assert now["1"]["level"] == DAY_TO_DAY  # DFO says dtd
    assert now["1"]["dfo"] == "dtd" and now["1"]["espn"] == "ACTIVE"
    assert now["1"]["nhl_team"] == "BOS"
    assert now["2"]["level"] == OUT
    assert now["99"]["team_id"] is None


def test_first_log_is_a_quiet_baseline_then_records_changes():
    first = update_injury_log(
        None, current_statuses(_snapshot({1: "ACTIVE", 2: "OUT", 3: "OUT"}), {}, None),
        header=HEADER, at="2026-10-10T11:00:00+00:00", source="sync",
    )
    assert first["baseline"] is True and first["events"] == []
    assert first["players"]["2"]["since"] == "2026-10-10"

    second = update_injury_log(
        first, current_statuses(_snapshot({1: "OUT", 2: "DAY_TO_DAY", 3: "OUT"}), {}, None),
        header=HEADER, at="2026-10-11T11:00:00+00:00", source="sync",
    )
    kinds = {e["espn_id"]: e["kind"] for e in second["events"]}
    assert kinds == {"1": "hurt", "2": "nearing_return"}
    assert second["baseline"] is False
    # An unchanged status keeps its original "since".
    assert second["players"]["3"]["since"] == "2026-10-10"
    assert second["players"]["1"]["since"] == "2026-10-11"
    assert second["events"][0]["team_id"] == 1


def test_old_events_age_out():
    base = update_injury_log(None, current_statuses(_snapshot({1: "ACTIVE"}), {}, None),
                             header=HEADER, at="2026-10-01T00:00:00+00:00", source="sync")
    hurt = update_injury_log(base, current_statuses(_snapshot({1: "OUT"}), {}, None),
                             header=HEADER, at="2026-10-02T00:00:00+00:00", source="sync")
    later = update_injury_log(hurt, current_statuses(_snapshot({1: "OUT"}), {}, None),
                              header=HEADER, at="2026-12-31T00:00:00+00:00", source="sync")
    assert hurt["events"] and later["events"] == []


def test_lines_job_refreshes_dfo_and_keeps_espn():
    """The afternoon job has no ESPN snapshot: carry ESPN, refresh DFO."""
    first = update_injury_log(
        None, current_statuses(_snapshot({1: "ACTIVE"}), PLAYER_MAP, {"players": {}}),
        header=HEADER, at="2026-10-10T11:00:00+00:00", source="sync",
    )
    lines = {"players": {"801": {"injury": "out"}}}
    now = current_statuses(None, PLAYER_MAP, lines, first)
    assert now["1"]["espn"] == "ACTIVE" and now["1"]["level"] == OUT
    after = update_injury_log(first, now, header=HEADER, at="2026-10-10T22:30:00+00:00",
                              source="lines")
    assert after["events"][-1]["kind"] == "hurt"
    assert after["events"][-1]["source"] == "lines"


def test_export_writes_injury_log_and_reads_the_previous_one(tmp_path):
    from nhl.export import export_nhl
    from nhl.nhl_api import NHLClient
    from sj.store import read_nhl
    from tests.test_nhl_export import canned_fetch, snapshot

    client = NHLClient(fetch=canned_fetch, throttle=0.0)
    snap = snapshot()
    export_nhl(snap, client=client, store_dir=tmp_path)
    log = read_nhl("hockey-main", 2027, "injury_log", store_dir=tmp_path)
    assert log["baseline"] is True
    assert log["league_id"] == "hockey-main"

    # Someone gets hurt before the next sync.
    victim = snap["teams"][0]["roster"][0]
    victim["injury_status"] = "OUT"
    snap["synced_at"] = "2026-10-02T11:00:00+00:00"
    export_nhl(snap, client=client, store_dir=tmp_path)
    log = read_nhl("hockey-main", 2027, "injury_log", store_dir=tmp_path)
    assert [e["espn_id"] for e in log["events"]] == [str(victim["id"])]


def test_committed_fixture_injury_log_matches_the_sample():
    from nhl.sample import sample_nhl_documents
    from sj.fixtures import FIXED_TIMESTAMP, expected_fixture_snapshot
    from sj.registry import load_registry
    from sj.store import FileStore

    spec = load_registry().by_id("hockey-main")
    expected = sample_nhl_documents(expected_fixture_snapshot(spec), generated_at=FIXED_TIMESTAMP)
    got = FileStore(ROOT / "fixtures" / "sj").read_nhl(spec.id, spec.current_season, "injury_log")
    assert got == expected["injury_log"]
    assert {e["kind"] for e in got["events"]} == {"hurt", "nearing_return", "back"}
