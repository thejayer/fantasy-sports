"""Baseball 8.2 follow-up enrichers (trailing, schedule, probables, period IP)."""

from __future__ import annotations

from types import SimpleNamespace

from sj.baseball_enrich import (
    _attach_team_season_points,
    apply_trailing_stats_to_snapshot,
    enrich_pro_schedule_with_probables,
    parse_pitcher_ip_from_raw_schedule,
    parse_site_scoreboard_probables,
    parse_trailing_from_player_card,
    sync_baseball_category_boxes,
)
from sj.registry import load_registry
from sj.sample import sample_pro_schedule_for_snapshot, sample_snapshot
from sj.serialize import (
    extract_baseball_trailing_stats,
    extract_lineup_slot_stat_limits,
    serialize_player,
    serialize_settings,
)
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
    assert snap["scoring_type"] == "TOTAL_SEASON_POINTS"
    assert snap["settings"].get("categories")
    # Season Points weights (HR/RBI/OUTS/…) — more than classic 5×5 cats.
    assert len(snap["settings"]["categories"]) >= 10
    assert any(c.get("points") == 5.0 for c in snap["settings"]["categories"])
    assert snap["settings"].get("season_gs_max") == 200.0
    assert snap["settings"].get("min_weekly_ip") == 20.0
    # Pitchers carry GS for usage caps.
    pitchers = [
        p
        for t in snap["teams"]
        for p in t["roster"]
        if p.get("role") == "pitcher" or p.get("position") in {"P", "SP", "RP"}
    ]
    assert any((p.get("season_stats") or {}).get("GS") is not None for p in pitchers)


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
    snap = sample_snapshot(spec, spec.current_season, teams=6)
    snap["synced_at"] = "2026-07-27T00:00:00+00:00"
    doc = sample_pro_schedule_for_snapshot(snap)
    assert doc["sport"] == "baseball"
    assert doc["games"]
    assert any(g.get("probable_home") or g.get("probable_away") for g in doc["games"])
    # At least one pitcher id appears on two period games (two-start fixture).
    period = int(snap["current_week"])
    counts: dict[str, int] = {}
    for game in doc["games"]:
        if game.get("scoring_period_id") != period:
            continue
        for side in ("probable_home", "probable_away"):
            probable = game.get(side) or {}
            pid = probable.get("id")
            if pid is not None:
                key = str(pid)
                counts[key] = counts.get(key, 0) + 1
    assert any(n >= 2 for n in counts.values())
    store = FileStore(tmp_path)
    store.write_pro_schedule(doc)
    loaded = store.read_pro_schedule(spec.id, spec.current_season)
    assert loaded is not None
    assert len(loaded["games"]) == len(doc["games"])


def test_parse_site_scoreboard_probables():
    payload = {
        "events": [
            {
                "date": "2026-07-27T17:05Z",
                "competitions": [
                    {
                        "date": "2026-07-27T17:05Z",
                        "competitors": [
                            {
                                "homeAway": "home",
                                "team": {"abbreviation": "SF"},
                                "probables": [
                                    {
                                        "athlete": {
                                            "id": "111",
                                            "displayName": "Home Ace",
                                        }
                                    }
                                ],
                            },
                            {
                                "homeAway": "away",
                                "team": {"abbreviation": "BAL"},
                                "probables": [
                                    {
                                        "athlete": {
                                            "id": "222",
                                            "displayName": "Away Ace",
                                        }
                                    }
                                ],
                            },
                        ],
                    }
                ],
            }
        ]
    }
    parsed = parse_site_scoreboard_probables(payload)
    hit = parsed[("BAL", "SF", "2026-07-27")]
    assert hit["probable_home"]["name"] == "Home Ace"
    assert hit["probable_away"]["id"] == 222


