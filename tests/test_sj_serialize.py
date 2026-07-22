from types import SimpleNamespace

from sj.serialize import serialize_league, serialize_team


def test_serialize_team_and_league():
    player = SimpleNamespace(
        playerId=1,
        name="Test Player",
        position="RB",
        lineupSlot="RB",
        proTeam="DAL",
        injuryStatus="ACTIVE",
        total_points=100.5,
        projected_total_points=90.0,
        avg_points=10.0,
    )
    team = SimpleNamespace(
        team_id=7,
        team_name="Unit Testers",
        team_abbrev="UT",
        owners=[{"firstName": "A", "lastName": "B"}],
        wins=3,
        losses=1,
        ties=0,
        points_for=400.2,
        points_against=350.1,
        standing=1,
        final_standing=0,
        division_name="East",
        roster=[player],
    )
    league = SimpleNamespace(
        settings=SimpleNamespace(name="ESPN Name"),
        teams=[team],
        current_week=4,
    )

    snapshot = serialize_league(
        league,
        league_id="football-main",
        sport="football",
        format="redraft",
        season=2025,
        espn_league_id=39790,
    )
    assert snapshot["team_count"] == 1
    assert snapshot["teams"][0]["owners"] == ["A B"]
    assert snapshot["teams"][0]["roster"][0]["name"] == "Test Player"
    assert snapshot["players"][0]["fantasy_team"] == "Unit Testers"
    assert serialize_team(team)["standing"] == 1
