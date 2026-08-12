import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from sj.cli import app
from sj.registry import load_registry
from sj.sample import (
    MARKER_NAME,
    sample_league,
    sample_snapshot,
    seed_store,
)
from sj.serialize import serialize_league
from sj.store import read_snapshot

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "sj"


@pytest.fixture(scope="module")
def registry():
    return load_registry()


def spec_for(registry, league_id: str):
    return registry.by_id(league_id)


def test_seeding_is_deterministic(registry):
    spec = spec_for(registry, "football-main")
    first = sample_snapshot(spec, 2023, teams=4)
    second = sample_snapshot(spec, 2023, teams=4)
    assert first == second


def test_distinct_seasons_differ(registry):
    spec = spec_for(registry, "football-main")
    assert sample_snapshot(spec, 2023, teams=4) != sample_snapshot(spec, 2024, teams=4)


def test_snapshot_matches_serializer_schema(registry):
    """Seeded output must carry exactly the keys the real serializer emits.

    ``sample_snapshot`` routes through ``build_snapshot``, so this asserts the
    contract rather than a hand-maintained copy of it: if ``serialize_league``
    gains or loses a field, seeded data follows automatically.
    """
    spec = spec_for(registry, "football-main")
    seeded = sample_snapshot(spec, 2024, teams=4)
    reference = serialize_league(
        sample_league(spec, 2024, teams=4),
        league_id=spec.id,
        sport=spec.sport,
        format=spec.format,
        season=2024,
        espn_league_id=spec.espn_league_id,
    )
    # build_snapshot adds the registry-sourced short_name on top of the serializer.
    assert set(seeded) == set(reference) | {"short_name"}
    assert seeded["name"] == spec.name
    assert seeded["short_name"] == spec.short_name


@pytest.mark.parametrize("league_id", ["football-main", "football-dynasty", "baseball-dynasty"])
def test_seeded_snapshot_shares_schema_with_committed_fixtures(
    registry, league_id, tmp_path: Path
):
    """Seed (v2) and committed fixtures (v1) expose the same snapshot keys.

    Fixtures are regenerated from the serializer (roadmap 2.5); this pins that
    ``sj seed`` cannot ship a narrower schema than the fallback the hub bakes in.
    Exact fixture equality lives in ``tests/test_sj_fixtures.py``.
    """
    fixture_path = next(iter((FIXTURES / league_id).glob("*.json")), None)
    assert fixture_path is not None, f"no committed fixture for {league_id}"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))

    spec = spec_for(registry, league_id)
    seed_store(
        league_ids=[league_id], current_only=True, teams=4, store_dir=tmp_path
    )
    written = tmp_path / league_id / str(spec.current_season) / "manifest.json"
    assert written.exists()
    seeded = read_snapshot(league_id, spec.current_season, store_dir=tmp_path)

    # synced_at / schema_version differ by writer; everything else must match.
    ignore = {"synced_at", "schema_version"}
    assert set(fixture) - ignore == set(seeded) - ignore
    assert set(fixture["teams"][0]) == set(seeded["teams"][0])
    assert set(fixture["teams"][0]["roster"][0]) == set(seeded["teams"][0]["roster"][0])


def test_team_and_roster_counts(registry):
    spec = spec_for(registry, "football-main")
    snapshot = sample_snapshot(spec, 2024, teams=10)
    assert snapshot["team_count"] == 10
    assert len(snapshot["teams"]) == 10
    # 10 starters + 6 bench for a redraft football league.
    assert all(len(team["roster"]) == 16 for team in snapshot["teams"])
    assert len({team["name"] for team in snapshot["teams"]}) == 10
    assert len({team["team_id"] for team in snapshot["teams"]}) == 10


def test_dynasty_rosters_are_deeper_than_redraft(registry):
    redraft = sample_snapshot(spec_for(registry, "football-main"), 2024, teams=4)
    dynasty = sample_snapshot(spec_for(registry, "football-dynasty"), 2024, teams=4)
    assert len(dynasty["teams"][0]["roster"]) > len(redraft["teams"][0]["roster"])


def test_standings_are_ranked_and_ordered(registry):
    snapshot = sample_snapshot(spec_for(registry, "football-main"), 2022, teams=12)
    standings = [team["standing"] for team in snapshot["teams"]]
    assert standings == list(range(1, 13))


def test_players_are_deduped_and_sorted_by_points(registry):
    snapshot = sample_snapshot(spec_for(registry, "football-main"), 2024, teams=8)
    players = snapshot["players"]
    assert len(players) == 8 * 16
    assert len({p["id"] for p in players}) == len(players)
    points = [p["total_points"] or 0 for p in players]
    assert points == sorted(points, reverse=True)
    assert all(p["fantasy_team"] for p in players)


def test_football_omits_baseball_only_fields(registry):
    snapshot = sample_snapshot(spec_for(registry, "football-main"), 2024, teams=4)
    player = snapshot["teams"][0]["roster"][0]
    assert "season_stats" not in player
    assert "role" not in player
    assert snapshot["period_label"] == "week"


