"""Unit tests for the v2 split / assemble helpers (roadmap 2.2)."""

from sj.snapshot_layout import (
    SCHEMA_VERSION,
    assemble_snapshot,
    split_snapshot,
)


def _monolith() -> dict:
    return {
        "league_id": "football-main",
        "espn_league_id": 39790,
        "sport": "football",
        "format": "redraft",
        "season": 2025,
        "name": "Strictly Jayers Football",
        "short_name": "Football",
        "scoring_type": "H2H_POINTS",
        "team_count": 2,
        "current_week": 3,
        "period_label": "week",
        "synced_at": "2026-07-27T00:00:00+00:00",
        "settings": {
            "scoring_type": "H2H_POINTS",
            "keeper_count": 0,
            "faab": True,
            "acquisition_budget": 100,
        },
        "draft": [
            {
                "round": 1,
                "round_pick": 1,
                "team_id": 1,
                "player_id": 10,
                "player_name": "Star",
                "bid_amount": 0.0,
                "keeper": False,
                "nominating_team_id": None,
            }
        ],
        "transactions": [
            {
                "date": "1720000000000",
                "actions": [
                    {
                        "team_id": 1,
                        "action": "FA ADDED",
                        "player_id": 10,
                        "player_name": "Star",
                        "bid_amount": 5.0,
                    }
                ],
            }
        ],
        "free_agents": [
            {
                "id": 99,
                "name": "Wire Guy",
                "position": "WR",
                "slot": "FA",
                "pro_team": "DAL",
                "injury_status": "ACTIVE",
                "status": "FREEAGENT",
                "percent_owned": 12.5,
                "total_points": 20.0,
                "projected_total_points": 30.0,
                "avg_points": 2.0,
            }
        ],
        "teams": [
            {
                "team_id": 1,
                "name": "Alpha",
                "abbrev": "ALP",
                "owners": ["A"],
                "logo_url": None,
                "wins": 2,
                "losses": 1,
                "ties": 0,
                "win_pct": 0.667,
                "points_for": 300.0,
                "points_against": 280.0,
                "standing": 1,
                "division": "East",
                "schedule": [2, 2, 1],
                "scores": [100.0, 110.0, 0.0],
                "outcomes": ["W", "L", "U"],
                "roster": [
                    {
                        "id": 10,
                        "name": "Star",
                        "position": "RB",
                        "slot": "RB",
                        "pro_team": "DAL",
                        "injury_status": "ACTIVE",
                        "total_points": 50.0,
                        "projected_total_points": 45.0,
                        "avg_points": 10.0,
                    }
                ],
            },
            {
                "team_id": 2,
                "name": "Beta",
                "abbrev": "BET",
                "owners": ["B"],
                "logo_url": None,
                "wins": 1,
                "losses": 2,
                "ties": 0,
                "win_pct": 0.333,
                "points_for": 280.0,
                "points_against": 300.0,
                "standing": 2,
                "division": "East",
                "schedule": [1, 1, 2],
                "scores": [90.0, 120.0, 0.0],
                "outcomes": ["L", "W", "U"],
                "roster": [],
            },
        ],
        "players": [
            {
                "id": 10,
                "name": "Star",
                "position": "RB",
                "slot": "RB",
                "pro_team": "DAL",
                "injury_status": "ACTIVE",
                "total_points": 50.0,
                "projected_total_points": 45.0,
                "avg_points": 10.0,
                "fantasy_team": "Alpha",
            }
        ],
    }


def test_split_round_trip_preserves_monolith_fields():
    original = _monolith()
    parts = split_snapshot(original)
    assert set(parts) == {
        "manifest.json",
        "standings.json",
        "rosters.json",
        "matchups.json",
        "draft.json",
        "settings.json",
        "transactions.json",
        "free_agents.json",
    }
    assert parts["manifest.json"]["schema_version"] == SCHEMA_VERSION
    assert parts["settings.json"]["settings"]["faab"] is True
    assert parts["transactions.json"]["transactions"][0]["actions"][0]["action"] == (
        "FA ADDED"
    )
    assert parts["free_agents.json"]["free_agents"][0]["name"] == "Wire Guy"
    assert "roster" not in parts["standings.json"]["teams"][0]
    assert parts["rosters.json"]["teams"]["1"][0]["name"] == "Star"
    assert parts["matchups.json"]["teams"]["1"]["outcomes"] == ["W", "L", "U"]

    reassembled = assemble_snapshot(parts)
    # schema_version is added on assemble; compare the rest.
    for key, value in original.items():
        assert reassembled[key] == value
    assert reassembled["schema_version"] == SCHEMA_VERSION


def test_assemble_accepts_concern_name_keys():
    parts = split_snapshot(_monolith())
    by_name = {
        "manifest": parts["manifest.json"],
        "standings": parts["standings.json"],
        "rosters": parts["rosters.json"],
        "matchups": parts["matchups.json"],
        "draft": parts["draft.json"],
        "settings": parts["settings.json"],
        "transactions": parts["transactions.json"],
    }
    assert assemble_snapshot(by_name)["teams"][0]["roster"][0]["id"] == 10


def test_assemble_tolerates_missing_settings_and_transactions():
    """Seasons written before roadmap 2.4 omit settings.json."""
    parts = split_snapshot(_monolith())
    del parts["settings.json"]
    del parts["transactions.json"]
    del parts["free_agents.json"]
    by_name = {
        "manifest": parts["manifest.json"],
        "standings": parts["standings.json"],
        "rosters": parts["rosters.json"],
        "matchups": parts["matchups.json"],
        "draft": parts["draft.json"],
    }
    snap = assemble_snapshot(by_name)
    assert snap["settings"] == {}
    assert snap["transactions"] == []
    assert snap["free_agents"] == []
