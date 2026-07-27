from types import SimpleNamespace

from sj.serialize import extract_baseball_season_stats, serialize_league, serialize_player


def test_serialize_team_and_league():
    player = SimpleNamespace(
        playerId=1,
        name="Test Player",
        position="RB",
        lineupSlot="RB",
        proTeam="DAL",
        injuryStatus="ACTIVE",
        status="ACTIVE",
        injured=False,
        eligibleSlots=["RB", "FLEX"],
        acquisitionType="DRAFT",
        percent_owned=88.5,
        total_points=100.5,
        projected_total_points=90.0,
        avg_points=10.0,
        stats={},
    )
    team = SimpleNamespace(
        team_id=7,
        team_name="Unit Testers",
        team_abbrev="UT",
        owners=[{"firstName": "A", "lastName": "B"}],
        logo_url="https://example.com/logo.png",
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
        settings=SimpleNamespace(name="ESPN Name", scoring_type="H2H_POINTS"),
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
    assert snapshot["teams"][0]["win_pct"] == 0.75
    assert snapshot["teams"][0]["roster"][0]["name"] == "Test Player"
    assert snapshot["players"][0]["fantasy_team"] == "Unit Testers"
    assert snapshot["period_label"] == "week"


def test_baseball_player_season_stats_and_role():
    hitter = SimpleNamespace(
        playerId=2,
        name="Slugger",
        position="OF",
        lineupSlot="OF",
        proTeam="NYY",
        injuryStatus="ACTIVE",
        status="ACTIVE",
        injured=False,
        eligibleSlots=["OF", "UTIL"],
        acquisitionType="DRAFT",
        percent_owned=95.0,
        total_points=220.0,
        projected_total_points=210.0,
        avg_points=4.0,
        stats={
            0: {
                "points": 220.0,
                "breakdown": {
                    "AB": 400,
                    "H": 120,
                    "R": 80,
                    "HR": 30,
                    "RBI": 90,
                    "SB": 12,
                    "AVG": 0.3,
                    "OBP": 0.38,
                    "OPS": 0.95,
                },
            }
        },
    )
    pitcher = SimpleNamespace(
        playerId=3,
        name="Ace",
        position="SP",
        lineupSlot="P",
        proTeam="LAD",
        injuryStatus="ACTIVE",
        status="ACTIVE",
        injured=False,
        eligibleSlots=["P", "SP"],
        acquisitionType="DRAFT",
        percent_owned=90.0,
        total_points=180.0,
        projected_total_points=175.0,
        avg_points=3.5,
        stats={
            0: {
                "points": 180.0,
                "breakdown": {
                    "OUTS": 450,
                    "W": 12,
                    "SV": 0,
                    "K": 150,
                    "ERA": 3.2,
                    "WHIP": 1.05,
                },
            }
        },
    )

    assert extract_baseball_season_stats(pitcher)["IP"] == 150.0
    h_payload = serialize_player(hitter, sport="baseball")
    p_payload = serialize_player(pitcher, sport="baseball")
    assert h_payload["role"] == "batter"
    assert h_payload["season_stats"]["HR"] == 30
    assert p_payload["role"] == "pitcher"
    assert p_payload["season_stats"]["IP"] == 150.0

    team = SimpleNamespace(
        team_id=1,
        team_name="Diamond",
        team_abbrev="DIA",
        owners=["Morgan"],
        logo_url="",
        wins=10,
        losses=5,
        ties=0,
        points_for=None,
        points_against=None,
        standing=1,
        final_standing=0,
        division_name="",
        roster=[hitter, pitcher],
    )
    league = SimpleNamespace(
        settings=SimpleNamespace(name="Baseball", scoring_type="H2H_CATEGORY"),
        teams=[team],
        current_week=18,
        scoring_type="H2H_CATEGORY",
    )
    snapshot = serialize_league(
        league,
        league_id="baseball-dynasty",
        sport="baseball",
        format="dynasty",
        season=2026,
        espn_league_id=2499137,
    )
    assert snapshot["period_label"] == "period"
    assert snapshot["teams"][0]["points_for"] == 400.0  # 220 + 180 roster fallback
    assert snapshot["players"][0]["name"] == "Slugger"
    assert snapshot["players"][0]["season_stats"]["HR"] == 30
