"""Pull ESPN fantasy leagues into the Strictly Jayers snapshot store."""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal, TypeVar

from sj.registry import LeagueSpec, load_registry
from sj.serialize import build_week_box_scores_document, serialize_league
from sj.store import write_snapshot, write_week_box_scores

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

# ESPN activity / free-agent endpoints are unavailable before 2019 in espn-api.
ACTIVITY_MIN_SEASON = 2019
FREE_AGENT_MIN_SEASON = 2019
# Football box_scores() uses the same floor (espn-api raises below 2019).
BOX_SCORE_MIN_SEASON = 2019
DEFAULT_ESPN_TIMEOUT_SECONDS = 30.0
DEFAULT_ESPN_MAX_ATTEMPTS = 4
DEFAULT_ACTIVITY_PAGE_SIZE = 25
DEFAULT_ACTIVITY_MAX_PAGES = 40
DEFAULT_FREE_AGENT_SIZE = 50
MAX_FREE_AGENT_SIZE = 150
# Cap HTTP cost on deep historical syncs (~3 ESPN round-trips per week).
DEFAULT_BOX_SCORE_MAX_WEEKS = 18
MAX_BOX_SCORE_MAX_WEEKS = 22

T = TypeVar("T")


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


def espn_timeout_seconds() -> float:
    raw = os.environ.get("SJ_ESPN_TIMEOUT", str(DEFAULT_ESPN_TIMEOUT_SECONDS))
    try:
        return max(1.0, float(raw))
    except ValueError:
        return DEFAULT_ESPN_TIMEOUT_SECONDS


def espn_max_attempts() -> int:
    raw = os.environ.get("SJ_ESPN_MAX_ATTEMPTS", str(DEFAULT_ESPN_MAX_ATTEMPTS))
    try:
        return max(1, int(raw))
    except ValueError:
        return DEFAULT_ESPN_MAX_ATTEMPTS


