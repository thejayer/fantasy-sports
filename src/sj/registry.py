"""Load the Strictly Jayers league registry from YAML."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, PositiveInt, model_validator

Sport = Literal["football", "baseball", "basketball", "golf"]
Format = Literal["redraft", "dynasty", "h2h", "season_points"]
Platform = Literal["espn", "hub"]

DEFAULT_REGISTRY = Path(__file__).resolve().parents[2] / "configs" / "leagues.yaml"


class GolfRegistryDefaults(BaseModel):
    """Optional golf knobs on a registry row (seed/fixtures); full settings in snapshot."""

    bench: int = 10
    missed_cut_mode: Literal["off", "alt1", "alt1_2"] = "alt1"
    draft_style: Literal["snake", "auction"] = "snake"
    keepers: bool = False
    keeper_slots: int = 0
    budget: int = 200
    multipliers: dict[str, float] = Field(
        default_factory=lambda: {"regular": 1.0, "signature": 1.5, "major": 2.0}
    )


class LeagueSpec(BaseModel):
    """One Strictly Jayers league entry."""

    id: str
    name: str
    short_name: str
    sport: Sport
    format: Format
    platform: Platform = "espn"
    espn_league_id: PositiveInt | None = None
    seasons: list[PositiveInt] = Field(min_length=1)
    current_season: PositiveInt
    espn_url: str | None = None
    # Golf create/seed default team count (ESPN leagues ignore this).
    team_count: PositiveInt | None = None
    golf: GolfRegistryDefaults | None = None

    def validate_seasons(self) -> None:
        if self.current_season not in self.seasons:
            raise ValueError(
                f"{self.id}: current_season {self.current_season} not in seasons {self.seasons}"
            )

    @model_validator(mode="after")
    def validate_platform_and_format(self) -> LeagueSpec:
        if self.platform == "espn" and self.espn_league_id is None:
            raise ValueError(f"{self.id}: espn_league_id is required when platform is espn")
        if self.sport == "golf":
            if self.platform != "hub":
                raise ValueError(f"{self.id}: golf leagues require platform hub")
            if self.format not in ("h2h", "season_points"):
                raise ValueError(f"{self.id}: golf format must be h2h or season_points")
            if self.espn_league_id is not None:
                raise ValueError(f"{self.id}: golf leagues must not set espn_league_id")
        elif self.format not in ("redraft", "dynasty"):
            raise ValueError(
                f"{self.id}: ESPN sports use format redraft or dynasty (got {self.format})"
            )
        return self

    def is_espn(self) -> bool:
        return self.platform == "espn"


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
        raw: dict[str, Any] = yaml.safe_load(fh) or {}
    registry = Registry.model_validate(raw)
    for league in registry.leagues:
        league.validate_seasons()
    return registry
