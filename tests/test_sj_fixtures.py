"""Committed fixture regeneration / validation (roadmap 2.5)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from sj.cli import app
from sj.fixtures import (
    FIXED_TIMESTAMP,
    expected_fixture_snapshot,
    fixture_team_count,
    regenerate_fixtures,
    validate_fixtures,
)
from sj.registry import load_registry
from sj.store import FIXTURES_DIR, read_snapshot

ROOT = Path(__file__).resolve().parents[1]


def test_committed_fixtures_match_serializer():
    """CI gate: fixtures/sj must equal `sj regenerate-fixtures` output."""
    assert validate_fixtures() == []


def test_regenerate_fixtures_is_idempotent(tmp_path: Path):
    regenerate_fixtures(fixtures_dir=tmp_path)
    first = {
        path.relative_to(tmp_path): path.read_text(encoding="utf-8")
        for path in sorted(tmp_path.rglob("*.json"))
    }
    regenerate_fixtures(fixtures_dir=tmp_path)
    second = {
        path.relative_to(tmp_path): path.read_text(encoding="utf-8")
        for path in sorted(tmp_path.rglob("*.json"))
    }
    assert first == second
    assert validate_fixtures(fixtures_dir=tmp_path) == []


def test_validate_fixtures_detects_drift(tmp_path: Path):
    regenerate_fixtures(fixtures_dir=tmp_path)
    target = next(tmp_path.glob("*/*.json"))
    payload = json.loads(target.read_text(encoding="utf-8"))
    del payload["settings"]
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    errors = validate_fixtures(fixtures_dir=tmp_path)
    assert errors
    assert any("does not match serializer" in error for error in errors)


def test_regenerate_removes_stale_seasons(tmp_path: Path):
    regenerate_fixtures(fixtures_dir=tmp_path)
    stale = tmp_path / "football-main" / "2015.json"
    stale.write_text("{}", encoding="utf-8")
    regenerate_fixtures(fixtures_dir=tmp_path)
    assert not stale.exists()
    assert (tmp_path / "football-main" / "2026.json").exists()


def test_playoff_odds_fixtures_match_engine():
    """Committed playoff_odds fixtures must equal simulate_playoff_odds output."""
    from ffa.playoff_export import load_playoff_odds_snapshot, simulate_playoff_odds

    for lid in ("football-main", "football-dynasty"):
        league = json.loads((FIXTURES_DIR / lid / "2026.json").read_text(encoding="utf-8"))
        fixture = load_playoff_odds_snapshot(
            FIXTURES_DIR / "playoff_odds" / lid / "2026.json"
        )
        sim = simulate_playoff_odds(league, {}, {}, n_sims=int(fixture["n_sims"]), seed=0)
        by_fix = {t["team_id"]: t for t in fixture["teams"]}
        for row in sim["teams"]:
            got = by_fix[row["team_id"]]
            assert got["make_playoffs"] == pytest.approx(row["make_playoffs"])
            assert got["seed_probs"] == row["seed_probs"]
        assert fixture["periods_simulated"] == sim["periods_simulated"]


def test_expected_fixture_snapshot_is_schema_complete():
    registry = load_registry()
    for spec in registry.leagues:
        snap = expected_fixture_snapshot(spec)
        assert snap["season"] == spec.current_season
        assert snap["team_count"] == fixture_team_count(spec)
        assert snap["synced_at"] == FIXED_TIMESTAMP
        assert "settings" in snap and "transactions" in snap and "draft" in snap
        assert "free_agents" in snap
        assert "scoring_type" in snap and "period_label" in snap
        team = snap["teams"][0]
        assert {"schedule", "scores", "outcomes", "win_pct", "logo_url"} <= set(team)
        player = team["roster"][0]
        assert {
            "status",
            "injured",
            "eligible_slots",
            "acquisition_type",
            "percent_owned",
        } <= set(player)


def test_committed_fixtures_readable_as_v1_monolith():
    snap = read_snapshot("football-main", 2026, store_dir=FIXTURES_DIR)
    assert snap["espn_league_id"] == 39790
    assert snap["season"] == 2026
    assert "settings" in snap
    assert (ROOT / "fixtures" / "sj" / "football-main" / "2026.json").exists()
    assert not (ROOT / "fixtures" / "sj" / "football-main" / "2025.json").exists()


@pytest.mark.parametrize(
    ("command", "needle"),
    [
        (["regenerate-fixtures", "--fixtures-dir"], "regenerated 3"),
        (["validate-fixtures", "--fixtures-dir"], "fixtures ok"),
    ],
)
def test_cli_fixture_commands(tmp_path: Path, command, needle):
    if command[0] == "validate-fixtures":
        regenerate_fixtures(fixtures_dir=tmp_path)
    result = CliRunner().invoke(app, [*command, str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert needle in result.output
