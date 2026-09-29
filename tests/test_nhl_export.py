"""NHL data layer export (HOCKEY-PORT.md H1) over a canned NHL — fully offline."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from nhl.export import (
    ARTIFACTS,
    build_nhl_documents,
    espn_players,
    export_nhl,
    nhl_sync_enabled,
    team_strength,
)
from nhl.nhl_api import SEARCH, STATS, WEB, NHLClient
from sj.store import FileStore, read_nhl

FIXTURES = Path(__file__).parent / "fixtures" / "nhl"
ROOT = Path(__file__).resolve().parents[1]
PRIOR = "20252026"
CURRENT = "20262027"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def canned_fetch(url: str, params: dict | None = None):
    params = params or {}
    if url == f"{WEB}/roster/TOR/current":
        return load("roster_TOR.json")
    if url == f"{WEB}/roster/MTL/current":
        # Same name as TOR's Alex Sample: the ESPN team must break the tie.
        return {"forwards": [{"id": 9000020, "firstName": {"default": "Alex"},
                              "lastName": {"default": "Sample"}, "positionCode": "C",
                              "birthDate": "2001-01-01"}]}
    if url == f"{WEB}/roster/BOS/current":
        raise RuntimeError("boom")
    if url.startswith(f"{WEB}/roster/"):
        return {}
    if url == f"{STATS}/season":
        return {"data": [{"id": 20262027, "numberOfGames": 84, "startDate": "2026-10-06T00:00:00",
                          "regularSeasonEndDate": "2027-04-15T00:00:00"}]}
    if url.startswith(STATS):
        kind, report = url[len(STATS) + 1:].split("/")
        cay = params.get("cayenneExp", "")
        if f"seasonId={PRIOR}" in cay:
            name = {
                ("skater", "summary"): "skater_summary.json",
                ("skater", "realtime"): "skater_realtime.json",
                ("skater", "timeonice"): "skater_timeonice.json",
                ("goalie", "summary"): "goalie_summary.json",
                ("team", "summary"): "team_summary.json",
            }[(kind, report)]
            return load(name)
        if f"seasonId={CURRENT}" in cay and kind == "team":
            return {"data": [{"teamFullName": "Toronto Maple Leafs", "gamesPlayed": 5,
                              "goalsForPerGame": 4.0, "goalsAgainstPerGame": 2.0}]}
        return {"data": []}
    if url == f"{WEB}/club-schedule-season/TOR/{CURRENT}":
        return load("club_schedule_TOR.json")
    if url.startswith(f"{WEB}/club-schedule-season/"):
        return {"games": []}
    if url == f"{WEB}/player/9000002/landing":
        return load("landing_rookie.json")
    if url == f"{WEB}/player/9000010/landing":
        return {"birthDate": "1993-04-04", "heightInInches": 72, "weightInPounds": 190,
                "currentTeamAbbrev": None, "seasonTotals": []}
    if url == SEARCH:
        if params.get("q") == "Casey Unsigned":
            return [] if params.get("active") == "true" else load("search_hits.json")
        return []
    raise AssertionError(f"unexpected {url}")


def snapshot() -> dict:
    return {
        "league_id": "hockey-main",
        "season": 2027,
        "sport": "hockey",
        "synced_at": "2026-10-01T12:00:00+00:00",
        "teams": [{"team_id": 1, "roster": [
            {"id": 101, "name": "Alex Sample", "position": "Center",
             "pro_team": "Toronto Maple Leafs"},
            {"id": 102, "name": "Jean-Luc Testard", "position": "Left Wing", "pro_team": "TOR"},
            {"id": 103, "name": "Dana Blueline", "position": "Defense", "pro_team": "TOR"},
            {"id": 104, "name": "Gus Crease", "position": "Goalie", "pro_team": "TOR"},
            {"id": 105, "name": "Casey Unsigned", "position": "Center",
             "pro_team": "Vegas Golden Knights"},
            {"id": 106, "name": "Ghost Player", "position": "Center", "pro_team": "TOR"},
        ]}],
        "free_agents": [
            {"id": 201, "name": "Bobby Backup", "position": "Goalie", "pro_team": "TOR"},
            {"id": 101, "name": "Alex Sample", "position": "Center", "pro_team": "TOR"},
        ],
    }


@pytest.fixture(scope="module")
def docs():
    result = build_nhl_documents(
        snapshot(),
        NHLClient(fetch=canned_fetch, throttle=0.0),
        as_of=dt.date(2026, 10, 1),
        generated_at="2026-10-01T12:00:00+00:00",
    )
    return result.documents


def test_espn_players_dedupes_rostered_first():
    rows = espn_players(snapshot())
    assert [r["id"] for r in rows] == [101, 102, 103, 104, 105, 106, 201]
    assert [r["_rostered"] for r in rows][-1] is False


def test_player_map_methods_and_coverage(docs):
    pm = docs["player_map"]
    players = pm["players"]
    assert players["101"]["nhl_id"] == 9000001  # TOR, not MTL's Alex Sample
    assert players["101"]["method"] == "name"
    assert players["102"]["nhl_id"] == 9000002  # accent-insensitive
    assert players["105"] == {
        "nhl_id": 9000010, "espn_name": "Casey Unsigned", "nhl_name": "Casey Unsigned",
        "group": "F", "espn_team": "Vegas Golden Knights", "nhl_team": None,
        "method": "search", "rostered": True,
    }
    assert players["201"]["nhl_id"] == 9000005
    assert players["201"]["method"] == "initial_last"
    assert pm["unmatched"] == [{"espn_id": 106, "name": "Ghost Player", "position": "Center",
                                "pro_team": "TOR", "rostered": True}]
    assert pm["coverage"]["rostered"] == {"total": 6, "matched": 5, "rate": 0.8333}
    assert pm["coverage"]["free_agents"] == {"total": 1, "matched": 1, "rate": 1.0}
    assert pm["coverage"]["by_method"] == {"initial_last": 1, "name": 4, "search": 1}


def test_partial_failures_are_recorded_not_raised(docs):
    assert "roster BOS: boom" in docs["player_map"]["errors"]
    assert all(doc["errors"] == docs["player_map"]["errors"] for doc in docs.values())


def test_context_bio_and_prior_team(docs):
    ctx = docs["nhl_context"]["players"]
    alex = ctx["9000001"]
    assert (alex["team"], alex["prior_team"], alex["age"]) == ("TOR", "BOS", 28)
    assert (alex["height_in"], alex["weight_lb"]) == (73, 195)
    assert alex["on_nhl_roster"] is True
    # Preseason: no current TOI yet, so last season's sample, flagged as another team.
    assert alex["toi"] == {"basis": "last season, other team", "gp": 80, "toi_min": 19.0,
                           "ev_min": 15.0, "pp_min": 3.0, "sh_min": 1.0}
    assert alex["history"][0]["season"] == PRIOR
    assert alex["history"][0]["G"] == 30 and alex["history"][0]["HIT"] == 45
    dana = ctx["9000003"]
    assert dana["prior_team"] is None
    assert dana["toi"]["basis"] == "last season"


def test_goalie_start_share(docs):
    ctx = docs["nhl_context"]["players"]
    gus, bo = ctx["9000004"]["goalie"], ctx["9000005"]["goalie"]
    assert gus == {"basis": "last season", "gs": 52, "start_share": 0.634, "role": "Starter"}
    assert bo["role"] == "Backup" and bo["start_share"] == 0.366
    assert ctx["9000004"]["toi"] is None
    # Missing height on the NHL roster stays null.
    assert ctx["9000004"]["height_in"] is None


def test_rookie_landing_and_search_only_player(docs):
    ctx = docs["nhl_context"]["players"]
    rookie = ctx["9000002"]
    assert rookie["history"] == []
    assert rookie["draft"]["overall"] == 7
    assert rookie["prior_nhl_gp"] == 4
    assert [m["league"] for m in rookie["minors"]] == ["OHL", "OHL"]
    assert rookie["toi"]["basis"] is None and rookie["toi"]["ev_min"] is None
    casey = ctx["9000010"]
    assert casey["on_nhl_roster"] is False
    assert casey["team"] is None
    assert (casey["age"], casey["height_in"]) == (33, 72)


def test_schedule_and_team_strength(docs):
    tor = docs["schedule"]["teams"]["TOR"]
    assert [g["date"] for g in tor] == ["2026-10-07", "2026-10-09", "2026-10-10"]
    teams = docs["team_strength"]["teams"]
    assert teams["TOR"]["weight_current"] == 0.333
    assert teams["TOR"]["gf"] == pytest.approx(0.333 * 4.0 + 0.667 * 3.4, abs=1e-3)
    # No current-season shots yet: last season's value, not a zero.
    assert teams["TOR"]["sf"] == 31.0
    assert teams["MTL"]["weight_current"] == 0.0 and teams["MTL"]["pp"] is None
    assert "ARI" not in teams
    assert docs["team_strength"]["league_avg"]["pp"] == 0.24


def test_team_strength_all_null_stays_null():
    teams, avg = team_strength({"TOR": {"name": "Toronto Maple Leafs", "gp": 0}}, {})
    assert teams["TOR"]["gf"] is None
    assert avg["gf"] is None


def test_headers(docs):
    for name in ARTIFACTS:
        doc = docs[name]
        assert (doc["league_id"], doc["season"], doc["sport"], doc["nhl_season"]) == (
            "hockey-main", 2027, "hockey", CURRENT,
        )


def test_no_rosters_at_all_raises():
    def dead(url, params=None):
        raise RuntimeError("offline")

    with pytest.raises(RuntimeError, match="NHL rosters unavailable"):
        build_nhl_documents(snapshot(), NHLClient(fetch=dead, throttle=0.0),
                            as_of=dt.date(2026, 10, 1), generated_at="x")


def test_export_writes_sidecars_then_enforces_fail_below(tmp_path):
    client = NHLClient(fetch=canned_fetch, throttle=0.0)
    result = export_nhl(snapshot(), client=client, store_dir=tmp_path)
    assert result.coverage == 0.8333
    for name in ARTIFACTS:
        assert (tmp_path / "hockey-main" / "2027" / "nhl" / f"{name}.json").is_file()
        assert read_nhl("hockey-main", 2027, name, store_dir=tmp_path)["league_id"] == "hockey-main"
    # Index untouched: sidecars are not league-seasons.
    assert not (tmp_path / "index.json").exists()

    with pytest.raises(RuntimeError, match="below 0.98"):
        export_nhl(snapshot(), client=client, store_dir=tmp_path / "strict", fail_below=0.98)
    assert (tmp_path / "strict" / "hockey-main" / "2027" / "nhl" / "player_map.json").is_file()


def test_export_rejects_other_sports(tmp_path):
    with pytest.raises(ValueError):
        export_nhl({"league_id": "x", "sport": "baseball"}, store_dir=tmp_path)


def test_sync_enabled_flag(monkeypatch):
    assert nhl_sync_enabled() is False  # conftest keeps pytest offline
    monkeypatch.setenv("SJ_NHL_SYNC", "1")
    assert nhl_sync_enabled() is True
    monkeypatch.setenv("SJ_NHL_SYNC", "off")
    assert nhl_sync_enabled() is False


def test_sync_hook_never_fails_the_espn_sync(monkeypatch, tmp_path, capsys):
    from sj.sync import sync_hockey_nhl

    spec = SimpleNamespace(id="hockey-main", sport="hockey", current_season=2027)
    assert sync_hockey_nhl(spec, 2027, snapshot(), store_dir=tmp_path) == "disabled"
    assert sync_hockey_nhl(spec, 2026, snapshot(), store_dir=tmp_path) == "skipped"
    football = SimpleNamespace(id="football-main", sport="football", current_season=2027)
    assert sync_hockey_nhl(football, 2027, {}, store_dir=tmp_path) == "skipped"

    monkeypatch.setenv("SJ_NHL_SYNC", "1")

    def explode(*args, **kwargs):
        raise RuntimeError("NHL down")

    monkeypatch.setattr("nhl.export.export_nhl", explode)
    assert sync_hockey_nhl(spec, 2027, snapshot(), store_dir=tmp_path) == "failed: NHL down"
    assert "NHL down" in capsys.readouterr().err

    def canned_export(snap, store_dir=None, dfo=None):
        assert dfo is None  # conftest sets SJ_DFO_SYNC=0: tests never reach Daily Faceoff
        return export_nhl(snap, client=NHLClient(fetch=canned_fetch, throttle=0.0),
                          store_dir=store_dir)

    monkeypatch.setattr("nhl.export.export_nhl", canned_export)
    assert sync_hockey_nhl(spec, 2027, snapshot(), store_dir=tmp_path) == "ok"
    assert (tmp_path / "hockey-main" / "2027" / "nhl" / "nhl_context.json").is_file()


def test_committed_fixture_sidecars_match_the_sample_nhl():
    """fixtures/sj/hockey-main/{season}/nhl/* are generated, never hand-edited."""
    from nhl.sample import sample_nhl_documents
    from sj.fixtures import FIXED_TIMESTAMP, expected_fixture_snapshot
    from sj.registry import load_registry

    spec = load_registry().by_id("hockey-main")
    expected = sample_nhl_documents(
        expected_fixture_snapshot(spec), generated_at=FIXED_TIMESTAMP
    )
    store = FileStore(ROOT / "fixtures" / "sj")
    for name in ARTIFACTS:
        assert store.read_nhl(spec.id, spec.current_season, name) == expected[name], name
    pm = expected["player_map"]
    assert pm["coverage"]["rostered"]["rate"] >= 0.95
    assert set(pm["coverage"]["by_method"]) == {"initial_last", "name", "search"}
    assert pm["unmatched"], "fixture should exercise the unmatched list"
    ctx = expected["nhl_context"]["players"]
    assert {str(p["nhl_id"]) for p in pm["players"].values()} <= set(ctx)


def test_export_writes_injury_log_and_reads_the_previous_one(tmp_path):
    """H6: the first log is a baseline; the next sync records the change."""
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
