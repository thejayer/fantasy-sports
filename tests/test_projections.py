"""Roadmap 4.2: consumable projection snapshots for the hub store."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest
import typer.main
from typer.testing import CliRunner

from ffa.cli import app
from ffa.league import load_league
from ffa.projections import (
    SCHEMA_VERSION,
    build_projection_table,
    build_snapshot_document,
    load_projection_snapshot,
    scoring_slug,
    snapshot_paths,
    write_projection_snapshot,
)


def _summary_frame() -> pd.DataFrame:
    rows = []
    for i in range(15):
        rows.append(
            {
                "player_id": f"QB{i}",
                "player_display_name": f"QB {i}",
                "position": "QB",
                "recent_team": "KC",
                "points_mean": 300 - i * 5,
                "points_sd": 20.0,
                "q05": 250 - i * 5,
                "q25": 280 - i * 5,
                "q50": 300 - i * 5,
                "q75": 320 - i * 5,
                "q95": 350 - i * 5,
            }
        )
    for i in range(30):
        rows.append(
            {
                "player_id": f"RB{i}",
                "player_display_name": f"RB {i}",
                "position": "RB",
                "recent_team": "SF",
                "points_mean": 200 - i * 3,
                "points_sd": 30.0,
                "q05": 140 - i * 3,
                "q25": 170 - i * 3,
                "q50": 200 - i * 3,
                "q75": 230 - i * 3,
                "q95": 280 - i * 3,
            }
        )
    return pd.DataFrame(rows)


def test_scoring_slug_from_config():
    assert scoring_slug(load_league(Path("configs/ppr.yaml"))) == "ppr"
    assert scoring_slug(load_league(Path("configs/standard.yaml"))) == "standard"


def test_build_projection_table_aliases_and_vor():
    cfg = load_league(Path("configs/ppr.yaml"))
    table = build_projection_table(_summary_frame(), cfg, n_tiers=5)
    assert list(table.columns) == [
        "player_id",
        "player_name",
        "position",
        "team",
        "points_mean",
        "points_sd",
        "floor",
        "median",
        "ceiling",
        "vor",
        "tier",
    ]
    # Sorted by VOR desc — RB0 typically outranks QB0 under PPR roster depths.
    assert table.iloc[0]["vor"] >= table.iloc[1]["vor"]
    qb0 = table.loc[table["player_id"] == "QB0"].iloc[0]
    assert qb0["floor"] == pytest.approx(250.0)
    assert qb0["median"] == pytest.approx(300.0)
    assert qb0["ceiling"] == pytest.approx(350.0)
    assert qb0["vor"] > 0
    assert int(qb0["tier"]) == 1
    assert qb0["player_name"] == "QB 0"
    assert qb0["team"] == "KC"


def test_write_and_load_snapshot_roundtrip(tmp_path):
    cfg = load_league(Path("configs/ppr.yaml"))
    table = build_projection_table(_summary_frame(), cfg)
    doc = build_snapshot_document(
        table,
        scoring=scoring_slug(cfg),
        season=2025,
        n_sims=100,
        source={"engine": "ffa", "conditioned_level": True},
    )
    assert doc["schema_version"] == SCHEMA_VERSION
    assert doc["scoring"] == "ppr"
    assert len(doc["players"]) == len(table)

    written = write_projection_snapshot(doc, table, tmp_path, fmt="both")
    json_path, parquet_path = snapshot_paths(tmp_path, "ppr", 2025)
    assert written == [json_path, parquet_path]
    assert json_path.is_file()
    assert parquet_path.is_file()

    loaded = load_projection_snapshot(json_path)
    assert loaded["season"] == 2025
    by_id = {p["player_id"]: p for p in loaded["players"]}
    assert "QB0" in by_id
    assert by_id["QB0"]["floor"] == pytest.approx(250.0)
    assert by_id["RB0"]["vor"] >= by_id["QB0"]["vor"]

    pq = pd.read_parquet(parquet_path)
    assert "vor" in pq.columns
    assert len(pq) == len(table)


def test_export_projections_cli_defaults_conditioned_level():
    click_app = typer.main.get_command(app)
    cmd = click_app.commands["export-projections"]
    names: set[str] = set()
    for param in cmd.params:
        names.update(param.opts)
        names.update(param.secondary_opts)
    assert "--conditioned-level" in names
    assert "--no-conditioned-level" in names
    # Default True for export (unlike simulate/rank).
    param = next(p for p in cmd.params if "--conditioned-level" in (p.opts + p.secondary_opts))
    assert param.default is True


def test_export_projections_cli_writes_store(tmp_path, monkeypatch):
    import ffa.cli as cli_mod

    cfg = load_league(Path("configs/ppr.yaml"))
    summary = _summary_frame()

    def fake_load(*_args, **_kwargs):
        return cfg, summary

    monkeypatch.setattr(cli_mod, "_load_simulation_summary", fake_load)
    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "export-projections",
            "--season",
            "2025",
            "--out-dir",
            str(tmp_path),
            "--samples",
            "50",
            "--format",
            "json",
            "--no-conditioned-level",
        ],
    )
    assert result.exit_code == 0, result.output
    path = tmp_path / "ppr" / "2025.json"
    assert path.is_file()
    payload = json.loads(path.read_text())
    assert payload["n_sims"] == 50
    assert payload["source"]["conditioned_level"] is False
    assert payload["source"]["engine"] == "ffa"
    assert len(payload["players"]) == len(summary)
