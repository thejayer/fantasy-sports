"""Roadmap 4.3: ESPN ↔ nflverse player ID mapping."""

from __future__ import annotations

import json

import pandas as pd
import pytest
import typer.main
from typer.testing import CliRunner

from ffa.cli import app
from ffa.player_map import (
    SCHEMA_VERSION,
    build_player_map_document,
    collect_hub_espn_players,
    compute_hub_coverage,
    crosswalk_from_ff_playerids,
    crosswalk_from_rosters,
    extract_espn_players_from_snapshot,
    lookup_player_id,
    merge_crosswalks,
    normalize_espn_id,
    write_player_map,
)


def test_normalize_espn_id_strips_float_artifact():
    assert normalize_espn_id(3139477.0) == "3139477"
    assert normalize_espn_id("3139477.0") == "3139477"
    assert normalize_espn_id(3139477) == "3139477"
    assert normalize_espn_id(None) is None
    assert normalize_espn_id(float("nan")) is None


def test_crosswalk_from_rosters_latest_wins():
    rosters = pd.DataFrame(
        [
            {
                "season": 2023,
                "week": 1,
                "gsis_id": "00-OLD",
                "espn_id": "111",
                "full_name": "Old Name",
                "position": "QB",
            },
            {
                "season": 2024,
                "week": 10,
                "gsis_id": "00-NEW",
                "espn_id": "111",
                "full_name": "New Name",
                "position": "QB",
            },
            {
                "season": 2024,
                "week": 1,
                "gsis_id": "00-RB",
                "espn_id": "222",
                "full_name": "Runner",
                "position": "RB",
            },
        ]
    )
    out = crosswalk_from_rosters(rosters, season=None)
    by_espn = dict(zip(out["espn_id"], out["player_id"]))
    assert by_espn == {"111": "00-NEW", "222": "00-RB"}
    assert set(out["method"]) == {"roster"}


def test_merge_prefers_primary_method():
    primary = crosswalk_from_rosters(
        pd.DataFrame(
            [
                {
                    "season": 2024,
                    "week": 1,
                    "gsis_id": "00-A",
                    "espn_id": "1",
                    "full_name": "A",
                    "position": "WR",
                }
            ]
        )
    )
    fill = crosswalk_from_ff_playerids(
        pd.DataFrame(
            [
                {"gsis_id": "00-WRONG", "espn_id": 1.0, "name": "A", "position": "WR"},
                {"gsis_id": "00-B", "espn_id": 2.0, "name": "B", "position": "TE"},
            ]
        )
    )
    merged = merge_crosswalks(primary, fill)
    assert dict(zip(merged["espn_id"], merged["player_id"])) == {
        "1": "00-A",
        "2": "00-B",
    }
    assert merged.loc[merged["espn_id"] == "1", "method"].iloc[0] == "roster"
    assert merged.loc[merged["espn_id"] == "2", "method"].iloc[0] == "ff_playerids"


def test_hub_coverage_reports_misses():
    crosswalk = pd.DataFrame(
        [
            {"espn_id": "3139477", "player_id": "00-0033873", "method": "roster"},
            {"espn_id": "3117251", "player_id": "00-0033280", "method": "roster"},
        ]
    )
    hub = [
        {"espn_id": "3139477", "name": "Patrick Mahomes", "position": "QB"},
        {"espn_id": "9999999", "name": "Unknown", "position": "WR", "pro_team": "FA"},
    ]
    coverage = compute_hub_coverage(hub, crosswalk)
    assert coverage["rostered"] == 2
    assert coverage["resolved"] == 1
    assert coverage["rate"] == pytest.approx(0.5)
    assert coverage["misses"][0]["espn_id"] == "9999999"
    assert coverage["misses"][0]["reason"] == "unmapped"


def test_extract_and_collect_from_sj_store(tmp_path):
    snap = {
        "league_id": "football-main",
        "sport": "football",
        "season": 2025,
        "teams": [
            {
                "team_id": 1,
                "roster": [
                    {"id": 3139477, "name": "Patrick Mahomes", "position": "QB"},
                    {"id": 3117251, "name": "Christian McCaffrey", "position": "RB"},
                ],
            }
        ],
        "players": [
            {"id": "4262921", "name": "Justin Jefferson", "position": "WR"},
        ],
    }
    players = extract_espn_players_from_snapshot(snap)
    assert {p["espn_id"] for p in players} == {"3139477", "3117251", "4262921"}

    # Minimal FileStore-compatible tree (v1 monolith + index).
    league_dir = tmp_path / "football-main"
    league_dir.mkdir()
    (league_dir / "2025.json").write_text(json.dumps(snap), encoding="utf-8")
    index = {
        "generated_at": "2025-01-01T00:00:00Z",
        "leagues": [
            {
                "league_id": "football-main",
                "sport": "football",
                "format": "redraft",
                "season": 2025,
                "path": "football-main/2025.json",
            },
            {
                "league_id": "baseball-dynasty",
                "sport": "baseball",
                "format": "dynasty",
                "season": 2025,
                "path": "baseball-dynasty/2025.json",
            },
        ],
    }
    (tmp_path / "index.json").write_text(json.dumps(index), encoding="utf-8")
    (tmp_path / "baseball-dynasty").mkdir()
    (tmp_path / "baseball-dynasty" / "2025.json").write_text(
        json.dumps(
            {
                "league_id": "baseball-dynasty",
                "sport": "baseball",
                "season": 2025,
                "teams": [{"roster": [{"id": 1, "name": "Batter"}]}],
                "players": [],
            }
        ),
        encoding="utf-8",
    )

    hub = collect_hub_espn_players(tmp_path)
    assert {p["espn_id"] for p in hub} == {"3139477", "3117251", "4262921"}