def test_seeded_snapshots_persist_draft_and_matchups(registry):
    """Roadmap 2.1: seed must exercise the free draft/matchup fields."""
    snapshot = sample_snapshot(spec_for(registry, "football-main"), 2024, teams=4)
    assert len(snapshot["draft"]) == 4 * 3  # 3 snake rounds
    assert {pick["round"] for pick in snapshot["draft"]} == {1, 2, 3}
    assert all(pick["team_id"] in {1, 2, 3, 4} for pick in snapshot["draft"])
    assert all(pick["player_id"] for pick in snapshot["draft"])

    for team in snapshot["teams"]:
        assert len(team["schedule"]) == snapshot["current_week"]
        assert len(team["scores"]) == len(team["schedule"])
        assert len(team["outcomes"]) == len(team["schedule"])
        assert set(team["outcomes"]) <= {"W", "L", "T", "U"}
        assert all(isinstance(opp, int) for opp in team["schedule"])


def test_football_record_matches_schedule_outcomes(registry):
    """Wins/losses/PF must follow the matchup tape, not the pre-matchup RNG."""
    snapshot = sample_snapshot(spec_for(registry, "football-main"), 2024, teams=4)
    for team in snapshot["teams"]:
        wins = losses = ties = 0
        points = 0.0
        for i, outcome in enumerate(team["outcomes"]):
            opp = team["schedule"][i]
            if opp == team["team_id"]:
                continue
            if outcome == "W":
                wins += 1
            elif outcome == "L":
                losses += 1
            elif outcome == "T":
                ties += 1
            if team["scores"][i] is not None:
                points += float(team["scores"][i])
        assert team["wins"] == wins
        assert team["losses"] == losses
        assert team["ties"] == ties
        assert team["points_for"] == pytest.approx(round(points, 1))


def test_seeded_snapshots_persist_settings_and_transactions(registry):
    """Roadmap 2.4: seed must exercise settings + recent_activity + free_agents."""
    redraft = sample_snapshot(spec_for(registry, "football-main"), 2024, teams=4)
    dynasty = sample_snapshot(spec_for(registry, "football-dynasty"), 2024, teams=4)
    assert redraft["settings"]["keeper_count"] == 0
    assert dynasty["settings"]["keeper_count"] == 5
    # Dynasty samples mark round-1 picks as keepers for roster badges (7.9b).
    assert all(not pick["keeper"] for pick in redraft["draft"])
    assert {pick["round"] for pick in dynasty["draft"] if pick["keeper"]} == {1}
    assert sum(1 for pick in dynasty["draft"] if pick["keeper"]) == 4
    # Football fixtures invent a finished final ladder (seed #1 ≠ playoff champ).
    assert all(t.get("final_standing") for t in redraft["teams"])
    seed_one = next(t for t in redraft["teams"] if t["standing"] == 1)
    title = next(t for t in redraft["teams"] if t["final_standing"] == 1)
    assert seed_one["team_id"] != title["team_id"]
    assert redraft["settings"]["faab"] is True
    assert redraft["settings"]["position_slot_counts"]["QB"] == 1
    assert len(redraft["transactions"]) >= 1
    assert redraft["transactions"][0]["actions"][0]["action"]
    assert len(redraft["free_agents"]) >= 1
    assert redraft["free_agents"][0]["slot"] == "FA"
    roster_ids = {p["id"] for t in redraft["teams"] for p in t["roster"]}
    assert redraft["free_agents"][0]["id"] not in roster_ids
    # Activity / FA endpoints do not exist before 2019.
    ancient = sample_snapshot(spec_for(registry, "football-main"), 2018, teams=4)
    assert ancient["transactions"] == []
    assert ancient["free_agents"] == []
    assert ancient["settings"]["keeper_count"] == 0


def test_baseball_carries_season_stats_and_roles(registry):
    snapshot = sample_snapshot(spec_for(registry, "baseball-dynasty"), 2026, teams=4)
    assert snapshot["period_label"] == "period"

    roster = snapshot["teams"][0]["roster"]
    assert {p["role"] for p in roster} == {"batter", "pitcher"}

    pitcher = next(p for p in roster if p["role"] == "pitcher")
    batter = next(p for p in roster if p["role"] == "batter")
    # IP is derived by the serializer from OUTS, never supplied directly.
    assert pitcher["season_stats"]["IP"] == round(pitcher["season_stats"]["OUTS"] / 3.0, 1)
    assert {"ERA", "WHIP", "K"} <= set(pitcher["season_stats"])
    assert {"AVG", "HR", "RBI"} <= set(batter["season_stats"])


