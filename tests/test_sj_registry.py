from pathlib import Path

import pytest

from sj.registry import load_registry

ROOT = Path(__file__).resolve().parents[1]


def test_load_default_registry():
    registry = load_registry(ROOT / "configs" / "leagues.yaml")
    ids = {lg.id for lg in registry.leagues}
    assert ids == {"baseball-dynasty", "football-main", "football-dynasty"}


def test_registry_espn_ids_and_formats():
    registry = load_registry(ROOT / "configs" / "leagues.yaml")
    baseball = registry.by_id("baseball-dynasty")
    assert baseball.espn_league_id == 2499137
    assert baseball.format == "dynasty"
    assert baseball.sport == "baseball"
    assert baseball.seasons == [2024, 2025, 2026]

    main = registry.by_id("football-main")
    assert main.espn_league_id == 39790
    assert main.format == "redraft"
    assert 2015 in main.seasons
    assert 2026 in main.seasons

    dynasty = registry.by_id("football-dynasty")
    assert dynasty.espn_league_id == 94266
    assert dynasty.format == "dynasty"
    assert dynasty.seasons[0] == 2018


def test_unknown_league_raises():
    registry = load_registry(ROOT / "configs" / "leagues.yaml")
    with pytest.raises(KeyError):
        registry.by_id("nope")
