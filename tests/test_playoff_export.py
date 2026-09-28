"""Playoff-odds Monte Carlo export tests."""

from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pytest

from ffa.playoff_export import (
    SCHEMA_VERSION,
    apply_roster_trade,
    attach_prior_make_playoffs,
    build_playoff_odds_document,
    build_playoff_samples_document,
    greedy_lineup_points,
    load_playoff_odds_snapshot,
    playoff_odds_path,
    playoff_samples_path,
    simulate_playoff_odds,
    undecided_matchups,
    write_playoff_odds_snapshot,
    write_playoff_samples_snapshot,
)


def _mini_league(*, decided: bool = False) -> dict:
    if decided:
        outcomes_a = ["W", "W", "W", "W"]
        outcomes_b = ["L", "L", "L", "L"]
        outcomes_c = ["L", "L", "W", "L"]
    else:
        outcomes_a = ["W", "L", "U", "U"]
        outcomes_b = ["L", "W", "U", "U"]
        outcomes_c = ["U", "U", "U", "U"]
    return {
        "league_id": "mini",
        "espn_league_id": 99,
        "season": 2026,
        "current_week": 3,
        "settings": {
            "reg_season_count": 4,
            "playoff_team_count": 2,
            "position_slot_counts": {
                "QB": 1,
                "RB": 1,
                "WR": 1,
                "TE": 0,
                "FLEX": 0,
            },
        },
        "teams": [
            {
                "team_id": 1,
                "name": "Alpha",
                "wins": 2 if not decided else 4,
                "losses": 1 if not decided else 0,
                "ties": 0,
                "standing": 1,
                "points_for": 300,
                "schedule": [2, 2, 2, 2],
                "outcomes": outcomes_a,
                "scores": [100, 80, None, None],
                "roster": [
                    {"id": "e1", "position": "QB"},
                    {"id": "e2", "position": "RB"},
                    {"id": "e3", "position": "WR"},
                ],
            },
            {
                "team_id": 2,
                "name": "Beta",
                "wins": 1 if not decided else 0,
                "losses": 2 if not decided else 4,
                "ties": 0,
                "standing": 2,
                "points_for": 280,
                "schedule": [1, 1, 1, 1],
                "outcomes": outcomes_b,
                "scores": [90, 90, None, None],
                "roster": [
                    {"id": "e4", "position": "QB"},
                    {"id": "e5", "position": "RB"},
                    {"id": "e6", "position": "WR"},
                ],
            },
            {
                "team_id": 3,
                "name": "Gamma",
                "wins": 0 if not decided else 1,
                "losses": 0 if not decided else 3,
                "ties": 0,
                "standing": 3,
                "points_for": 100,
                "schedule": [3, 3, 3, 3],
                "outcomes": outcomes_c,
                "scores": [None, None, None, None],
                "roster": [],
            },
        ],
    }


def test_greedy_lineup_points_fills_slots():
    players = [
        ("a", "QB", 20),
        ("b", "RB", 18),
        ("c", "RB", 10),
        ("d", "WR", 15),
        ("e", "TE", 8),
    ]
    slots = {"QB": 1, "RB": 1, "WR": 1, "TE": 0, "FLEX": 1}
    # QB20 + RB18 + WR15 + FLEX RB10 = 63
    assert greedy_lineup_points(players, slots) == pytest.approx(63.0)


def test_undecided_matchups_dedupes():
    league = _mini_league()
    games = undecided_matchups(league["teams"], reg_season_count=4)
    assert games == [(3, 1, 2), (4, 1, 2)]


def test_simulate_stronger_team_favored():
    league = _mini_league()
    points = {
        "g1": np.full(100, 30.0),
        "g2": np.full(100, 20.0),
        "g3": np.full(100, 15.0),
        "g4": np.full(100, 5.0),
        "g5": np.full(100, 5.0),
        "g6": np.full(100, 5.0),
    }
    espn = {
        "e1": "g1",
        "e2": "g2",
        "e3": "g3",
        "e4": "g4",
        "e5": "g5",
        "e6": "g6",
    }
    res = simulate_playoff_odds(league, points, espn, n_sims=300, seed=1)
    by_id = {t["team_id"]: t for t in res["teams"]}
    assert by_id[1]["make_playoffs"] == pytest.approx(1.0)
    assert by_id[2]["make_playoffs"] == pytest.approx(1.0)
    assert by_id[3]["make_playoffs"] == pytest.approx(0.0)
    assert by_id[1]["avg_wins"] > by_id[2]["avg_wins"]
    assert sum(by_id[1]["seed_probs"].values()) == pytest.approx(
        by_id[1]["make_playoffs"]
    )


def test_decided_season_is_deterministic():
    league = _mini_league(decided=True)
    res = simulate_playoff_odds(league, {}, {}, n_sims=50, seed=0)
    assert res["periods_simulated"] == []
    by_id = {t["team_id"]: t for t in res["teams"]}
    assert by_id[1]["make_playoffs"] == pytest.approx(1.0)
    assert by_id[2]["make_playoffs"] == pytest.approx(0.0)
    assert by_id[3]["make_playoffs"] == pytest.approx(1.0)  # 1 win > Beta's 0


