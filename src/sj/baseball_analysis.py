"""Season-points baseball analysis (roadmap 8.5).

Walks ESPN ``view=mRoster`` per scoring period and credits each player's
**daily** ``appliedTotal`` (``statSourceId=0``, ``statSplitTypeId=5``) to that
day's ``lineupSlotId``. Writes side-concern JSON under
``{league}/{season}/analysis/`` — never from a Next.js request path.

Do **not** use ``playerPoolEntry.appliedStatTotal`` — it runs ~1.7× high vs
ESPN official team season points. Starter sum (all non-BE/IL slots) should
land within ~1% of ESPN team points; small gaps are missing days / pitcher
caps.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sj.mtransactions import (
    discover_scoring_periods,
    txn_max_periods,
    txn_period_throttle,
)
from sj.serialize import is_season_points_scoring
from sj.store import read_analysis, write_analysis

ANALYSIS_SCHEMA_VERSION = 1
ANALYSIS_METHOD = (
    "player.stats appliedTotal (statSourceId=0, statSplitTypeId=5) "
    "attributed to that day's lineupSlotId"
)
# Daily actuals on a scoring period (not season / projected / trailing).
STAT_SOURCE_ACTUAL = 0
STAT_SPLIT_DAILY = 5

# Display columns — collapsed from ESPN baseball POSITION_MAP.
SLOT_COLUMNS = ("C", "1B", "2B", "3B", "SS", "OF", "DH", "UTIL", "P", "RP")
BAT_SLOTS = ("C", "1B", "2B", "3B", "SS", "OF", "DH", "UTIL")
PITCH_SLOTS = ("P", "RP")
BENCH_SLOTS = frozenset({"BE", "IL"})
STARTER_SLOTS = frozenset(SLOT_COLUMNS)

# ESPN slot names that are not their own column on the board.
SLOT_COLLAPSE = {
    "LF": "OF",
    "CF": "OF",
    "RF": "OF",
    "SP": "P",
    "2B/SS": "UTIL",
    "1B/3B": "UTIL",
    "IF": "UTIL",
}

# ESPN baseball scoringPeriodId 1 ≈ opening day.
_OPENING_DAY = {
    2024: date(2024, 3, 28),
    2025: date(2025, 3, 27),
    2026: date(2026, 3, 26),
}

# Deterministic slot mix for synthetic fixtures/seeds (live 2026-ish shares).
_SAMPLE_SLOT_SHARES = {
    "C": 0.058,
    "1B": 0.049,
    "2B": 0.053,
    "3B": 0.051,
    "SS": 0.054,
    "OF": 0.156,
    "DH": 0.054,
    "UTIL": 0.046,
    "P": 0.425,
    "RP": 0.054,
}


def _position_map() -> dict[Any, Any]:
    try:
        from espn_api.baseball.constant import POSITION_MAP
    except ImportError:  # pragma: no cover - espn-api is a runtime dep
        return {
            0: "C",
            1: "1B",
            2: "2B",
            3: "3B",
            4: "SS",
            5: "OF",
            11: "DH",
            12: "UTIL",
            13: "P",
            14: "SP",
            15: "RP",
            16: "BE",
            17: "IL",
        }
    return POSITION_MAP


def slot_name_from_id(slot_id: Any) -> str | None:
    """Map ESPN ``lineupSlotId`` to a display slot (C/1B/…/BE/IL)."""
    if slot_id is None or isinstance(slot_id, bool):
        return None
    mapping = _position_map()
    if isinstance(slot_id, str) and not slot_id.isdigit():
        raw = slot_id.strip().upper()
        return SLOT_COLLAPSE.get(raw, raw) or None
    try:
        numeric = int(slot_id)
    except (TypeError, ValueError):
        return None
    raw = mapping.get(numeric)
    if raw is None:
        return None
    name = str(raw).upper()
    return SLOT_COLLAPSE.get(name, name)


def empty_slot_totals() -> dict[str, float]:
    return {slot: 0.0 for slot in SLOT_COLUMNS}


def round_points(value: float) -> float:
    """One decimal — matches ESPN applied totals without inventing precision."""
    if not math.isfinite(value):
        return 0.0
    return round(float(value), 1)


def daily_applied_total(player: dict[str, Any], period: int) -> float | None:
    """Return that period's actual daily ``appliedTotal``, or None.

    Ignores ``playerPoolEntry.appliedStatTotal`` (season-to-date / inflated).
    """
    stats = player.get("stats")
    if not isinstance(stats, list):
        return None
    for entry in stats:
        if not isinstance(entry, dict):
            continue
        if entry.get("scoringPeriodId") != period:
            continue
        source = entry.get("statSourceId")
        if source not in (None, STAT_SOURCE_ACTUAL):
            continue
        split = entry.get("statSplitTypeId")
        if split is not None and split != STAT_SPLIT_DAILY:
            continue
        raw = entry.get("appliedTotal")
        if raw is None:
            continue
        try:
            return float(raw)
        except (TypeError, ValueError):
            continue
    return None


def parse_mroster_period(
    payload: dict[str, Any],
    period: int,
) -> dict[int, dict[str, float]]:
    """Parse one ``view=mRoster`` payload into team_id → slot → points.

    Only credits ``appliedTotal`` for this scoring period. Unknown non-bench
    slots collapse into UTIL so starter sum still equals the column sum.
    """
    by_team: dict[int, dict[str, float]] = {}
    teams = payload.get("teams")
    if not isinstance(teams, list):
        return by_team
    for team in teams:
        if not isinstance(team, dict):
            continue
        try:
            team_id = int(team.get("id") if team.get("id") is not None else team.get("teamId"))
        except (TypeError, ValueError):
            continue
        roster = team.get("roster") if isinstance(team.get("roster"), dict) else {}
        entries = roster.get("entries") if isinstance(roster, dict) else None
        if not isinstance(entries, list):
            continue
        slots = by_team.setdefault(team_id, empty_slot_totals())
        slots.setdefault("BE", 0.0)
        slots.setdefault("IL", 0.0)
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            slot = slot_name_from_id(entry.get("lineupSlotId"))
            if not slot:
                slot = "UTIL"
            pool = entry.get("playerPoolEntry")
            player = pool.get("player") if isinstance(pool, dict) else None
            if not isinstance(player, dict):
                player = entry.get("player") if isinstance(entry.get("player"), dict) else None
            if not isinstance(player, dict):
                continue
            points = daily_applied_total(player, period)
            if points is None:
                continue
            if slot in BENCH_SLOTS or slot in STARTER_SLOTS:
                slots[slot] = slots.get(slot, 0.0) + points
            else:
                slots["UTIL"] = slots.get("UTIL", 0.0) + points
    return by_team


def extract_espn_team_points(payload: dict[str, Any]) -> dict[int, float]:
    """Official season points from ``mTeam`` / ``mRoster`` team objects."""
    out: dict[int, float] = {}
    teams = payload.get("teams")
    if not isinstance(teams, list):
        return out
    for team in teams:
        if not isinstance(team, dict):
            continue
        try:
            team_id = int(team.get("id") if team.get("id") is not None else team.get("teamId"))
        except (TypeError, ValueError):
            continue
        raw = team.get("points")
        if raw is None:
            raw = team.get("totalPoints")
        if raw is None:
            continue
        try:
            out[team_id] = float(raw)
        except (TypeError, ValueError):
            continue
    return out


def extract_points_by_scoring_period(
    payload: dict[str, Any],
) -> dict[int, dict[int, float]]:
    """Optional official daily team totals (``pointsByScoringPeriod``).

    Used as a comparison series when ESPN returns it; slot attribution still
    comes from the mRoster walk. Missing / empty is fine.
    """
    out: dict[int, dict[int, float]] = {}
    teams = payload.get("teams")
    if not isinstance(teams, list):
        return out
    for team in teams:
        if not isinstance(team, dict):
            continue
        try:
            team_id = int(team.get("id") if team.get("id") is not None else team.get("teamId"))
        except (TypeError, ValueError):
            continue
        raw = team.get("pointsByScoringPeriod")
        if not isinstance(raw, dict) or not raw:
            continue
        series: dict[int, float] = {}
        for key, value in raw.items():
            try:
                period = int(key)
                series[period] = float(value)
            except (TypeError, ValueError):
                continue
        if series:
            out[team_id] = series
    return out


def extract_team_names(payload: dict[str, Any]) -> dict[int, str]:
    out: dict[int, str] = {}
    teams = payload.get("teams")
    if not isinstance(teams, list):
        return out
    for team in teams:
        if not isinstance(team, dict):
            continue
        try:
            team_id = int(team.get("id") if team.get("id") is not None else team.get("teamId"))
        except (TypeError, ValueError):
            continue
        name = team.get("name") or team.get("location")
        if isinstance(team.get("location"), str) and isinstance(team.get("nickname"), str):
            name = f"{team['location']} {team['nickname']}".strip()
        if isinstance(name, str) and name.strip():
            out[team_id] = name.strip()
    return out


def opening_day(season: int) -> date:
    known = _OPENING_DAY.get(season)
    if known:
        return known
    # Last Thursday of March is a stable MLB-ish fallback.
    day = date(season, 3, 31)
    while day.weekday() != 3:  # Thursday
        day -= timedelta(days=1)
    return day


def period_date(
    season: int,
    period: int,
    schedule_dates: dict[int, str] | None = None,
) -> str:
    """ISO date for a scoring period (calendar day of the MLB season)."""
    if schedule_dates and period in schedule_dates:
        return schedule_dates[period]
    return (opening_day(season) + timedelta(days=max(0, period - 1))).isoformat()


def dates_from_pro_schedule(document: dict[str, Any] | None) -> dict[int, str]:
    """Map scoring_period_id → YYYY-MM-DD from ``pro_schedule.json`` games."""
    out: dict[int, str] = {}
    if not isinstance(document, dict):
        return out
    for game in document.get("games") or []:
        if not isinstance(game, dict):
            continue
        try:
            period = int(game.get("scoring_period_id"))
        except (TypeError, ValueError):
            continue
        start = game.get("start_time")
        if not isinstance(start, str) or not start:
            continue
        day = start[:10]
        if len(day) != 10:
            continue
        prev = out.get(period)
        if prev is None or day < prev:
            out[period] = day
    return out


def slot_row_totals(slots: dict[str, float]) -> dict[str, float]:
    """Derived columns: starters, bats, pitchers, bench+IL."""
    bats = round_points(sum(float(slots.get(slot) or 0.0) for slot in BAT_SLOTS))
    pitchers = round_points(sum(float(slots.get(slot) or 0.0) for slot in PITCH_SLOTS))
    bench_il = round_points(
        float(slots.get("BE") or 0.0) + float(slots.get("IL") or 0.0)
    )
    return {
        "starters": round_points(bats + pitchers),
        "bats": bats,
        "pitchers": pitchers,
        "bench_il": bench_il,
    }


def add_slot_maps(
    left: dict[int, dict[str, float]],
    right: dict[int, dict[str, float]],
) -> dict[int, dict[str, float]]:
    merged: dict[int, dict[str, float]] = {}
    for team_id in set(left) | set(right):
        acc = empty_slot_totals()
        acc["BE"] = 0.0
        acc["IL"] = 0.0
        for source in (left.get(team_id), right.get(team_id)):
            if not source:
                continue
            for slot, value in source.items():
                acc[slot] = acc.get(slot, 0.0) + float(value or 0.0)
        merged[team_id] = acc
    return merged


def build_team_slot_rows(
    totals: dict[int, dict[str, float]],
    *,
    names: dict[int, str],
    espn_points: dict[int, float],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for team_id in sorted(totals, key=lambda tid: (-slot_row_totals(totals[tid])["starters"], tid)):
        slots = totals[team_id]
        derived = slot_row_totals(slots)
        official = espn_points.get(team_id)
        row: dict[str, Any] = {
            "team_id": team_id,
            "name": names.get(team_id) or f"Team {team_id}",
            "slots": {slot: round_points(float(slots.get(slot) or 0.0)) for slot in SLOT_COLUMNS},
            "starters": derived["starters"],
            "bats": derived["bats"],
            "pitchers": derived["pitchers"],
            "bench_il": derived["bench_il"],
            "espn_points": round_points(official) if official is not None else None,
            "delta": (
                round_points(derived["starters"] - official)
                if official is not None
                else None
            ),
        }
        rows.append(row)
    return rows


def build_timeseries_teams(
    period_slots: dict[int, dict[int, dict[str, float]]],
    *,
    names: dict[int, str],
    season: int,
    schedule_dates: dict[int, str] | None = None,
    espn_daily: dict[int, dict[int, float]] | None = None,
) -> list[dict[str, Any]]:
    """Per-team cumulative starter series from per-period slot maps."""
    periods = sorted(period_slots)
    team_ids: set[int] = set()
    for day in period_slots.values():
        team_ids.update(day)
    teams: list[dict[str, Any]] = []
    for team_id in sorted(team_ids):
        points: list[dict[str, Any]] = []
        running = 0.0
        for period in periods:
            slots = period_slots.get(period, {}).get(team_id) or {}
            derived = slot_row_totals(slots)
            running = round_points(running + derived["starters"])
            official = None
            if espn_daily and team_id in espn_daily:
                official = espn_daily[team_id].get(period)
            points.append(
                {
                    "period": period,
                    "date": period_date(season, period, schedule_dates),
                    "daily_starters": derived["starters"],
                    "cumulative_starters": running,
                    "daily_bats": derived["bats"],
                    "daily_pitchers": derived["pitchers"],
                    **(
                        {"espn_daily": round_points(official)}
                        if official is not None
                        else {}
                    ),
                }
            )
        teams.append(
            {
                "team_id": team_id,
                "name": names.get(team_id) or f"Team {team_id}",
                "points": points,
            }
        )
    return teams


def analysis_periods(league: Any, snapshot: dict[str, Any]) -> list[int]:
    """Scoring periods to walk (1..current), capped like the txn fallback."""
    discovered = discover_scoring_periods(league, max_periods=txn_max_periods())
    # Period 0 is preseason / undated — skip for daily applied totals.
    periods = [p for p in discovered if p >= 1]
    if periods:
        return periods
    current = int(snapshot.get("current_week") or 0)
    if current < 1:
        return []
    return list(range(1, min(current, txn_max_periods()) + 1))


def _period_unsupported(exc: BaseException) -> bool:
    try:
        from espn_api.requests.espn_requests import ESPNInvalidLeague
    except ImportError:  # pragma: no cover
        ESPNInvalidLeague = ()  # type: ignore[misc, assignment]
    if ESPNInvalidLeague and isinstance(exc, ESPNInvalidLeague):
        return True
    msg = str(exc).lower()
    return (
        "cant retrieve" in msg
        or "can't retrieve" in msg
        or "does not exist" in msg
    )


def fetch_mroster_period(league: Any, period: int) -> dict[str, Any] | None:
    """One ``view=mRoster`` call for a scoring period. None when ESPN refuses."""
    request = getattr(league, "espn_request", None)
    league_get = getattr(request, "league_get", None) if request is not None else None
    if not callable(league_get):
        return None
    from sj.sync import espn_call

    try:
        data = espn_call(
            lambda current=period: league_get(
                params={"view": "mRoster", "scoringPeriodId": current}
            ),
            label=f"mRoster:sp{period}",
        )
    except Exception as exc:
        if _period_unsupported(exc):
            return None
        raise
    return data if isinstance(data, dict) else None


def fetch_mteam(league: Any) -> dict[str, Any] | None:
    """Single ``view=mTeam`` for official season points / optional daily map."""
    request = getattr(league, "espn_request", None)
    league_get = getattr(request, "league_get", None) if request is not None else None
    if not callable(league_get):
        return None
    from sj.sync import espn_call

    try:
        data = espn_call(
            lambda: league_get(params={"view": "mTeam"}),
            label="mTeam:analysis",
        )
    except Exception as exc:
        if _period_unsupported(exc):
            return None
        raise
    return data if isinstance(data, dict) else None


def existing_period_slots(document: dict[str, Any] | None) -> dict[int, dict[int, dict[str, float]]]:
    """Restore per-period slot maps from a prior ``slot_points.json``."""
    out: dict[int, dict[int, dict[str, float]]] = {}
    if not isinstance(document, dict):
        return out
    if document.get("method") != ANALYSIS_METHOD:
        return out
    raw = document.get("period_slots")
    if not isinstance(raw, dict):
        return out
    for period_key, teams in raw.items():
        try:
            period = int(period_key)
        except (TypeError, ValueError):
            continue
        if not isinstance(teams, dict):
            continue
        day: dict[int, dict[str, float]] = {}
        for team_key, slots in teams.items():
            try:
                team_id = int(team_key)
            except (TypeError, ValueError):
                continue
            if not isinstance(slots, dict):
                continue
            day[team_id] = {str(k): float(v or 0.0) for k, v in slots.items()}
        if day:
            out[period] = day
    return out


def serialize_period_slots(
    period_slots: dict[int, dict[int, dict[str, float]]],
) -> dict[str, dict[str, dict[str, float]]]:
    packed: dict[str, dict[str, dict[str, float]]] = {}
    for period in sorted(period_slots):
        packed[str(period)] = {
            str(team_id): {
                slot: round_points(float(value or 0.0))
                for slot, value in slots.items()
            }
            for team_id, slots in sorted(period_slots[period].items())
        }
    return packed


def build_slot_points_document(
    *,
    league_id: str,
    espn_league_id: int | None,
    season: int,
    scoring_type: str | None,
    names: dict[int, str],
    totals: dict[int, dict[str, float]],
    espn_points: dict[int, float],
    periods_ok: list[int],
    periods_failed: list[int],
    period_slots: dict[int, dict[int, dict[str, float]]],
    synced_at: str | None,
    incremental: bool,
) -> dict[str, Any]:
    ok = sorted(periods_ok)
    return {
        "schema_version": ANALYSIS_SCHEMA_VERSION,
        "league_id": league_id,
        "espn_league_id": espn_league_id,
        "season": season,
        "sport": "baseball",
        "scoring_type": scoring_type,
        "method": ANALYSIS_METHOD,
        "synced_at": synced_at,
        "incremental": incremental,
        "periods": {
            "first": ok[0] if ok else None,
            "latest": ok[-1] if ok else None,
            "ok": len(ok),
            "failed": sorted(periods_failed),
        },
        "slots": list(SLOT_COLUMNS),
        "teams": build_team_slot_rows(totals, names=names, espn_points=espn_points),
        "period_slots": serialize_period_slots(period_slots),
    }


def build_timeseries_document(
    *,
    league_id: str,
    espn_league_id: int | None,
    season: int,
    scoring_type: str | None,
    names: dict[int, str],
    period_slots: dict[int, dict[int, dict[str, float]]],
    schedule_dates: dict[int, str] | None,
    espn_daily: dict[int, dict[int, float]] | None,
    synced_at: str | None,
) -> dict[str, Any]:
    return {
        "schema_version": ANALYSIS_SCHEMA_VERSION,
        "league_id": league_id,
        "espn_league_id": espn_league_id,
        "season": season,
        "sport": "baseball",
        "scoring_type": scoring_type,
        "method": ANALYSIS_METHOD,
        "synced_at": synced_at,
        "grain": "scoring_period",
        "period_label": "day",
        "teams": build_timeseries_teams(
            period_slots,
            names=names,
            season=season,
            schedule_dates=schedule_dates,
            espn_daily=espn_daily,
        ),
    }


def sync_baseball_analysis(
    league: Any,
    spec: Any,
    season: int,
    snapshot: dict[str, Any],
    store_dir: Any = None,
    *,
    force: bool = False,
    throttle_seconds: float | None = None,
    sleep: Any = None,
    fetch_period: Any = None,
    fetch_teams: Any = None,
    pro_schedule: dict[str, Any] | None = None,
) -> int:
    """Write ``analysis/slot_points.json`` + ``points_timeseries.json``.

    Season-points baseball only. Skips (returns 0) when the league is H2H
    category, ``espn_request`` is missing, or no scoring periods exist.
    Incremental: completed periods in an existing file are reused unless
    ``force`` is set. A failed period is retried.
    """
    if getattr(spec, "sport", None) != "baseball":
        return 0
    scoring_type = snapshot.get("scoring_type") or (
        (snapshot.get("settings") or {}).get("scoring_type")
    )
    scoring = scoring_type if isinstance(scoring_type, str) else None
    if not is_season_points_scoring(scoring):
        return 0

    periods = analysis_periods(league, snapshot)
    if not periods:
        return 0

    import time

    if sleep is None:
        sleep = time.sleep
    if fetch_period is None:
        fetch_period = fetch_mroster_period
    if fetch_teams is None:
        fetch_teams = fetch_mteam

    delay = txn_period_throttle() if throttle_seconds is None else max(0.0, float(throttle_seconds))
    league_id = str(spec.id)
    espn_league_id = snapshot.get("espn_league_id") or getattr(spec, "espn_league_id", None)
    synced_at = snapshot.get("synced_at")
    if not isinstance(synced_at, str):
        synced_at = datetime.now(timezone.utc).isoformat()

    prior = None if force else read_analysis(league_id, season, "slot_points", store_dir=store_dir)
    period_slots = existing_period_slots(prior)
    already = set(period_slots)
    to_fetch = [p for p in periods if p not in already]
    # Re-fetch the latest period on an in-progress season so today's lineup
    # updates land without a full recompute.
    if (
        not force
        and to_fetch == []
        and periods
        and periods[-1] in already
        and int(snapshot.get("current_week") or 0) == periods[-1]
    ):
        to_fetch = [periods[-1]]

    names: dict[int, str] = {}
    for team in snapshot.get("teams") or []:
        if not isinstance(team, dict):
            continue
        try:
            names[int(team["team_id"])] = str(team.get("name") or f"Team {team['team_id']}")
        except (TypeError, ValueError, KeyError):
            continue
    espn_points: dict[int, float] = {}
    for team in snapshot.get("teams") or []:
        if not isinstance(team, dict):
            continue
        try:
            tid = int(team["team_id"])
        except (TypeError, ValueError, KeyError):
            continue
        raw = team.get("points_for")
        if raw is not None:
            try:
                espn_points[tid] = float(raw)
            except (TypeError, ValueError):
                pass

    espn_daily: dict[int, dict[int, float]] = {}
    team_payload = fetch_teams(league)
    if isinstance(team_payload, dict):
        names.update(extract_team_names(team_payload))
        espn_points.update(extract_espn_team_points(team_payload))
        espn_daily = extract_points_by_scoring_period(team_payload)

    failed: list[int] = []
    fetched = 0
    for index, period in enumerate(to_fetch):
        if index and delay:
            sleep(delay)
        try:
            payload = fetch_period(league, period)
        except Exception:  # noqa: BLE001 — one bad period must not abort the walk
            failed.append(period)
            continue
        if not isinstance(payload, dict):
            failed.append(period)
            continue
        day = parse_mroster_period(payload, period)
        if not day:
            failed.append(period)
            continue
        period_slots[period] = day
        names.update(extract_team_names(payload))
        espn_points.update(extract_espn_team_points(payload))
        fetched += 1

    if not period_slots:
        return 0

    totals: dict[int, dict[str, float]] = {}
    for day in period_slots.values():
        totals = add_slot_maps(totals, day)

    ok = sorted(period_slots)
    schedule_dates = dates_from_pro_schedule(pro_schedule)
    if not schedule_dates:
        try:
            from sj.store import read_pro_schedule

            schedule_dates = dates_from_pro_schedule(
                read_pro_schedule(league_id, season, store_dir=store_dir)
            )
        except Exception:  # noqa: BLE001 — sidecar optional
            schedule_dates = {}

    slot_doc = build_slot_points_document(
        league_id=league_id,
        espn_league_id=int(espn_league_id) if espn_league_id else None,
        season=season,
        scoring_type=scoring,
        names=names,
        totals=totals,
        espn_points=espn_points,
        periods_ok=ok,
        periods_failed=failed,
        period_slots=period_slots,
        synced_at=synced_at,
        incremental=bool(already) and not force,
    )
    series_doc = build_timeseries_document(
        league_id=league_id,
        espn_league_id=int(espn_league_id) if espn_league_id else None,
        season=season,
        scoring_type=scoring,
        names=names,
        period_slots=period_slots,
        schedule_dates=schedule_dates,
        espn_daily=espn_daily or None,
        synced_at=synced_at,
    )
    write_analysis(slot_doc, "slot_points", store_dir=store_dir)
    write_analysis(series_doc, "points_timeseries", store_dir=store_dir)
    return 2 if (fetched or already) else 0


def sample_baseball_analysis_for_snapshot(snapshot: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Deterministic analysis sidecars for fixtures / ``sj seed`` (roadmap 8.5).

    Scales a live-2026-like slot mix to each team's ESPN ``points_for`` and
    spreads starters across ``current_week`` scoring periods with a mild
    sine-wave so the chart is not a straight line. Not a live ESPN pull.
    """
    import math as _math

    season = int(snapshot["season"])
    league_id = str(snapshot["league_id"])
    espn_league_id = snapshot.get("espn_league_id")
    scoring = snapshot.get("scoring_type")
    synced_at = snapshot.get("synced_at") or datetime.now(timezone.utc).isoformat()
    n_periods = max(1, int(snapshot.get("current_week") or 1))
    names = {
        int(team["team_id"]): str(team.get("name") or f"Team {team['team_id']}")
        for team in (snapshot.get("teams") or [])
        if isinstance(team, dict) and team.get("team_id") is not None
    }
    espn_points = {}
    for team in snapshot.get("teams") or []:
        if not isinstance(team, dict) or team.get("team_id") is None:
            continue
        raw = team.get("points_for")
        try:
            espn_points[int(team["team_id"])] = float(raw or 0.0)
        except (TypeError, ValueError):
            espn_points[int(team["team_id"])] = 0.0

    period_slots: dict[int, dict[int, dict[str, float]]] = defaultdict(dict)
    totals: dict[int, dict[str, float]] = {}
    for team_id, official in espn_points.items():
        starters_total = official * 0.99
        bench_total = official * 0.22
        season_slots = empty_slot_totals()
        for slot, share in _SAMPLE_SLOT_SHARES.items():
            season_slots[slot] = starters_total * share
        # Tiny per-team wobble so columns are not identical across clubs.
        wobble = 1.0 + 0.012 * ((team_id % 5) - 2)
        for slot in SLOT_COLUMNS:
            season_slots[slot] *= wobble if slot in BAT_SLOTS else (2.0 - wobble + 0.012)
        # Re-normalize bats+pitchers to starters_total after wobble.
        derived = slot_row_totals(season_slots)
        if derived["starters"]:
            scale = starters_total / derived["starters"]
            for slot in SLOT_COLUMNS:
                season_slots[slot] *= scale
        season_slots["BE"] = bench_total
        season_slots["IL"] = 0.0
        totals[team_id] = season_slots

        weights = [
            1.0 + 0.28 * _math.sin(2 * _math.pi * (period - 1) / n_periods + team_id)
            for period in range(1, n_periods + 1)
        ]
        weight_sum = sum(weights) or 1.0
        for period, weight in enumerate(weights, start=1):
            frac = weight / weight_sum
            day = {slot: float(season_slots.get(slot) or 0.0) * frac for slot in SLOT_COLUMNS}
            day["BE"] = bench_total * frac
            day["IL"] = 0.0
            period_slots[period][team_id] = day

    slot_doc = build_slot_points_document(
        league_id=league_id,
        espn_league_id=int(espn_league_id) if espn_league_id else None,
        season=season,
        scoring_type=scoring if isinstance(scoring, str) else None,
        names=names,
        totals=totals,
        espn_points=espn_points,
        periods_ok=list(range(1, n_periods + 1)),
        periods_failed=[],
        period_slots=dict(period_slots),
        synced_at=str(synced_at),
        incremental=False,
    )
    # Fixtures omit the bulky period_slots map — hub only needs teams[].
    slot_doc.pop("period_slots", None)
    series_doc = build_timeseries_document(
        league_id=league_id,
        espn_league_id=int(espn_league_id) if espn_league_id else None,
        season=season,
        scoring_type=scoring if isinstance(scoring, str) else None,
        names=names,
        period_slots=dict(period_slots),
        schedule_dates=None,
        espn_daily=None,
        synced_at=str(synced_at),
    )
    return slot_doc, series_doc
