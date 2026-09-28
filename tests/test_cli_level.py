"""Roadmap 4.1: conditioned LevelModel path through the CLI helper."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest
import typer.main

from ffa.backtest import build_player_level, years_exp_from_rosters
from ffa.cli import _load_simulation_summary, app
from ffa.league import load_league
from ffa.level import LevelModel


def test_years_exp_from_rosters_renames_gsis_and_dedupes():
    rosters = pd.DataFrame(
        [
            {"gsis_id": "A", "season": 2024, "years_exp": 2, "week": 1},
            {"gsis_id": "A", "season": 2024, "years_exp": 2, "week": 2},
            {"gsis_id": "B", "season": 2024, "years_exp": 8, "week": 1},
        ]
    )
    out = years_exp_from_rosters(rosters)
    assert set(out.columns) == {"player_id", "season", "years_exp"}
    assert len(out) == 2
    assert dict(zip(out["player_id"], out["years_exp"])) == {"A": 2, "B": 8}


def test_years_exp_from_rosters_requires_columns():
    with pytest.raises(ValueError, match="years_exp"):
        years_exp_from_rosters(pd.DataFrame({"gsis_id": ["A"], "season": [2024]}))


def test_build_player_level_includes_collapse_and_experience():
    rows = []
    for pid, yards in (("star", 80), ("fringe", 20)):
        for season in (2022, 2023):
            for week in range(1, 10):
                rows.append(
                    {
                        "player_id": pid,
                        "season": season,
                        "week": week,
                        "position": "WR",
                        "receiving_yards": yards,
                        "receptions": 4,
                        "receiving_tds": 0,
                        "targets": 6,
                        "rushing_yards": 0,
                        "rushing_tds": 0,
                        "passing_yards": 0,
                        "passing_tds": 0,
                        "interceptions": 0,
                        "rushing_attempts": 0,
                    }
                )
    weekly = pd.DataFrame(rows)
    years_exp = pd.DataFrame(
        [
            {"player_id": "star", "season": 2024, "years_exp": 10},
            {"player_id": "fringe", "season": 2024, "years_exp": 0},
        ]
    )
    league = load_league(Path("configs/ppr.yaml"))
    table = build_player_level(
        weekly, 2024, league, LevelModel(), lookback=2, years_exp=years_exp
    )
    assert set(table) == {"star", "fringe"}
    sd_star, mean_star, coll_star = table["star"]
    sd_fringe, mean_fringe, coll_fringe = table["fringe"]
    assert sd_fringe >= sd_star
    assert mean_fringe > mean_star
    assert coll_fringe > coll_star


def _command_option_names(command_name: str) -> set[str]:
    """Inspect Click params directly — Rich help can interleave ANSI in flag text."""
    click_app = typer.main.get_command(app)
    cmd = click_app.commands[command_name]
    names: set[str] = set()
    for param in cmd.params:
        names.update(param.opts)
        names.update(param.secondary_opts)
    return names


def test_simulate_cli_exposes_conditioned_level_flag():
    assert "--conditioned-level" in _command_option_names("simulate")


def test_rank_draft_backtest_expose_conditioned_level_flag():
    for command in ("rank", "draft-sim", "optimize", "backtest"):
        assert "--conditioned-level" in _command_option_names(command), command


def test_load_simulation_summary_conditioned_builds_player_level(tmp_path, monkeypatch):
    """Wire-level check: conditioned path calls build_player_level and simulator."""
    import ffa.cli as cli_mod

    weekly = pd.DataFrame(
        [
            {
                "player_id": "P1",
                "season": season,
                "week": week,
                "position": "RB",
                "rushing_yards": 50,
                "rushing_tds": 0,
                "rushing_attempts": 10,
                "receiving_yards": 10,
                "receptions": 1,
                "receiving_tds": 0,
                "targets": 2,
                "passing_yards": 0,
                "passing_tds": 0,
                "interceptions": 0,
            }
            for season in (2022, 2023)
            for week in range(1, 8)
        ]
    )
    years = pd.DataFrame([{"player_id": "P1", "season": 2024, "years_exp": 3}])

    class FakeCon:
        def execute(self, query, params=None):
            class _R:
                def df(self_inner):
                    if "FROM weekly" in query:
                        return weekly.copy()
                    if "FROM rosters" in query:
                        return pd.DataFrame(
                            [
                                {
                                    "gsis_id": "P1",
                                    "season": 2024,
                                    "years_exp": 3,
                                    "week": 1,
                                }
                            ]
                        )
                    return pd.DataFrame()

            return _R()

    captured: dict = {}

    def fake_sim(weekly_df, target_season, **kwargs):
        captured["player_level"] = kwargs.get("player_level")
        captured["target_season"] = target_season
        # Minimal samples frame the summarizer can score.
        return pd.DataFrame(
            {
                "player_id": ["P1"] * 5,
                "sample_idx": range(5),
                "rushing_yards": [50.0] * 5,
                "rushing_tds": [0.0] * 5,
                "rushing_attempts": [10.0] * 5,
                "receiving_yards": [10.0] * 5,
                "receptions": [1.0] * 5,
                "receiving_tds": [0.0] * 5,
                "targets": [2.0] * 5,
                "passing_yards": [0.0] * 5,
                "passing_tds": [0.0] * 5,
                "interceptions": [0.0] * 5,
                "position": ["RB"] * 5,
            }
        )

    monkeypatch.setattr(cli_mod, "open_warehouse", lambda **kwargs: FakeCon())
    monkeypatch.setitem(cli_mod._GENERATORS, "bootstrap", (fake_sim, 0))

    cfg, summary = _load_simulation_summary(
        Path("configs/ppr.yaml"),
        2024,
        samples=5,
        lookback=2,
        decay=0.5,
        expected_games=17.0,
        seed=0,
        db=tmp_path / "x.duckdb",
        raw_dir=tmp_path,
        conditioned_level=True,
    )
    assert cfg.name  # loaded
    assert captured["target_season"] == 2024
    assert captured["player_level"] is not None
    assert "P1" in captured["player_level"]
    assert len(captured["player_level"]["P1"]) == 3
    assert not summary.empty
    # Sanity: years_exp helper used under the hood for the same shape.
    assert not years_exp_from_rosters(
        pd.DataFrame([{"gsis_id": "P1", "season": 2024, "years_exp": 3}])
    ).empty
    assert years.equals(
        years_exp_from_rosters(
            pd.DataFrame([{"gsis_id": "P1", "season": 2024, "years_exp": 3, "week": 1}])
        )
    )
