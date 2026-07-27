"""Pull ESPN fantasy leagues into the Strictly Jayers snapshot store."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sj.registry import LeagueSpec, load_registry
from sj.serialize import serialize_league
from sj.store import write_snapshot


@dataclass
class SyncResult:
    league_id: str
    season: int
    location: str
    team_count: int


@dataclass
class SyncFailure:
    league_id: str
    season: int
    error: str


def espn_credentials() -> tuple[str | None, str | None]:
    """Read private-league cookies from the environment."""
    espn_s2 = os.environ.get("ESPN_S2") or os.environ.get("ESPN_S2_COOKIE")
    swid = os.environ.get("ESPN_SWID") or os.environ.get("SWID")
    return espn_s2, swid


def open_espn_league(spec: LeagueSpec, season: int) -> Any:
    espn_s2, swid = espn_credentials()
    if not espn_s2 or not swid:
        raise RuntimeError(
            "ESPN_S2 and ESPN_SWID (or SWID) env vars are required for private leagues"
        )

    if spec.sport == "football":
        from espn_api.football import League
    elif spec.sport == "baseball":
        from espn_api.baseball import League
    elif spec.sport == "basketball":
        from espn_api.basketball import League
    else:  # pragma: no cover - registry validates sport
        raise ValueError(f"Unsupported sport: {spec.sport}")

    return League(
        league_id=spec.espn_league_id,
        year=season,
        espn_s2=espn_s2,
        swid=swid,
    )


def build_snapshot(league: Any, spec: LeagueSpec, season: int) -> dict[str, Any]:
    """Serialize an espn-api league object into a store-ready snapshot.

    Split out from :func:`sync_league_season` so anything producing a
    league-shaped object -- the live ESPN client, or ``sj.sample`` -- goes
    through one definition of the snapshot schema.
    """
    snapshot = serialize_league(
        league,
        league_id=spec.id,
        sport=spec.sport,
        format=spec.format,
        season=season,
        espn_league_id=spec.espn_league_id,
    )
    # Prefer the friendly registry name over ESPN's raw settings name.
    snapshot["name"] = spec.name
    snapshot["short_name"] = spec.short_name
    return snapshot


def sync_league_season(
    spec: LeagueSpec,
    season: int,
    store_dir: Path | str | None = None,
) -> SyncResult:
    league = open_espn_league(spec, season)
    snapshot = build_snapshot(league, spec, season)
    location = write_snapshot(snapshot, store_dir=store_dir)
    return SyncResult(
        league_id=spec.id,
        season=season,
        location=location,
        team_count=snapshot["team_count"],
    )


def sync_registry(
    *,
    league_ids: list[str] | None = None,
    seasons: list[int] | None = None,
    current_only: bool = False,
    registry_path: Path | str | None = None,
    store_dir: Path | str | None = None,
    throttle_seconds: float = 0.0,
    on_event: Any = None,
) -> tuple[list[SyncResult], list[SyncFailure]]:
    """Sync selected leagues/seasons, tolerating per-season gaps.

    Returns successes and failures separately so a backfill can report which
    league-years ESPN refused without aborting the whole run.
    """
    registry = load_registry(registry_path)
    selected = registry.leagues
    if league_ids:
        wanted = set(league_ids)
        selected = [lg for lg in selected if lg.id in wanted]
        missing = wanted - {lg.id for lg in selected}
        if missing:
            raise KeyError(f"Unknown league id(s): {sorted(missing)}")

    def emit(message: str) -> None:
        if on_event is not None:
            on_event(message)

    results: list[SyncResult] = []
    failures: list[SyncFailure] = []
    for spec in selected:
        target_seasons = [spec.current_season] if current_only else list(spec.seasons)
        if seasons is not None:
            target_seasons = [s for s in target_seasons if s in seasons]
        for season in target_seasons:
            try:
                result = sync_league_season(spec, season, store_dir=store_dir)
            except Exception as exc:  # noqa: BLE001 - surface ESPN/season gaps per league-year
                failures.append(SyncFailure(spec.id, season, str(exc)))
                emit(f"skipped {spec.id} {season}: {exc}")
            else:
                results.append(result)
                emit(f"synced {spec.id} {season} ({result.team_count} teams)")
            if throttle_seconds:
                time.sleep(throttle_seconds)

    if failures and not results:
        detail = "\n".join(f"{f.league_id} {f.season}: {f.error}" for f in failures)
        raise RuntimeError("All sync attempts failed:\n" + detail)
    return results, failures
