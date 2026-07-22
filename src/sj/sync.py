"""Pull ESPN fantasy leagues into the local Strictly Jayers store."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sj.registry import LeagueSpec, load_registry
from sj.serialize import serialize_league
from sj.store import DEFAULT_STORE_DIR, write_snapshot


@dataclass
class SyncResult:
    league_id: str
    season: int
    path: Path
    team_count: int


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


def sync_league_season(
    spec: LeagueSpec,
    season: int,
    store_dir: Path | str = DEFAULT_STORE_DIR,
) -> SyncResult:
    league = open_espn_league(spec, season)
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
    path = write_snapshot(snapshot, store_dir=store_dir)
    return SyncResult(
        league_id=spec.id,
        season=season,
        path=path,
        team_count=snapshot["team_count"],
    )


def sync_registry(
    *,
    league_ids: list[str] | None = None,
    seasons: list[int] | None = None,
    current_only: bool = False,
    registry_path: Path | str | None = None,
    store_dir: Path | str = DEFAULT_STORE_DIR,
) -> list[SyncResult]:
    registry = load_registry(registry_path)
    selected = registry.leagues
    if league_ids:
        wanted = set(league_ids)
        selected = [lg for lg in selected if lg.id in wanted]
        missing = wanted - {lg.id for lg in selected}
        if missing:
            raise KeyError(f"Unknown league id(s): {sorted(missing)}")

    results: list[SyncResult] = []
    errors: list[str] = []
    for spec in selected:
        target_seasons = [spec.current_season] if current_only else list(spec.seasons)
        if seasons is not None:
            target_seasons = [s for s in target_seasons if s in seasons]
        for season in target_seasons:
            try:
                results.append(sync_league_season(spec, season, store_dir=store_dir))
            except Exception as exc:  # noqa: BLE001 - surface ESPN/season gaps per league-year
                errors.append(f"{spec.id} {season}: {exc}")
    if errors and not results:
        raise RuntimeError("All sync attempts failed:\n" + "\n".join(errors))
    if errors:
        # Partial success is useful when the upcoming season isn't on ESPN yet.
        for message in errors:
            print(f"warning: skipped {message}", flush=True)
    return results