def test_enrich_pro_schedule_with_probables_uses_fetch():
    doc = {
        "games": [
            {
                "away_pro_team": "BAL",
                "home_pro_team": "SF",
                "scoring_period_id": 24,
                "start_time": "2026-07-27T17:05:00+00:00",
            }
        ]
    }

    def _fetch(_ymd: str) -> dict:
        return {
            "events": [
                {
                    "competitions": [
                        {
                            "date": "2026-07-27T17:05Z",
                            "competitors": [
                                {
                                    "homeAway": "home",
                                    "team": {"abbreviation": "SF"},
                                    "probables": [
                                        {"athlete": {"id": "9", "displayName": "X"}}
                                    ],
                                },
                                {
                                    "homeAway": "away",
                                    "team": {"abbreviation": "BAL"},
                                    "probables": [
                                        {"athlete": {"id": "8", "displayName": "Y"}}
                                    ],
                                },
                            ],
                        }
                    ]
                }
            ]
        }

    n = enrich_pro_schedule_with_probables(doc, fetch_day=_fetch)
    assert n == 1
    assert doc["games"][0]["probable_home"]["name"] == "X"
    assert doc["games"][0]["probable_away"]["id"] == 8


def test_parse_pitcher_ip_from_raw_schedule():
    schedule = [
        {
            "home": {
                "teamId": 1,
                "rosterForCurrentScoringPeriod": {
                    "entries": [
                        {
                            "playerPoolEntry": {
                                "player": {
                                    "id": 55,
                                    "fullName": "Starter",
                                    "stats": [
                                        {
                                            "scoringPeriodId": 24,
                                            "statSourceId": 0,
                                            "stats": {"34": 18},  # OUTS
                                        }
                                    ],
                                }
                            }
                        }
                    ]
                },
            },
            "away": {"teamId": 2},
        }
    ]
    rows = parse_pitcher_ip_from_raw_schedule(schedule, scoring_period=24)
    assert len(rows) == 1
    assert rows[0]["player_id"] == 55
    assert rows[0]["outs"] == 18.0
    assert rows[0]["ip"] == 6.0


def test_extract_lineup_slot_stat_limits_from_raw_and_stub():
    stub = SimpleNamespace(
        lineup_slot_stat_limits=[{"slot": "P", "stat": "GS", "limit": 200}]
    )
    assert extract_lineup_slot_stat_limits(stub)[0]["limit"] == 200.0
    raw = SimpleNamespace(
        _raw_roster_settings={"lineupSlotStatLimits": {"13": {"33": 180}}}
    )
    rows = extract_lineup_slot_stat_limits(raw)
    assert rows[0]["slot"] == "P"
    assert rows[0]["stat"] == "GS"
    assert rows[0]["limit"] == 180.0

    settings_obj = SimpleNamespace(
        scoring_type="H2H_CATEGORY",
        reg_season_count=24,
        playoff_team_count=4,
        playoff_matchup_period_length=1,
        playoff_seed_tie_rule=None,
        playoff_tie_rule=None,
        tie_rule=None,
        keeper_count=5,
        faab=True,
        acquisition_budget=100,
        veto_votes_required=4,
        trade_deadline=20,
        team_count=10,
        median_scoring=False,
        division_map={},
        position_slot_counts=None,
        scoring_format=None,
        matchup_periods=None,
        _raw_scoring_settings={},
        lineup_slot_stat_limits=[{"slot": "P", "stat": "GS", "limit": 200}],
        min_weekly_ip=20,
        season_ip_max=1400,
    )
    league = SimpleNamespace(settings=settings_obj)
    payload = serialize_settings(league)
    assert payload["season_gs_max"] == 200.0
    assert payload["min_weekly_ip"] == 20.0
    assert payload["season_ip_max"] == 1400.0


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


def test_attach_team_season_points_from_espn_payload():
    team = SimpleNamespace(team_id=4, points_for=None)
    league = SimpleNamespace(teams=[team])
    n = _attach_team_season_points(
        league, [{"id": 4, "points": 6040.0, "pointsLive": 6040.0}]
    )
    assert n == 1
    assert team.points_for == 6040.0
    assert team.points == 6040.0


def test_sync_category_boxes_skips_season_points():
    league = SimpleNamespace(box_scores=lambda **_: (_ for _ in ()).throw(AssertionError()))
    spec = SimpleNamespace(sport="baseball", id="baseball-dynasty")
    written = sync_baseball_category_boxes(
        league,
        spec,
        2026,
        {"scoring_type": "TOTAL_SEASON_POINTS", "current_week": 24},
    )
    assert written == 0