class _TimedRequests:
    """Proxy that injects a default timeout into espn-api's ``requests.get`` calls.

    espn-api uses the module-level ``requests`` object (not a Session), so we
    replace ``espn_api.requests.espn_requests.requests`` with this wrapper.
    """

    _sj_timeout_wrapped = True

    def __init__(self, timeout: float) -> None:
        import requests as requests_lib

        self._requests = requests_lib
        self._sj_timeout = timeout

    def get(self, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("timeout", self._sj_timeout)
        return self._requests.get(url, **kwargs)

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("timeout", self._sj_timeout)
        return self._requests.request(method, url, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._requests, name)


def _install_espn_timeout(timeout: float | None = None) -> None:
    """Apply a default timeout to espn-api HTTP calls (roadmap 2.4)."""
    from espn_api.requests import espn_requests

    seconds = espn_timeout_seconds() if timeout is None else timeout
    current = espn_requests.requests
    if getattr(current, "_sj_timeout_wrapped", False):
        current._sj_timeout = seconds
        return
    espn_requests.requests = _TimedRequests(seconds)


def _is_retryable_espn_error(exc: BaseException) -> bool:
    if isinstance(exc, (ConnectionError, TimeoutError, OSError)):
        return True
    try:
        import requests
        from espn_api.requests.espn_requests import ESPNUnknownError

        if isinstance(exc, (requests.exceptions.Timeout, requests.exceptions.ConnectionError)):
            return True
        if isinstance(exc, requests.exceptions.HTTPError):
            status = getattr(getattr(exc, "response", None), "status_code", None)
            return status in {408, 429, 500, 502, 503, 504}
        if isinstance(exc, ESPNUnknownError):
            msg = str(exc)
            return any(
                f"HTTP {code}" in msg for code in (408, 429, 500, 502, 503, 504)
            )
    except ImportError:  # pragma: no cover
        pass
    return False


def espn_call(
    fn: Callable[[], T],
    *,
    label: str = "espn",
    max_attempts: int | None = None,
    base_delay: float = 0.5,
) -> T:
    """Run an ESPN-facing callable with exponential backoff on transient errors."""
    del label  # reserved for future structured logging
    attempts = espn_max_attempts() if max_attempts is None else max(1, max_attempts)
    last_exc: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if attempt >= attempts or not _is_retryable_espn_error(exc):
                raise
            time.sleep(base_delay * (2 ** (attempt - 1)))
    assert last_exc is not None  # pragma: no cover
    raise last_exc


def open_espn_league(spec: LeagueSpec, season: int) -> Any:
    if not spec.is_espn() or spec.espn_league_id is None:
        raise ValueError(f"{spec.id}: not an ESPN league (platform={spec.platform})")

    espn_s2, swid = espn_credentials()
    if not espn_s2 or not swid:
        raise RuntimeError(
            "ESPN_S2 and ESPN_SWID (or SWID) env vars are required for private leagues"
        )

    _install_espn_timeout()

    if spec.sport == "football":
        from espn_api.football import League
    elif spec.sport == "baseball":
        from espn_api.baseball import League
    elif spec.sport == "basketball":
        from espn_api.basketball import League
    else:  # pragma: no cover - registry validates sport
        raise ValueError(f"Unsupported sport: {spec.sport}")

    def _construct() -> Any:
        return League(
            league_id=spec.espn_league_id,
            year=season,
            espn_s2=espn_s2,
            swid=swid,
        )

    return espn_call(_construct, label=f"open:{spec.id}:{season}")


def _activity_unsupported(exc: BaseException) -> bool:
    """ESPN often refuses historical activity with misleading errors.

    Pre-2019 is gated separately. For 2019–prior-current, ``recent_activity``
    can raise ``ESPNInvalidLeague`` ("League N does not exist") even when the
    League constructor and standings/rosters succeed — treat that as "no
    activity", not a failed season sync.
    """
    from espn_api.requests.espn_requests import ESPNInvalidLeague

    if isinstance(exc, ESPNInvalidLeague):
        return True
    msg = str(exc).lower()
    return (
        "cant retrieve" in msg
        or "can't retrieve" in msg
        or "cant use recent" in msg
        or "does not exist" in msg
    )


def _free_agents_unsupported(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "cant use free" in msg
        or "can't use free" in msg
        or "before 2019" in msg
        or "cant retrieve" in msg
        or "can't retrieve" in msg
    )


def free_agent_size() -> int:
    """ESPN ``limit`` for free_agents (default 50). Cap keeps snapshots small."""
    raw = os.environ.get("SJ_FREE_AGENT_SIZE", "").strip()
    if not raw:
        return DEFAULT_FREE_AGENT_SIZE
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_FREE_AGENT_SIZE
    return max(1, min(value, MAX_FREE_AGENT_SIZE))


def fetch_free_agents(
    league: Any,
    *,
    size: int | None = None,
) -> list[Any]:
    """Fetch FREEAGENT + WAIVERS pool (espn-api; empty before 2019).

    Football costs three HTTP calls (kona_player_info + schedule + ratings);
    baseball is one. Docstring says current season only — historical years
    that error are treated as unsupported (empty list), not sync failures.
    """
    season = int(getattr(league, "year", 0) or 0)
    if season and season < FREE_AGENT_MIN_SEASON:
        return []
    if not callable(getattr(league, "free_agents", None)):
        return []
    limit = DEFAULT_FREE_AGENT_SIZE if size is None else size
    limit = max(1, min(int(limit), MAX_FREE_AGENT_SIZE))
    try:
        return list(
            espn_call(
                lambda: league.free_agents(size=limit),
                label="free_agents",
            )
            or []
        )
    except Exception as exc:
        if _free_agents_unsupported(exc):
            return []
        raise


def fetch_recent_activity(
    league: Any,
    *,
    page_size: int = DEFAULT_ACTIVITY_PAGE_SIZE,
    max_pages: int = DEFAULT_ACTIVITY_MAX_PAGES,
) -> list[Any]:
    """Page through ESPN recent activity for football / baseball / basketball."""
    season = int(getattr(league, "year", 0) or 0)
    if season and season < ACTIVITY_MIN_SEASON:
        return []
    if not callable(getattr(league, "recent_activity", None)):
        return []

    items: list[Any] = []
    offset = 0
    for _ in range(max_pages):
        try:
            page = espn_call(
                lambda current=offset: league.recent_activity(
                    size=page_size, offset=current
                ),
                label="recent_activity",
            )
        except Exception as exc:
            if offset == 0 and _activity_unsupported(exc):
                return []
            raise
        if not page:
            break
        items.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return items


def box_score_max_weeks() -> int:
    """Max scoring periods to pull box scores for (default 18)."""
    raw = os.environ.get("SJ_BOX_SCORE_MAX_WEEKS", "").strip()
    if not raw:
        return DEFAULT_BOX_SCORE_MAX_WEEKS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_BOX_SCORE_MAX_WEEKS
    return max(1, min(value, MAX_BOX_SCORE_MAX_WEEKS))


def _box_scores_unsupported(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "before 2019" in msg
        or "cant retrieve" in msg
        or "can't retrieve" in msg
        or "does not exist" in msg
    )


def fetch_box_scores(
    league: Any,
    week: int,
    *,
    player_team_cache: dict[int, int] | None = None,
) -> list[Any]:
    """Fetch football ``BoxScore`` objects for one scoring period.

    espn-api ``box_scores`` is football-only and refuses seasons before 2019.
    ``player_team_cache`` should be shared across weeks in one sync.
    """
    season = int(getattr(league, "year", 0) or 0)
    if season and season < BOX_SCORE_MIN_SEASON:
        return []
    if not callable(getattr(league, "box_scores", None)):
        return []
    try:
        # espn-api accepts player_team_cache on recent versions; fall back if not.
        def _call() -> Any:
            try:
                return league.box_scores(
                    week=week, player_team_cache=player_team_cache
                )
            except TypeError:
                return league.box_scores(week=week)

        return list(espn_call(_call, label=f"box_scores:w{week}") or [])
    except Exception as exc:
        if _box_scores_unsupported(exc):
            return []
        raise


def sync_football_box_scores(
    league: Any,
    spec: LeagueSpec,
    season: int,
    snapshot: dict[str, Any],
    store_dir: Path | str | None = None,
) -> int:
    """Write ``weeks/{N}.json`` for weeks 1..current (football only).

    Side concern — does not upsert ``index.json``. Returns weeks written.
    """
    if spec.sport != "football":
        return 0
    if season < BOX_SCORE_MIN_SEASON:
        return 0
    current = int(snapshot.get("current_week") or 0)
    if current < 1:
        return 0
    last = min(current, box_score_max_weeks())
    cache: dict[int, int] = {}
    written = 0
    synced_at = snapshot.get("synced_at")
    for week in range(1, last + 1):
        boxes = fetch_box_scores(league, week, player_team_cache=cache)
        if not boxes:
            continue
        doc = build_week_box_scores_document(
            league_id=spec.id,
            season=season,
            week=week,
            box_scores=boxes,
            synced_at=synced_at if isinstance(synced_at, str) else None,
            period_label=str(snapshot.get("period_label") or "week"),
        )
        write_week_box_scores(doc, store_dir=store_dir)
        written += 1
    return written


def build_snapshot(league: Any, spec: LeagueSpec, season: int) -> dict[str, Any]:
    """Serialize an espn-api league object into a store-ready snapshot.

    Split out from :func:`sync_league_season` so anything producing a
    league-shaped object -- the live ESPN client, or ``sj.sample`` -- goes
    through one definition of the snapshot schema.
    """
    # recent_activity (paged) + free_agents (size-capped) are extra ESPN calls;
    # settings come free from the League constructor's mSettings fetch.
    activities = fetch_recent_activity(league)
    agents = fetch_free_agents(league, size=free_agent_size())
    snapshot = serialize_league(
        league,
        league_id=spec.id,
        sport=spec.sport,
        format=spec.format,
        season=season,
        espn_league_id=spec.espn_league_id,
        transactions=activities,
        free_agents=agents,
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
    # Football box scores are a side concern (roadmap 8.1) — after the season
    # write so a failed week pull never leaves a half-written manifest.
    sync_football_box_scores(league, spec, season, snapshot, store_dir=store_dir)
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
        if not spec.is_espn():
            emit(f"skip {spec.id}: platform={spec.platform} (not ESPN)")
            continue
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


def notify_hub_revalidate(
    *,
    url: str | None = None,
    secret: str | None = None,
    timeout_seconds: float = 5.0,
) -> str:
    """Best-effort POST to the hub's ``/api/revalidate`` after store writes.

    No-op when ``SJ_REVALIDATE_URL`` or ``SJ_REVALIDATE_SECRET`` is unset.
    Never raises — sync/backfill must not fail because the hub was unreachable.
    Returns a short status string for logs.
    """
    import urllib.error
    import urllib.request

    target = (url if url is not None else os.environ.get("SJ_REVALIDATE_URL", "")).strip()
    token = (
        secret if secret is not None else os.environ.get("SJ_REVALIDATE_SECRET", "")
    ).strip()
    if not target or not token:
        return "skipped (SJ_REVALIDATE_URL / SJ_REVALIDATE_SECRET unset)"

    request = urllib.request.Request(
        target,
        data=b"{}",
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "sj-sync-revalidate/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            code = getattr(response, "status", None) or response.getcode()
            return f"ok HTTP {code}"
    except urllib.error.HTTPError as exc:
        return f"failed HTTP {exc.code}"
    except Exception as exc:  # noqa: BLE001 - best-effort webhook
        return f"failed {type(exc).__name__}: {exc}"