def test_baseball_season_points_uses_official_points_for(registry):
    """Season Points standings use team PF, not a roster sum of player totals."""
    snapshot = sample_snapshot(spec_for(registry, "baseball-dynasty"), 2026, teams=4)
    assert snapshot["scoring_type"] == "TOTAL_SEASON_POINTS"
    team = snapshot["teams"][0]
    assert team["points_for"] is not None
    roster_sum = round(sum(p["total_points"] for p in team["roster"]), 1)
    assert team["points_for"] != pytest.approx(roster_sum)
    assert team["points_against"] is None
    assert team["wins"] == 0 and team["losses"] == 0
    # Standings ordered by PF.
    points = [t["points_for"] for t in snapshot["teams"]]
    assert points == sorted(points, reverse=True)
    weights = snapshot["settings"]["scoring_format"]
    assert any(row.get("abbr") == "HR" or row.get("id") == 5 for row in weights)
    assert any(row.get("points") == 5.0 for row in weights)


def test_win_pct_is_consistent_with_record(registry):
    snapshot = sample_snapshot(spec_for(registry, "football-main"), 2021, teams=6)
    for team in snapshot["teams"]:
        games = team["wins"] + team["losses"] + team["ties"]
        assert team["win_pct"] == pytest.approx(round(team["wins"] / games, 3))


def test_rejects_too_few_teams(registry):
    with pytest.raises(ValueError):
        sample_league(spec_for(registry, "football-main"), 2024, teams=1)


def test_seed_store_writes_index_and_marker(tmp_path: Path):
    written = seed_store(
        league_ids=["football-main"],
        seasons=[2024, 2025],
        teams=4,
        store_dir=tmp_path,
    )
    assert len(written) == 2
    assert (tmp_path / MARKER_NAME).exists()

    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
    seasons = sorted(item["season"] for item in index["leagues"])
    assert seasons == [2024, 2025]
    assert all(item["league_id"] == "football-main" for item in index["leagues"])
    assert all(item["synced_at"] for item in index["leagues"])


def test_seed_store_current_only(tmp_path: Path):
    written = seed_store(current_only=True, teams=4, store_dir=tmp_path)
    registry = load_registry()
    assert len(written) == len(registry.leagues)
    assert {season for _, season, _ in written} == {
        lg.current_season for lg in registry.leagues
    }


def test_seed_store_rejects_unknown_league(tmp_path: Path):
    with pytest.raises(KeyError):
        seed_store(league_ids=["nope"], store_dir=tmp_path)


def test_seed_store_refuses_to_clobber_unmarked_snapshots(tmp_path: Path):
    real = tmp_path / "football-main"
    real.mkdir()
    (real / "2025.json").write_text("{}", encoding="utf-8")

    with pytest.raises(RuntimeError, match="may be real league data"):
        seed_store(league_ids=["football-main"], seasons=[2025], store_dir=tmp_path)

    # --force overrides, and a seeded store is re-seedable without it.
    seed_store(league_ids=["football-main"], seasons=[2025], teams=4, store_dir=tmp_path, force=True)
    seed_store(league_ids=["football-main"], seasons=[2025], teams=4, store_dir=tmp_path)


def test_seed_store_ignores_gcs_bucket(tmp_path: Path, monkeypatch):
    """Synthetic data must never be able to reach the production bucket."""
    monkeypatch.setenv("SJ_GCS_BUCKET", "should-never-be-written")
    seed_store(league_ids=["football-main"], seasons=[2025], teams=4, store_dir=tmp_path)
    assert (tmp_path / "football-main" / "2025" / "manifest.json").exists()


def test_cli_seed_command(tmp_path: Path):
    result = CliRunner().invoke(
        app,
        [
            "seed",
            "--league", "football-main",
            "--season", "2025",
            "--teams", "4",
            "--store-dir", str(tmp_path),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "seeded football-main 2025" in result.output
    assert "seeded 1 league-seasons" in result.output
    assert (tmp_path / "football-main" / "2025" / "manifest.json").exists()


def test_cli_seed_reports_refused_overwrite_cleanly(tmp_path: Path):
    """A refused overwrite should read as an error message, not a traceback."""
    real = tmp_path / "football-main"
    real.mkdir()
    (real / "2025.json").write_text("{}", encoding="utf-8")

    result = CliRunner().invoke(app, ["seed", "--store-dir", str(tmp_path)])
    assert result.exit_code == 1
    assert "may be real league data" in result.output
    assert "Traceback" not in result.output


def test_cli_seed_reports_unknown_league_cleanly(tmp_path: Path):
    result = CliRunner().invoke(
        app, ["seed", "--league", "nope", "--store-dir", str(tmp_path)]
    )
    assert result.exit_code == 1
    assert "nope" in result.output
    assert "Traceback" not in result.output


def test_cli_status_reads_seeded_store(tmp_path: Path):
    seed_store(league_ids=["baseball-dynasty"], current_only=True, teams=4, store_dir=tmp_path)
    result = CliRunner().invoke(app, ["status", "--store-dir", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert "baseball-dynasty" in result.output
