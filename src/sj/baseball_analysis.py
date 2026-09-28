"""Season-points baseball analysis (roadmap 8.5).

Thin baseball binding over :mod:`sj.season_points_analysis`. Hub and tests
keep importing this module; hockey uses the same walk with ``HOCKEY_PROFILE``.
"""

from __future__ import annotations

from functools import partial
from typing import Any

from sj.season_points_analysis import (
    ANALYSIS_METHOD,
    ANALYSIS_SCHEMA_VERSION,
    BASEBALL_PROFILE,
    STAT_SOURCE_ACTUAL,
    STAT_SPLIT_DAILY,
    analysis_periods,
    daily_applied_total,
    dates_from_pro_schedule,
    existing_period_slots,
    extract_espn_team_points,
    extract_points_by_scoring_period,
    extract_team_names,
    fetch_mroster_period,
    fetch_mteam,
    round_points,
    sample_analysis_for_snapshot,
    serialize_period_slots,
    sync_season_points_analysis,
)
from sj.season_points_analysis import (
    add_slot_maps as _add_slot_maps,
)
from sj.season_points_analysis import (
    build_slot_points_document as _build_slot_points_document,
)
from sj.season_points_analysis import (
    build_team_slot_rows as _build_team_slot_rows,
)
from sj.season_points_analysis import (
    build_timeseries_document as _build_timeseries_document,
)
from sj.season_points_analysis import (
    build_timeseries_teams as _build_timeseries_teams,
)
from sj.season_points_analysis import (
    empty_slot_totals as _empty_slot_totals,
)
from sj.season_points_analysis import (
    opening_day as _opening_day,
)
from sj.season_points_analysis import (
    parse_mroster_period as _parse_mroster_period,
)
from sj.season_points_analysis import (
    period_date as _period_date,
)
from sj.season_points_analysis import (
    slot_name_from_id as _slot_name_from_id,
)
from sj.season_points_analysis import (
    slot_row_totals as _slot_row_totals,
)

SLOT_COLUMNS = BASEBALL_PROFILE.slot_columns
BAT_SLOTS = BASEBALL_PROFILE.groups["bats"]
PITCH_SLOTS = BASEBALL_PROFILE.groups["pitchers"]
BENCH_SLOTS = BASEBALL_PROFILE.bench_slots
STARTER_SLOTS = BASEBALL_PROFILE.starter_slots
SLOT_COLLAPSE = BASEBALL_PROFILE.slot_collapse

slot_name_from_id = partial(_slot_name_from_id, profile=BASEBALL_PROFILE)
empty_slot_totals = partial(_empty_slot_totals, profile=BASEBALL_PROFILE)
opening_day = partial(_opening_day, profile=BASEBALL_PROFILE)


def slot_row_totals(slots: dict[str, float]) -> dict[str, float]:
    return _slot_row_totals(slots, BASEBALL_PROFILE)


def parse_mroster_period(payload: dict[str, Any], period: int) -> dict[int, dict[str, float]]:
    return _parse_mroster_period(payload, period, BASEBALL_PROFILE)


def add_slot_maps(
    left: dict[int, dict[str, float]],
    right: dict[int, dict[str, float]],
) -> dict[int, dict[str, float]]:
    return _add_slot_maps(left, right, BASEBALL_PROFILE)


def period_date(
    season: int,
    period: int,
    schedule_dates: dict[int, str] | None = None,
) -> str:
    return _period_date(season, period, schedule_dates, BASEBALL_PROFILE)


def build_team_slot_rows(
    totals: dict[int, dict[str, float]],
    *,
    names: dict[int, str],
    espn_points: dict[int, float],
) -> list[dict[str, Any]]:
    return _build_team_slot_rows(
        totals, names=names, espn_points=espn_points, profile=BASEBALL_PROFILE
    )


def build_timeseries_teams(
    period_slots: dict[int, dict[int, dict[str, float]]],
    *,
    names: dict[int, str],
    season: int,
    schedule_dates: dict[int, str] | None = None,
    espn_daily: dict[int, dict[int, float]] | None = None,
) -> list[dict[str, Any]]:
    return _build_timeseries_teams(
        period_slots,
        names=names,
        season=season,
        schedule_dates=schedule_dates,
        espn_daily=espn_daily,
        profile=BASEBALL_PROFILE,
    )


def build_slot_points_document(**kwargs: Any) -> dict[str, Any]:
    kwargs.setdefault("profile", BASEBALL_PROFILE)
    return _build_slot_points_document(**kwargs)


def build_timeseries_document(**kwargs: Any) -> dict[str, Any]:
    kwargs.setdefault("profile", BASEBALL_PROFILE)
    return _build_timeseries_document(**kwargs)


def sync_baseball_analysis(
    league: Any,
    spec: Any,
    season: int,
    snapshot: dict[str, Any],
    store_dir: Any = None,
    **kwargs: Any,
) -> int:
    if getattr(spec, "sport", None) not in (None, "baseball"):
        return 0
    return sync_season_points_analysis(
        league,
        spec,
        season,
        snapshot,
        store_dir,
        profile=BASEBALL_PROFILE,
        **kwargs,
    )


def sample_baseball_analysis_for_snapshot(
    snapshot: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    return sample_analysis_for_snapshot(snapshot, BASEBALL_PROFILE)


__all__ = [
    "ANALYSIS_METHOD",
    "ANALYSIS_SCHEMA_VERSION",
    "BAT_SLOTS",
    "BENCH_SLOTS",
    "PITCH_SLOTS",
    "SLOT_COLLAPSE",
    "SLOT_COLUMNS",
    "STARTER_SLOTS",
    "STAT_SOURCE_ACTUAL",
    "STAT_SPLIT_DAILY",
    "add_slot_maps",
    "analysis_periods",
    "build_slot_points_document",
    "build_team_slot_rows",
    "build_timeseries_document",
    "build_timeseries_teams",
    "daily_applied_total",
    "dates_from_pro_schedule",
    "empty_slot_totals",
    "existing_period_slots",
    "extract_espn_team_points",
    "extract_points_by_scoring_period",
    "extract_team_names",
    "fetch_mroster_period",
    "fetch_mteam",
    "opening_day",
    "parse_mroster_period",
    "period_date",
    "round_points",
    "sample_baseball_analysis_for_snapshot",
    "serialize_period_slots",
    "slot_name_from_id",
    "slot_row_totals",
    "sync_baseball_analysis",
]
