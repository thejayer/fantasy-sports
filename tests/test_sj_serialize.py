from types import SimpleNamespace

from sj.serialize import (
    extract_baseball_season_stats,
    serialize_draft,
    serialize_league,
    serialize_player,
    serialize_team,
)


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
    opponent = SimpleNamespace(team_id=2)
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
        # Football espn-api shape: parallel arrays; schedule may hold Team objects.
        schedule=[opponent, 7],
        scores=[112.4, 0.0],
        outcomes=["W", "U"],
        roster=[player],
    )
    draft_pick = SimpleNamespace(
        team=team,
        playerId=1,
        playerName="Test Player",
        round_num=1,
        round_pick=1,
        bid_amount=0,
        keeper_status=False,
        nominatingTeam=None,
    )
    league = SimpleNamespace(
        settings=SimpleNamespace(name="ESPN Name", scoring_type="H2H_POINTS"),
        teams=[team],
        current_week=4,
        draft=[draft_pick],
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
    assert snapshot["teams"][0]["schedule"] == [2, 7]
    assert snapshot["teams"][0]["scores"] == [112.4, 0.0]
    assert snapshot["teams"][0]["outcomes"] == ["W", "U"]
    assert snapshot["draft"] == [
        {
            "round": 1,
            "round_pick": 1,
            "team_id": 7,
            "player_id": 1,
            "player_name": "Test Player",
            "bid_amount": 0.0,
            "keeper": False,
            "nominating_team_id": None,
        }
    ]


def test_serialize_draft_handles_missing_and_auction_fields():
    league = SimpleNamespace(
        draft=[
            SimpleNamespace(
                team=3,
                playerId=99,
                playerName="Auction Star",
                round_num=1,
                round_pick=1,
                bid_amount=45,
                keeper_status=True,
                nominatingTeam=SimpleNamespace(team_id=8),
            )
        ]
    )
    assert serialize_draft(league) == [
        {
            "round": 1,
            "round_pick": 1,
            "team_id": 3,
            "player_id": 99,
            "player_name": "Auction Star",
            "bid_amount": 45.0,
            "keeper": True,
            "nominating_team_id": 8,
        }
    ]
    assert serialize_draft(SimpleNamespace()) == []


def test_baseball_matchups_normalize_to_parallel_arrays():
    """Baseball espn-api teams carry Matchup objects — normalize to football shape."""
    team = SimpleNamespace(
        team_id=1,
        team_name="Diamond",
        team_abbrev="DIA",
        owners=["Morgan"],
        logo_url="",
        wins=1,
        losses=0,
        ties=0,
        points_for=None,
        points_against=None,
        standing=1,
        final_standing=0,
        division_name="",
        schedule=[
            SimpleNamespace(
                home_team=1,
                away_team=4,
                home_final_score=5.0,
                away_final_score=3.0,
                home_team_live_score=7.5,
                away_team_live_score=2.5,
                winner="HOME",
            ),
            SimpleNamespace(
                home_team=2,
                away_team=1,
                home_final_score=1.0,
                away_final_score=4.0,
                home_team_live_score=None,
                away_team_live_score=None,
                winner="AWAY",
            ),
        ],
        roster=[],
    )
    payload = serialize_team(team, sport="baseball")
    # Category live scores preferred when present; otherwise final points.
    assert payload["schedule"] == [4, 2]
    assert payload["scores"] == [7.5, 4.0]
    assert payload["outcomes"] == ["W", "W"]


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
