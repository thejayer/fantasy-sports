"""Typical-week posterior export (weekly posteriors for start/sit)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest
from typer.testing import CliRunner

from ffa.cli import app
from ffa.league import load_league
from ffa.simulation import simulate_typical_weeks, summarize_seasons
from ffa.weekly_export import (
    GRAIN_TYPICAL_WEEK,
    SCHEMA_VERSION,
    build_weekly_projection_table,
    build_weekly_snapshot_document,
    load_weekly_projection_snapshot,
    weekly_snapshot_path,
    write_weekly_projection_snapshot,
)


def _wk(player_id, season, week, position="WR", **stats):
    base = {
        "player_id": player_id,
        "player_display_name": player_id,
        "position": position,
        "recent_team": "TEAM",
        "season": season,
        "week": week,
    }
    base.update(stats)
    return base


def _summary_frame() -> pd.DataFrame:
    rows = []
    for i in range(12):
        rows.append(
            {
                "player_id": f"QB{i}",
                "player_display_name": f"QB {i}",
                "position": "QB",
                "recent_team": "KC",
                "points_mean": 22 - i * 0.4,
                "points_sd": 4.0,
                "q05": 14 - i * 0.3,
                "q25": 18 - i * 0.3,
                "q50": 22 - i * 0.4,
                "q75": 26 - i * 0.4,
                "q95": 32 - i * 0.4,
            }
        )
    for i in range(20):
        rows.append(
            {
                "player_id": f"RB{i}",
                "player_display_name": f"RB {i}",
                "position": "RB",
                "recent_team": "SF",
                "points_mean": 15 - i * 0.3,
                "points_sd": 5.0,
                "q05": 6 - i * 0.2,
                "q25": 10 - i * 0.2,
                "q50": 15 - i * 0.3,
                "q75": 18 - i * 0.3,
                "q95": 24 - i * 0.3,
            }
        )
    return pd.DataFrame(rows)


def test_simulate_typical_weeks_is_one_game_scale():
    rows = [
        _wk("A", 2024, w, receiving_yards=50, receiving_tds=1) for w in range(1, 17)
    ]
    weekly = pd.DataFrame(rows)
    samples = simulate_typical_weeks(
        weekly, target_season=2025, n_samples=100, seed=0
    )
    assert samples["receiving_yards"].iloc[0] == pytest.approx(50.0)
    assert samples["receiving_tds"].iloc[0] == pytest.approx(1.0)
    assert set(samples["sample_idx"]) == set(range(100))


def test_simulate_typical_weeks_deterministic():
    rows = [
        _wk("A", 2024, w, receiving_yards=50 + (w % 5) * 10) for w in range(1, 17)
    ]
    weekly = pd.DataFrame(rows)
    a = simulate_typical_weeks(weekly, target_season=2025, n_samples=200, seed=7)
    b = simulate_typical_weeks(weekly, target_season=2025, n_samples=200, seed=7)
    pd.testing.assert_frame_equal(a, b)


def test_write_and_load_weekly_snapshot_roundtrip(tmp_path):
    cfg = load_league(Path("configs/ppr.yaml"))
    table = build_weekly_projection_table(_summary_frame(), cfg)
    doc = build_weekly_snapshot_document(
        table,
        scoring="ppr",
        season=2025,
        n_sims=100,
        source={"engine": "ffa", "generator": "bootstrap_typical_week"},
        generated_at=datetime(2025, 9, 1, tzinfo=timezone.utc),
    )
    assert doc["schema_version"] == SCHEMA_VERSION
    assert doc["grain"] == GRAIN_TYPICAL_WEEK
    path = write_weekly_projection_snapshot(doc, tmp_path)
    assert path == weekly_snapshot_path(tmp_path, "ppr", 2025)
    loaded = load_weekly_projection_snapshot(path)
    assert loaded["grain"] == GRAIN_TYPICAL_WEEK
    assert loaded["season"] == 2025
    assert len(loaded["players"]) == len(table)
    assert loaded["players"][0]["floor"] is not None


def test_export_weekly_projections_cli(tmp_path):
    # summarize_seasons shape — thin summary returned by the mocked helper
    summary_for_cli = _summary_frame()

    runner = CliRunner()
    with (
        patch("ffa.cli.open_warehouse") as open_wh,
        patch("ffa.cli.simulate_typical_weeks") as sim,
        patch("ffa.cli.summarize_seasons", return_value=summary_for_cli),
        patch("ffa.cli.build_player_level", return_value={}),
        patch("ffa.cli._load_years_exp", return_value=None),
    ):
        con = open_wh.return_value
        con.execute.return_value.df.return_value = pd.DataFrame(
            [_wk("A", 2024, 1, receiving_yards=40)]
        )
        sim.return_value = pd.DataFrame(
            {"player_id": ["A"], "sample_idx": [0], "receiving_yards": [40.0]}
        )
        result = runner.invoke(
            app,
            [
                "export-weekly-projections",
                "--league",
                "configs/ppr.yaml",
                "--season",
                "2025",
                "--samples",
                "50",
                "--out-dir",
                str(tmp_path),
                "--conditioned-level",
            ],
        )
    assert result.exit_code == 0, result.output
    out = weekly_snapshot_path(tmp_path, "ppr", 2025)
    assert out.is_file()
    doc = load_weekly_projection_snapshot(out)
    assert doc["grain"] == GRAIN_TYPICAL_WEEK
    assert doc["n_sims"] == 50
    assert "typical_week" in result.output


def test_summarize_typical_weeks_scales_below_season():
    rows = [
        _wk("A", 2024, w, receiving_yards=50, receiving_tds=0) for w in range(1, 17)
    ]
    weekly = pd.DataFrame(rows)
    cfg = load_league(Path("configs/ppr.yaml"))
    week_samples = simulate_typical_weeks(
        weekly, target_season=2025, n_samples=200, seed=0
    )
    from ffa.simulation import simulate_seasons

    season_samples = simulate_seasons(
        weekly, target_season=2025, n_samples=200, expected_games=17, seed=0
    )
    week_summary = summarize_seasons(week_samples, cfg)
    season_summary = summarize_seasons(season_samples, cfg)
    assert float(week_summary.iloc[0]["points_mean"]) < float(
        season_summary.iloc[0]["points_mean"]
    ) / 10