def test_write_player_map_roundtrip(tmp_path):
    crosswalk = pd.DataFrame(
        [
            {
                "espn_id": "3139477",
                "player_id": "00-0033873",
                "name": "Patrick Mahomes",
                "position": "QB",
                "method": "roster",
            }
        ]
    )
    coverage = compute_hub_coverage(
        [{"espn_id": "3139477", "name": "Patrick Mahomes", "position": "QB"}],
        crosswalk,
    )
    doc = build_player_map_document(crosswalk, season=2025, coverage=coverage)
    assert doc["schema_version"] == SCHEMA_VERSION
    path = write_player_map(doc, tmp_path)
    assert path == tmp_path / "2025.json"
    loaded = json.loads(path.read_text())
    assert lookup_player_id(loaded, 3139477) == "00-0033873"
    assert lookup_player_id(loaded, "999") is None
    assert loaded["coverage"]["rate"] == pytest.approx(1.0)


def test_export_player_map_cli(tmp_path, monkeypatch):
    import ffa.cli as cli_mod

    raw = tmp_path / "raw"
    raw.mkdir()
    pd.DataFrame(
        [
            {
                "season": 2024,
                "week": 1,
                "gsis_id": "00-0033873",
                "espn_id": "3139477",
                "full_name": "Patrick Mahomes",
                "position": "QB",
            },
            {
                "season": 2024,
                "week": 1,
                "gsis_id": "00-0033280",
                "espn_id": "3117251",
                "full_name": "Christian McCaffrey",
                "position": "RB",
            },
        ]
    ).to_parquet(raw / "rosters.parquet", index=False)

    sj = tmp_path / "sj"
    (sj / "football-main").mkdir(parents=True)
    snap = {
        "league_id": "football-main",
        "sport": "football",
        "season": 2025,
        "teams": [
            {
                "team_id": 1,
                "roster": [
                    {"id": 3139477, "name": "Patrick Mahomes", "position": "QB"},
                    {"id": 999, "name": "Miss", "position": "WR"},
                ],
            }
        ],
        "players": [],
    }
    (sj / "football-main" / "2025.json").write_text(json.dumps(snap), encoding="utf-8")
    (sj / "index.json").write_text(
        json.dumps(
            {
                "leagues": [
                    {
                        "league_id": "football-main",
                        "sport": "football",
                        "season": 2025,
                        "path": "football-main/2025.json",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        cli_mod,
        "fetch_ff_playerids",
        lambda: pd.DataFrame(
            [{"gsis_id": "00-FILL", "espn_id": 888.0, "name": "Fill", "position": "TE"}]
        ),
    )

    out = tmp_path / "player_map"
    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "export-player-map",
            "--season",
            "2025",
            "--raw-dir",
            str(raw),
            "--sj-root",
            str(sj),
            "--out-dir",
            str(out),
        ],
    )
    assert result.exit_code == 0, result.output
    payload = json.loads((out / "2025.json").read_text())
    assert lookup_player_id(payload, "3139477") == "00-0033873"
    assert lookup_player_id(payload, "888") == "00-FILL"
    assert payload["coverage"]["rostered"] == 2
    assert payload["coverage"]["resolved"] == 1
    assert payload["coverage"]["misses"][0]["espn_id"] == "999"


def test_export_player_map_cli_fail_below(tmp_path, monkeypatch):
    import ffa.cli as cli_mod

    raw = tmp_path / "raw"
    raw.mkdir()
    pd.DataFrame(
        [
            {
                "season": 2024,
                "week": 1,
                "gsis_id": "00-A",
                "espn_id": "1",
                "full_name": "A",
                "position": "QB",
            }
        ]
    ).to_parquet(raw / "rosters.parquet", index=False)
    sj = tmp_path / "sj"
    (sj / "football-main").mkdir(parents=True)
    (sj / "football-main" / "2025.json").write_text(
        json.dumps(
            {
                "league_id": "football-main",
                "sport": "football",
                "season": 2025,
                "teams": [{"roster": [{"id": 99, "name": "Miss", "position": "WR"}]}],
                "players": [],
            }
        ),
        encoding="utf-8",
    )
    (sj / "index.json").write_text(
        json.dumps(
            {
                "leagues": [
                    {
                        "league_id": "football-main",
                        "sport": "football",
                        "season": 2025,
                        "path": "football-main/2025.json",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(cli_mod, "fetch_ff_playerids", lambda: (_ for _ in ()).throw(RuntimeError("offline")))

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "export-player-map",
            "--season",
            "2025",
            "--raw-dir",
            str(raw),
            "--sj-root",
            str(sj),
            "--out-dir",
            str(tmp_path / "out"),
            "--no-ff-playerids",
            "--fail-below",
            "0.9",
        ],
    )
    assert result.exit_code == 1


def test_cli_exposes_export_player_map():
    click_app = typer.main.get_command(app)
    assert "export-player-map" in click_app.commands
    cmd = click_app.commands["export-player-map"]
    names: set[str] = set()
    for param in cmd.params:
        names.update(param.opts)
        names.update(param.secondary_opts)
    assert "--fail-below" in names
    assert "--ff-playerids" in names
