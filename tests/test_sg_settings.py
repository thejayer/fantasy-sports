import pytest
from pydantic import ValidationError

from sg.settings import (
    DEFAULT_GOLF_SETTINGS,
    GolfSettings,
    validate_golf_format,
    validate_golf_settings,
    validate_team_count,
)
from sg.snapshot import build_golf_snapshot, golf_settings_from_registry
from sj.registry import LeagueSpec


def test_default_settings_are_playable():
    settings = DEFAULT_GOLF_SETTINGS
    assert settings.roster.starters == 5
    assert settings.roster.bench == 10
    assert settings.missed_cut.mode == "alt1"
    assert settings.scoring.thu_fri_count == 4
    assert settings.multipliers.major == 2.0


def test_bench_and_team_count_bounds():
    with pytest.raises(ValidationError):
        GolfSettings.model_validate({"roster": {"starters": 5, "bench": 1}})
    with pytest.raises(ValueError, match="6–14"):
        validate_team_count(5)
    assert validate_team_count(10) == 10
    assert validate_golf_format("season_points") == "season_points"


def test_build_golf_snapshot_shape():
    snap = build_golf_snapshot(
        league_id="golf-test",
        name="Test Golf",
        season=2026,
        format="h2h",
        team_count=8,
        synced_at="2026-07-27T00:00:00+00:00",
        run_draft=False,
    )
    assert snap["sport"] == "golf"
    assert snap["espn_league_id"] is None
    assert snap["team_count"] == 8
    assert len(snap["teams"]) == 8
    assert snap["players"] == []
    assert snap["settings"]["golf"]["roster"]["bench"] == 10
    assert snap["settings"]["golf"]["missed_cut"]["mode"] == "alt1"


def test_registry_golf_defaults_merge():
    spec = LeagueSpec(
        id="golf-main",
        name="Golf",
        short_name="Golf",
        sport="golf",
        format="h2h",
        platform="hub",
        seasons=[2026],
        current_season=2026,
        team_count=8,
        golf={
            "bench": 12,
            "missed_cut_mode": "alt1_2",
            "draft_style": "auction",
            "keepers": True,
            "multipliers": {"regular": 1.0, "signature": 1.25, "major": 2.5},
        },
    )
    settings = golf_settings_from_registry(spec)
    assert settings.roster.bench == 12
    assert settings.missed_cut.mode == "alt1_2"
    assert settings.draft.style == "auction"
    assert settings.draft.keepers is True
    assert settings.draft.keeper_slots == 2  # default when keepers on + slots 0
    assert settings.draft.budget == 200
    assert settings.multipliers.major == 2.5
    assert validate_golf_settings(None).roster.bench == 10
