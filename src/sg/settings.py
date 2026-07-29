"""Golf league settings (roadmap 6.1) — validated defaults for create + seed."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

GolfFormat = Literal["h2h", "season_points"]
DraftStyle = Literal["snake", "auction"]
MissedCutMode = Literal["off", "alt1", "alt1_2"]
ScheduleSource = Literal["fedex_cup"]
PlayerPointsMode = Literal["neg_to_par"]
ScoringGrain = Literal["end_of_day"]

MIN_TEAMS = 6
MAX_TEAMS = 14
STARTERS = 5
MIN_BENCH = 2
MAX_BENCH = 20
DEFAULT_BENCH = 10


class GolfDraftSettings(BaseModel):
    style: DraftStyle = "snake"
    keepers: bool = False


class GolfRosterSettings(BaseModel):
    starters: int = STARTERS
    bench: int = DEFAULT_BENCH

    @field_validator("starters")
    @classmethod
    def starters_fixed(cls, value: int) -> int:
        if value != STARTERS:
            raise ValueError(f"starters must be {STARTERS} for MVP")
        return value

    @field_validator("bench")
    @classmethod
    def bench_range(cls, value: int) -> int:
        if value < MIN_BENCH or value > MAX_BENCH:
            raise ValueError(f"bench must be {MIN_BENCH}–{MAX_BENCH}")
        return value


class GolfMissedCutSettings(BaseModel):
    mode: MissedCutMode = "alt1"


class GolfScheduleSettings(BaseModel):
    source: ScheduleSource = "fedex_cup"
    include: list[str] = Field(default_factory=list)
    exclude: list[str] = Field(default_factory=list)


class GolfMultipliers(BaseModel):
    regular: float = 1.0
    signature: float = 1.5
    major: float = 2.0

    @field_validator("regular", "signature", "major")
    @classmethod
    def positive_multiplier(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("multipliers must be > 0")
        return value


class GolfScoringSettings(BaseModel):
    grain: ScoringGrain = "end_of_day"
    player_points: PlayerPointsMode = "neg_to_par"
    thu_fri_count: int = 4
    sat_sun_count: int = 5

    @model_validator(mode="after")
    def counting_rules(self) -> GolfScoringSettings:
        if self.thu_fri_count != 4:
            raise ValueError("thu_fri_count must be 4 for MVP")
        if self.sat_sun_count != 5:
            raise ValueError("sat_sun_count must be 5 for MVP")
        return self


class GolfSettings(BaseModel):
    """Persisted under snapshot ``settings.golf`` (roadmap 6.1)."""

    draft: GolfDraftSettings = Field(default_factory=GolfDraftSettings)
    roster: GolfRosterSettings = Field(default_factory=GolfRosterSettings)
    captain_tiebreaker: bool = True
    missed_cut: GolfMissedCutSettings = Field(default_factory=GolfMissedCutSettings)
    schedule: GolfScheduleSettings = Field(default_factory=GolfScheduleSettings)
    multipliers: GolfMultipliers = Field(default_factory=GolfMultipliers)
    scoring: GolfScoringSettings = Field(default_factory=GolfScoringSettings)


DEFAULT_GOLF_SETTINGS = GolfSettings()


def validate_golf_settings(raw: dict[str, Any] | GolfSettings | None) -> GolfSettings:
    if raw is None:
        return DEFAULT_GOLF_SETTINGS.model_copy(deep=True)
    if isinstance(raw, GolfSettings):
        return raw
    return GolfSettings.model_validate(raw)


def validate_team_count(team_count: int) -> int:
    if team_count < MIN_TEAMS or team_count > MAX_TEAMS:
        raise ValueError(f"team_count must be {MIN_TEAMS}–{MAX_TEAMS}")
    return team_count


def validate_golf_format(fmt: str) -> GolfFormat:
    if fmt not in ("h2h", "season_points"):
        raise ValueError("golf format must be h2h or season_points")
    return fmt  # type: ignore[return-value]
