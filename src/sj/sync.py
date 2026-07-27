"""Pull ESPN fantasy leagues into the Strictly Jayers snapshot store."""

from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

from sj.registry import LeagueSpec, load_registry
from sj.serialize import serialize_league
from sj.store import write_snapshot

FailureKind = Literal[
    "credentials",
    "access_denied",
    "invalid_league",
    "network",
    "unknown",
]

# Historical backfills often hit seasons ESPN no longer serves. Those alone
# should not fail a backfill run. Everything else (auth, network, unknown)
# must — and `sj sync` treats *any* failure as fatal so Cloud Scheduler sees it.
TOLERATED_BACKFILL_KINDS: frozenset[FailureKind] = frozenset({"invalid_league"})


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
    kind: FailureKind = "unknown"


class SyncAllFailed(RuntimeError):
    """Raised when every league-season attempt failed."""

    def __init__(self, failures: list[SyncFailure]) -> None:
        self.failures = failures
        detail = "\n".join(
            f"{f.league_id} {f.season} [{f.kind}]: {f.error}" for f in failures
        )
        super().__init__("All sync attempts failed:\n" + detail)


def classify_sync_error(exc: BaseException) -> FailureKind:
    """Map an exception from a league-season attempt to a stable failure kind."""
    # Import inside the function so tests can raise these without importing
    # espn_api at module import time in every caller.
    from espn_api.requests.espn_requests import (
        ESPNAccessDenied,
        ESPNInvalidLeague,
        ESPNUnknownError,
    )

    if isinstance(exc, ESPNAccessDenied):
        return "access_denied"
    if isinstance(exc, ESPNInvalidLeague):
        return "invalid_league"
    if isinstance(exc, RuntimeError) and "ESPN_S2" in str(exc):
        return "credentials"
    if isinstance(exc, (ConnectionError, TimeoutError)):
        return "network"
    try:
        import requests

        if isinstance(exc, requests.exceptions.RequestException):
            return "network"
    except ImportError:  # pragma: no cover - requests is an espn-api dependency
        pass
    if isinstance(exc, ESPNUnknownError):
        return "unknown"
    return "unknown"


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
    """Sync selected leagues/seasons, collecting per-season failures.

    Returns successes and failures separately so a backfill can report which
    league-years ESPN refused. Callers decide exit policy via
    :func:`failures_should_fail_run` — the scheduled ``sj sync`` treats any
    failure as fatal; ``sj backfill`` tolerates ``invalid_league`` only.
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
                kind = classify_sync_error(exc)
                failure = SyncFailure(spec.id, season, str(exc), kind=kind)
                failures.append(failure)
                emit(f"skipped {spec.id} {season} [{kind}]: {exc}")
            else:
                results.append(result)
                emit(f"synced {spec.id} {season} ({result.team_count} teams)")
            if throttle_seconds:
                time.sleep(throttle_seconds)

    if failures and not results:
        raise SyncAllFailed(failures)
    return results, failures


def failures_should_fail_run(
    failures: list[SyncFailure],
    *,
    tolerate_invalid_league: bool = False,
) -> bool:
    """Return True when the CLI should exit non-zero given these failures."""
    if not failures:
        return False
    if not tolerate_invalid_league:
        return True
    return any(f.kind not in TOLERATED_BACKFILL_KINDS for f in failures)


def sync_summary_line(
    results: list[SyncResult],
    failures: list[SyncFailure],
    *,
    ok: bool,
) -> str:
    """One machine-readable line for logs / Cloud Logging / future alerting."""
    kinds: dict[str, int] = {}
    for failure in failures:
        kinds[failure.kind] = kinds.get(failure.kind, 0) + 1
    payload = {
        "ok": ok,
        "synced": len(results),
        "failed": len(failures),
        "kinds": kinds,
        "failures": [asdict(f) for f in failures],
    }
    return "SYNC_SUMMARY " + json.dumps(payload, sort_keys=True)
