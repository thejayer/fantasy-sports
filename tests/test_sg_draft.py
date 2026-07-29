from sg.draft import run_snake_draft, snake_pick_order
from sg.pool import owgr_pool, pool_size_for_league
from sg.settings import GolfSettings
from sg.snapshot import build_golf_snapshot


def test_snake_pick_order_reverses_even_rounds():
    order = snake_pick_order([1, 2, 3], rounds=2)
    assert order[0] == (1, 1, 1)
    assert order[2] == (1, 3, 3)
    assert order[3] == (2, 1, 3)
    assert order[-1] == (2, 3, 1)


def test_run_snake_draft_fills_rosters_and_picks():
    teams = [{"team_id": i, "name": f"T{i}", "roster": []} for i in range(1, 7)]
    settings = GolfSettings.model_validate({"roster": {"starters": 5, "bench": 4}})
    picks, players, free_agents = run_snake_draft(teams, settings)
    assert len(picks) == 6 * 9
    assert picks[0]["player_name"] == "Scottie Scheffler"
    assert picks[0]["team_id"] == 1
    # Round 2 first pick is last team (snake).
    assert picks[6]["team_id"] == 6
    for team in teams:
        assert len(team["roster"]) == 9
        assert sum(1 for p in team["roster"] if p["slot"] == "GS") == 5
        assert sum(1 for p in team["roster"] if p["slot"] == "BE") == 4
    assert len(players) == 54
    assert free_agents
    assert free_agents[0]["slot"] == "FA"


def test_build_golf_snapshot_drafts_by_default():
    snap = build_golf_snapshot(
        league_id="golf-test",
        name="Test",
        season=2026,
        format="h2h",
        team_count=8,
        golf={"roster": {"starters": 5, "bench": 10}},
        synced_at="2026-07-27T00:00:00+00:00",
    )
    assert len(snap["draft"]) == 8 * 15
    team1 = next(t for t in snap["teams"] if t["team_id"] == 1)
    assert team1["roster"][0]["name"] == "Scottie Scheffler"
    assert len(snap["players"]) == 120
    empty = build_golf_snapshot(
        league_id="golf-empty",
        name="Empty",
        season=2026,
        format="h2h",
        team_count=8,
        run_draft=False,
        synced_at="2026-07-27T00:00:00+00:00",
    )
    assert empty["draft"] == []
    assert empty["teams"][0]["roster"] == []


def test_pool_size_covers_draft_plus_buffer():
    size = pool_size_for_league(team_count=14, starters=5, bench=20)
    assert size >= 14 * 25 + 20
    assert len(owgr_pool(size)) == size
