"""Baseball 8.2 follow-up enrichers (trailing splits + pro schedule)."""

from __future__ import annotations

from types import SimpleNamespace

from sj.baseball_enrich import (
    apply_trailing_stats_to_snapshot,
    parse_trailing_from_player_card,
)
from sj.registry import load_registry
from sj.sample import sample_pro_schedule_for_snapshot, sample_snapshot
from sj.serialize import extract_baseball_trailing_stats, serialize_player
from sj.store import FileStore


def test_parse_trailing_from_player_card_maps_split_ids():
    payload = [
        {
            "player": {
                "id": 42,
                "stats": [
                    {
                        "statSplitTypeId": 1,
                        "seasonId": 2026,
                        "stats": {"20": 5, "5": 2},  # R, HR
                    },
                    {
                        "statSplitTypeId": 3,
                        "seasonId": 2026,
                        "stats": {"20": 12, "5": 4},
                    },
                ],
            }
        }
    ]
    parsed = parse_trailing_from_player_card(payload)
    assert "7" in parsed[42]
    assert "30" in parsed[42]
    assert parsed[42]["7"]["R"] == 5.0
    assert parsed[42]["30"]["HR"] == 4.0


def test_sample_baseball_player_serializes_trailing_windows():
    registry = load_registry()
    spec = next(lg for lg in registry.leagues if lg.id == "baseball-dynasty")
    snap = sample_snapshot(spec, spec.current_season, teams=3)
    player = snap["teams"][0]["roster"][0]
    assert set(player.get("trailing_stats", {})) >= {"7", "15", "30"}
    assert snap["settings"].get("categories")
    assert len(snap["settings"]["categories"]) == 10


def test_apply_trailing_mutates_roster_and_fa():
    snapshot = {
        "teams": [{"roster": [{"id": 1, "name": "A"}]}],
        "players": [{"id": 1, "name": "A"}],
        "free_agents": [{"id": 2, "name": "B"}],
    }
    n = apply_trailing_stats_to_snapshot(
        snapshot, {1: {"7": {"HR": 1.0}}, 2: {"15": {"K": 3.0}}}
    )
    assert n == 3
    assert snapshot["teams"][0]["roster"][0]["trailing_stats"]["7"]["HR"] == 1.0
    assert snapshot["free_agents"][0]["trailing_stats"]["15"]["K"] == 3.0


def test_sample_pro_schedule_and_store_roundtrip(tmp_path):
    registry = load_registry()
    spec = next(lg for lg in registry.leagues if lg.id == "baseball-dynasty")
    snap = sample_snapshot(spec, spec.current_season, teams=3)
    snap["synced_at"] = "2026-07-27T00:00:00+00:00"
    doc = sample_pro_schedule_for_snapshot(snap)
    assert doc["sport"] == "baseball"
    assert doc["games"]
    store = FileStore(tmp_path)
    store.write_pro_schedule(doc)
    loaded = store.read_pro_schedule(spec.id, spec.current_season)
    assert loaded is not None
    assert len(loaded["games"]) == len(doc["games"])


def test_extract_trailing_from_stub_player():
    player = SimpleNamespace(
        trailing_stats={"7": {"HR": 2, "AB": 10, "H": 3}, "15": {"HR": 4}}
    )
    out = extract_baseball_trailing_stats(player)
    assert out["7"]["HR"] == 2.0
    assert out["7"]["AB"] == 10.0
    stub = SimpleNamespace(
        playerId=9,
        name="X",
        position="OF",
        lineupSlot="OF",
        proTeam="NYY",
        injuryStatus="ACTIVE",
        status="ACTIVE",
        injured=False,
        eligibleSlots=["OF"],
        acquisitionType="FREEAGENT",
        percent_owned=1.0,
        total_points=10,
        projected_total_points=10,
        avg_points=1,
        stats={0: {"breakdown": {"AB": 10, "H": 3, "HR": 1, "R": 1, "RBI": 1, "SB": 0, "AVG": 0.3, "OBP": 0.3, "OPS": 0.6}}},
        trailing_stats={"7": {"AB": 10, "H": 3, "HR": 1, "R": 1, "RBI": 1, "SB": 0, "AVG": 0.3}},
    )
    row = serialize_player(stub, sport="baseball")
    assert "trailing_stats" in row
    assert row["trailing_stats"]["7"]["HR"] == 1.0
