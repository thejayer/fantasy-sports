from pathlib import Path

import pytest

from ffa.league import LeagueConfig, load_league

CONFIG_DIR = Path(__file__).resolve().parents[1] / "configs"


@pytest.fixture
def standard() -> LeagueConfig:
    return load_league(CONFIG_DIR / "standard.yaml")


@pytest.fixture
def ppr() -> LeagueConfig:
    return load_league(CONFIG_DIR / "ppr.yaml")


@pytest.fixture
def half_ppr() -> LeagueConfig:
    return load_league(CONFIG_DIR / "half_ppr.yaml")


@pytest.fixture
def superflex_bonus() -> LeagueConfig:
    return load_league(CONFIG_DIR / "superflex_bonus.yaml")
