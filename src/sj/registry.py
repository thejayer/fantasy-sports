"""Load the Strictly Jayers league registry from YAML."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, PositiveInt

Sport = Literal["football", "baseball", "basketball"]
Format = Literal["redraft", "dynasty"]
Platform = Literal["espn"]

DEFAULT_REGISTRY = Path(__file__).resolve().parents[2] / "configs" / "leagues.yaml"


class LeagueSpec(BaseModel):
    """One Strictly Jayers league entry."""

    id: str
    name: str
    short_name: str
    sport: Sport
    format: Format
    platform: Platform = "espn"
    espn_league_id: PositiveInt
    seasons: list[PositiveInt] = Field(min_length=1)
    current_season: PositiveInt
    espn_url: str | None = None

    def validate_seasons(self) -> None:
        if self.current_season not in self.seasons:
            raise ValueError(
                f"{self.id}: current_season {self.current_season} not in seasons {self.seasons}"
            )


class Registry(BaseModel):
    leagues: list[LeagueSpec] = Field(min_length=1)

    def by_id(self, league_id: str) -> LeagueSpec:
        for league in self.leagues:
            if league.id == league_id:
                return league
        raise KeyError(league_id)


def load_registry(path: Path | str | None = None) -> Registry:
    """Load and validate ``configs/leagues.yaml``."""
    registry_path = Path(path) if path is not None else DEFAULT_REGISTRY
    with registry_path.open(encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    registry = Registry.model_validate(raw)
    for league in registry.leagues:
        league.validate_seasons()
    return registry
