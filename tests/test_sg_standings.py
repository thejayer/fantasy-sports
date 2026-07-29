"""Unit tests for golf season standings (roadmap 6.4e)."""

from sg.snapshot import build_golf_snapshot
from sg.standings import apply_standings_from_scoreboard


def _tiny_scoreboard() -> dict:
    return {
        "period_label": "event",
        "current_event_id": "e1",
        "events": [
            {
                "event_id": "e1",
                "teams": {
                    "1": {"week_total": 10.0},
                    "2": {"week_total": 8.0},
                    "3": {"week_total": 12.0},
                    "4": {"week_total": 12.0},
                },
                "pairings": [
                    {
                        "home_team_id": 1,
                        "away_team_id": 2,
                        "home_total": 10.0,
                        "away_total": 8.0,
                        "outcome": "W",
                    },
                    {
                        "home_team_id": 3,
                        "away_team_id": 4,
                        "home_total": 12.0,
                        "away_total": 12.0,
                        "outcome": "T",
                    },
                ],
            },
            {
                "event_id": "e2",
                "teams": {
                    "1": {"week_total": 5.0},
                    "2": {"week_total": 9.0},
                    "3": {"week_total": 6.0},
                    "4": {"week_total": 7.0},
                },
                "pairings": [
                    {
                        "home_team_id": 1,
                        "away_team_id": 2,
                        "home_total": 5.0,
                        "away_total": 9.0,
                        "outcome": "L",
                    },
                    {
                        "home_team_id": 3,
                        "away_team_id": 4,
                        "home_total": 6.0,
                        "away_total": 7.0,
                        "outcome": "L",
                    },
                ],
            },
        ],
    }


def _teams(n: int = 4) -> list[dict]:
    return [
        {
            "team_id": i,
            "name": f"T{i}",
            "wins": 0,
            "losses": 0,
            "ties": 0,
            "win_pct": 0.0,
            "points_for": 0.0,
            "points_against": 0.0,
            "standing": i,
        }
        for i in range(1, n + 1)
    ]


def test_h2h_standings_from_pairings():
    teams = apply_standings_from_scoreboard(_teams(), _tiny_scoreboard(), "h2h")
    by_id = {t["team_id"]: t for t in teams}
    assert by_id[1]["wins"] == 1 and by_id[1]["losses"] == 1
    assert by_id[2]["wins"] == 1 and by_id[2]["losses"] == 1
    assert by_id[3]["ties"] == 1 and by_id[3]["losses"] == 1
    assert by_id[4]["ties"] == 1 and by_id[4]["wins"] == 1
    assert by_id[1]["points_for"] == 15.0
    assert by_id[1]["points_against"] == 17.0
    # Standing numbers assigned; payload stays team_id order.
    assert {t["standing"] for t in teams} == {1, 2, 3, 4}
    assert [t["team_id"] for t in teams] == [1, 2, 3, 4]
    leader = min(teams, key=lambda t: t["standing"])
    assert leader["standing"] == 1


def test_season_points_sums_week_totals():
    teams = apply_standings_from_scoreboard(_teams(), _tiny_scoreboard(), "season_points")
    by_id = {t["team_id"]: t for t in teams}
    assert by_id[1]["points_for"] == 15.0
    assert by_id[2]["points_for"] == 17.0
    assert by_id[3]["points_for"] == 18.0
    assert by_id[4]["points_for"] == 19.0
    assert by_id[1]["wins"] == 0
    # Ranked by PF descending → team 4 standing 1; payload stays id order.
    assert [t["team_id"] for t in teams] == [1, 2, 3, 4]
    assert by_id[4]["standing"] == 1
    assert by_id[1]["standing"] == 4


def test_build_golf_snapshot_h2h_has_records():
    snap = build_golf_snapshot(
        league_id="golf-h2h",
        name="H2H",
        season=2026,
        format="h2h",
        team_count=8,
        synced_at="2026-07-27T00:00:00+00:00",
    )
    assert snap["scoreboard"]["events"]
    records = [(t["wins"], t["losses"], t["ties"]) for t in snap["teams"]]
    assert any(w + l + t > 0 for w, l, t in records)
    assert snap["teams"][0]["team_id"] == 1
    assert min(t["standing"] for t in snap["teams"]) == 1
    assert sum(t["wins"] for t in snap["teams"]) == sum(t["losses"] for t in snap["teams"])


def test_build_golf_snapshot_season_points():
    snap = build_golf_snapshot(
        league_id="golf-sp",
        name="Points",
        season=2026,
        format="season_points",
        team_count=8,
        synced_at="2026-07-27T00:00:00+00:00",
    )
    assert all(t["wins"] == 0 and t["losses"] == 0 for t in snap["teams"])
    assert sum(t["points_for"] for t in snap["teams"]) != 0
    by_standing = sorted(snap["teams"], key=lambda t: t["standing"])
    pfs = [t["points_for"] for t in by_standing]
    assert pfs == sorted(pfs, reverse=True)
    assert snap["teams"][0]["team_id"] == 1
