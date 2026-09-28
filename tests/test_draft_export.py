"""Roadmap 4.5: hub-consumable draft-sim snapshots."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import typer.main
from typer.testing import CliRunner

from ffa.cli import app
from ffa.draft import simulate_draft
from ffa.draft_export import (
    SCHEMA_VERSION,
    build_availability_table,
    build_draft_sim_document,
    build_pick_rate_table,
    draft_sim_path,
    load_draft_sim_snapshot,
    write_draft_sim_snapshot,
)
from ffa.league import load_league


def _ranked_board() -> pd.DataFrame:
    rows = []
    for i, pos in enumerate(["QB"] * 8 + ["RB"] * 20 + ["WR"] * 20 + ["TE"] * 10 + ["K"] * 8 + ["DST"] * 8):
        rows.append(
            {
                "player_id": f"{pos}{i}",
                "player_display_name": f"{pos} Player {i}",
                "position": pos,
                "recent_team": "KC",
                "points_mean": 200 - i,
                "vor": 50.0 - i * 0.5,
            }
        )
    return pd.DataFrame(rows)


def test_build_tables_and_write_roundtrip(tmp_path):
    cfg = load_league(Path("configs/ppr.yaml"))
    ranked = _ranked_board()
    # Shrink roster so the tiny pool is enough for a short draft.
    cfg.roster.teams = 4
    cfg.roster.bench = 1
    result = simulate_draft(
        ranked,
        cfg.roster,
        user_slot=2,
        n_sims=20,
        opponent_noise=0.1,
        seed=1,
    )
    picks = build_pick_rate_table(result.user_picks, ranked, top=10)
    assert not picks.empty
    assert {"player_id", "pick_rate", "avg_round", "vor"} <= set(picks.columns)

    avail = build_availability_table(result.availability, ranked, top=15)
    assert not avail.empty
    assert any(str(c).startswith("round_") for c in avail.columns)

    doc = build_draft_sim_document(
        result,
        ranked,
        scoring="ppr",
        season=2025,
        user_slot=2,
        n_sims=20,
        teams=4,
        rounds=8,
        source={"engine": "ffa", "conditioned_level": True},
        pick_rate_top=10,
        availability_top=15,
    )
    assert doc["schema_version"] == SCHEMA_VERSION
    assert doc["user_slot"] == 2
    assert len(doc["pick_rates"]) <= 10

    path = write_draft_sim_snapshot(doc, tmp_path)
    assert path == draft_sim_path(tmp_path, "ppr", 2025, 2)
    loaded = load_draft_sim_snapshot(path)
    assert loaded["season"] == 2025
    assert loaded["pick_rates"][0]["player_id"]


def test_export_draft_sim_cli_writes_slots(tmp_path, monkeypatch):
    import ffa.cli as cli_mod

    cfg = load_league(Path("configs/ppr.yaml"))
    cfg.roster.teams = 4
    cfg.roster.bench = 1
    ranked = _ranked_board()
    # Fake summary still needs vor via compute_vor — export calls compute_vor
    # on the summary, so provide mean/quantile-ish columns.
    summary = ranked.rename(columns={"points_mean": "points_mean"}).assign(
        points_sd=20.0,
        q05=lambda d: d["points_mean"] - 30,
        q25=lambda d: d["points_mean"] - 10,
        q50=lambda d: d["points_mean"],
        q75=lambda d: d["points_mean"] + 10,
        q95=lambda d: d["points_mean"] + 30,
    )

    def fake_load(*_args, **_kwargs):
        return cfg, summary

    monkeypatch.setattr(cli_mod, "_load_simulation_summary", fake_load)
    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "export-draft-sim",
            "--season",
            "2025",
            "--out-dir",
            str(tmp_path),
            "--slots",
            "1,2",
            "--sims",
            "15",
            "--samples",
            "50",
            "--no-conditioned-level",
        ],
    )
    assert result.exit_code == 0, result.output
    path1 = tmp_path / "ppr" / "2025" / "slot_1.json"
    path2 = tmp_path / "ppr" / "2025" / "slot_2.json"
    assert path1.is_file() and path2.is_file()
    payload = json.loads(path1.read_text())
    assert payload["n_sims"] == 15
    assert payload["user_slot"] == 1
    assert payload["source"]["conditioned_level"] is False
    assert payload["pick_rates"]


def test_export_draft_sim_cli_defaults_conditioned_level():
    click_app = typer.main.get_command(app)
    cmd = click_app.commands["export-draft-sim"]
    param = next(
        p
        for p in cmd.params
        if "--conditioned-level" in (p.opts + p.secondary_opts)
    )
    assert param.default is True