def test_write_load_roundtrip(tmp_path):
    league = _mini_league()
    points = {"g1": np.array([20.0, 22.0])}
    espn = {"e1": "g1"}
    res = simulate_playoff_odds(league, points, espn, n_sims=20, seed=0)
    doc = build_playoff_odds_document(
        league,
        res,
        scoring="ppr",
        n_sims=20,
        assumptions={"player_draws": "test"},
        source={"engine": "ffa"},
        generated_at=datetime(2026, 7, 28, tzinfo=timezone.utc),
    )
    assert doc["schema_version"] == SCHEMA_VERSION
    path = write_playoff_odds_snapshot(doc, tmp_path)
    assert path == playoff_odds_path(tmp_path, "mini", 2026)
    loaded = load_playoff_odds_snapshot(path)
    assert loaded["league_id"] == "mini"
    assert len(loaded["teams"]) == 3


def test_attach_prior_make_playoffs():
    doc = {
        "teams": [
            {"team_id": 1, "make_playoffs": 0.8},
            {"team_id": 2, "make_playoffs": 0.4},
        ]
    }
    prior = {
        "generated_at": "2026-01-01T00:00:00Z",
        "teams": [
            {"team_id": 1, "make_playoffs": 0.7},
            {"team_id": 2, "make_playoffs": 0.5},
        ],
    }
    out = attach_prior_make_playoffs(doc, prior)
    assert out["prior_generated_at"] == "2026-01-01T00:00:00Z"
    by_id = {t["team_id"]: t for t in out["teams"]}
    assert by_id[1]["make_playoffs_prior"] == pytest.approx(0.7)
    assert by_id[1]["delta_make"] == pytest.approx(0.1)
    assert by_id[2]["delta_make"] == pytest.approx(-0.1)


def test_build_playoff_samples_and_trade(tmp_path):
    league = _mini_league()
    points = {
        "g1": np.array([30.0, 28.0, 32.0, 29.0]),
        "g2": np.array([20.0, 18.0, 22.0, 19.0]),
        "g3": np.array([15.0, 14.0, 16.0, 15.0]),
        "g4": np.array([5.0, 6.0, 4.0, 5.0]),
        "g5": np.array([5.0, 5.0, 5.0, 5.0]),
        "g6": np.array([5.0, 5.0, 5.0, 5.0]),
    }
    espn = {
        "e1": "g1",
        "e2": "g2",
        "e3": "g3",
        "e4": "g4",
        "e5": "g5",
        "e6": "g6",
    }
    samples = build_playoff_samples_document(
        league,
        points,
        espn,
        scoring="ppr",
        n_sims=50,
        seed=0,
        hub_samples=4,
        source={"engine": "ffa"},
    )
    assert set(samples["points_by_espn"]) == {"e1", "e2", "e3", "e4", "e5", "e6"}
    assert samples["n_samples"] == 4
    path = write_playoff_samples_snapshot(samples, tmp_path)
    assert path == playoff_samples_path(tmp_path, "mini", 2026)

    swapped = apply_roster_trade(league, 1, 2, ["e1"], ["e4"])
    a_ids = {str(p["id"]) for p in swapped["teams"][0]["roster"]}
    b_ids = {str(p["id"]) for p in swapped["teams"][1]["roster"]}
    assert "e1" not in a_ids and "e4" in a_ids
    assert "e4" not in b_ids and "e1" in b_ids


def test_export_playoff_odds_cli(tmp_path):
    from unittest.mock import patch

    import pandas as pd
    from typer.testing import CliRunner

    from ffa.cli import app

    league = _mini_league()
    runner = CliRunner()
    samples = pd.DataFrame(
        {
            "player_id": ["g1", "g1"],
            "sample_idx": [0, 1],
            "passing_yards": [250.0, 260.0],
        }
    )
    with (
        patch("ffa.cli.open_warehouse") as open_wh,
        patch("ffa.cli.simulate_typical_weeks", return_value=samples),
        patch("ffa.cli.build_player_level", return_value={}),
        patch("ffa.cli._load_years_exp", return_value=None),
        patch("ffa.cli.score_player_weeks", return_value=pd.Series([20.0, 22.0])),
        patch("sj.store.list_snapshots", return_value=[{"league_id": "mini", "season": 2026, "sport": "football"}]),
        patch("sj.store.read_snapshot", return_value=league),
    ):
        con = open_wh.return_value
        con.execute.return_value.df.return_value = pd.DataFrame(
            [{"player_id": "g1", "season": 2025, "week": 1}]
        )
        result = runner.invoke(
            app,
            [
                "export-playoff-odds",
                "--sj-root",
                str(tmp_path),
                "--season",
                "2026",
                "--league-id",
                "mini",
                "--sims",
                "25",
                "--samples",
                "2",
                "--out-dir",
                str(tmp_path / "odds"),
                "--no-conditioned-level",
            ],
        )
    assert result.exit_code == 0, result.output
    out = playoff_odds_path(tmp_path / "odds", "mini", 2026)
    assert out.is_file()
    doc = load_playoff_odds_snapshot(out)
    assert doc["n_sims"] == 25
    assert doc["assumptions"]["metric"] == "make_playoffs_regular_season_only"
