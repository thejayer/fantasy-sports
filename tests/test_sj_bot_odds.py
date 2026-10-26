"""ESPN scoreboard parsing for SJ Bot (synthetic payload only)."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from sj.bot.odds import (
    FixtureOddsProvider,
    implied_prob,
    parse_espn_scoreboard,
    parse_record_summary,
)
from sj.bot.sample import parsed_sample_games, sample_espn_scoreboard
from sj.snapshot_layout import bets_rel

FIX = Path(__file__).resolve().parent / "fixtures" / "bot" / "espn_scoreboard.json"


def test_parse_espn_scoreboard_fixture():
    payload = json.loads(FIX.read_text(encoding="utf-8"))
    games = parse_espn_scoreboard(payload, "NFL")
    assert len(games) == 1
    game = games[0]
    assert game["id"] == "syn-401"
    assert game["away"]["abbr"] == "RED"
    assert game["home"]["abbr"] == "BAY"
    assert game["away"]["record"] == {"wins": 6, "losses": 2}
    assert game["status"]["state"] == "pre"
    types = {(row["type"], row["side"]) for row in game["markets"]}
    assert ("spread", "away") in types
    assert ("spread", "home") in types
    assert ("total", "over") in types
    assert ("total", "under") in types
    assert ("ml", "away") in types
    assert ("ml", "home") in types
    away_spread = next(row for row in game["markets"] if row["type"] == "spread" and row["side"] == "away")
    assert away_spread["line"] == -3.5
    assert away_spread["american"] == -110
    assert away_spread["selection"] == "RED -3.5"
    over = next(row for row in game["markets"] if row["type"] == "total" and row["side"] == "over")
    assert over["line"] == 44.5
    assert over["american"] == -105
    away_ml = next(row for row in game["markets"] if row["type"] == "ml" and row["side"] == "away")
    assert away_ml["american"] == -162


def test_parse_final_sample_sets_scores():
    day = date(2026, 10, 20)
    games = parse_espn_scoreboard(sample_espn_scoreboard("NFL", day, final=True), "NFL")
    assert games[0]["status"]["completed"] is True
    assert games[0]["away"]["score"] == 27
    assert games[0]["home"]["score"] == 20


def test_missing_odds_still_returns_the_game():
    payload = {
        "events": [
            {
                "id": "bare",
                "date": "2026-10-26T17:00:00Z",
                "competitions": [
                    {
                        "competitors": [
                            {
                                "homeAway": "away",
                                "team": {"id": "1", "abbreviation": "AA", "displayName": "Away"},
                            },
                            {
                                "homeAway": "home",
                                "team": {"id": "2", "abbreviation": "HH", "displayName": "Home"},
                            },
                        ],
                        "odds": [],
                        "status": {"type": {"state": "pre", "completed": False}},
                    }
                ],
            }
        ]
    }
    games = parse_espn_scoreboard(payload, "NBA")
    assert games[0]["markets"] == []


def test_fixture_provider_and_record_helpers():
    provider = FixtureOddsProvider({("NFL", "2026-10-20"): sample_espn_scoreboard("NFL", date(2026, 10, 20))})
    payload = provider.scoreboard("NFL", date(2026, 10, 20))
    assert payload["events"]
    assert provider.scoreboard("CFB", date(2026, 10, 20)) == {"events": []}
    assert parse_record_summary("6-2") == {"wins": 6, "losses": 2}
    assert parse_record_summary("nope") is None
    assert implied_prob(-110) == 110 / 210
    assert implied_prob(150) == 100 / 250
    assert parsed_sample_games()


def test_bets_rel_allows_bot_nested_paths():
    assert bets_rel("bot/board") == "bets/bot/board.json"
    assert bets_rel("bot/lines/2026-10-26T12-00-00Z") == "bets/bot/lines/2026-10-26T12-00-00Z.json"
    assert bets_rel("record_splits") == "bets/record_splits.json"
    assert bets_rel("bot/../board") == "bets/bot/board.json"
