"""Weekly golf lineups + tee-time locks (roadmap 6.4c)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sg.schedule import FIXTURE_NOW, build_event_with_tee_times, fixture_events
from sg.settings import STARTERS, GolfSettings, validate_golf_settings


def parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp


def player_is_locked(
    player_id: int | str,
    *,
    tee_times: dict[str, str] | None,
    now: datetime | None = None,
) -> bool:
    """Fail closed: missing tee time is not locked; past tee time is locked."""
    if not tee_times:
        return False
    tee = parse_utc(tee_times.get(str(player_id)))
    if tee is None:
        return False
    clock = now or datetime.now(timezone.utc)
    return clock >= tee


def default_lineup_from_roster(
    roster: list[dict[str, Any]],
    settings: GolfSettings | dict[str, Any] | None,
    *,
    saved_at: str,
) -> dict[str, Any]:
    """Seed weekly lineup from draft GS/BE order."""
    golf = validate_golf_settings(settings)
    ids = [int(p["id"]) for p in roster if p.get("id") is not None]
    starters_n = golf.roster.starters or STARTERS
    if len(ids) < starters_n:
        raise ValueError(f"roster needs at least {starters_n} players for a lineup")
    starters = ids[:starters_n]
    bench = ids[starters_n:]
    alt1 = bench[0] if golf.missed_cut.mode in {"alt1", "alt1_2"} and bench else None
    alt2 = (
        bench[1]
        if golf.missed_cut.mode == "alt1_2" and len(bench) > 1
        else None
    )
    return {
        "starters": starters,
        "captain": starters[0],
        "alt1": alt1,
        "alt2": alt2,
        "saved_at": saved_at,
        "locked_at": None,
        "locks": {},
    }


def validate_week_lineup(
    lineup: dict[str, Any],
    *,
    roster_ids: set[int],
    settings: GolfSettings | dict[str, Any] | None,
    tee_times: dict[str, str] | None = None,
    previous: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> list[str]:
    """Return human-readable validation errors (empty = ok)."""
    golf = validate_golf_settings(settings)
    errors: list[str] = []
    starters = lineup.get("starters") or []
    if not isinstance(starters, list):
        return ["starters must be a list"]
    try:
        starter_ids = [int(x) for x in starters]
    except (TypeError, ValueError):
        return ["starter ids must be integers"]

    if len(starter_ids) != (golf.roster.starters or STARTERS):
        errors.append(f"need exactly {golf.roster.starters} starters")
    if len(set(starter_ids)) != len(starter_ids):
        errors.append("starters must be unique")
    for pid in starter_ids:
        if pid not in roster_ids:
            errors.append(f"starter {pid} is not on the roster")

    try:
        captain = int(lineup["captain"])
    except (KeyError, TypeError, ValueError):
        errors.append("captain is required")
        captain = -1
    else:
        if captain not in starter_ids:
            errors.append("captain must be one of the starters")

    mode = golf.missed_cut.mode
    alt1 = lineup.get("alt1", None)
    alt2 = lineup.get("alt2", None)
    if mode == "off":
        if alt1 not in (None,):
            errors.append("alts are disabled for this league")
        if alt2 not in (None,):
            errors.append("alts are disabled for this league")
    else:
        if alt1 is not None:
            try:
                alt1_id = int(alt1)
            except (TypeError, ValueError):
                errors.append("alt1 must be an integer player id")
            else:
                if alt1_id not in roster_ids:
                    errors.append(f"alt1 {alt1_id} is not on the roster")
                if alt1_id in starter_ids:
                    errors.append("alt1 cannot also be a starter")
        if mode == "alt1_2" and alt2 is not None:
            try:
                alt2_id = int(alt2)
            except (TypeError, ValueError):
                errors.append("alt2 must be an integer player id")
            else:
                if alt2_id not in roster_ids:
                    errors.append(f"alt2 {alt2_id} is not on the roster")
                if alt2_id in starter_ids:
                    errors.append("alt2 cannot also be a starter")
                if alt1 is not None and int(alt1) == alt2_id:
                    errors.append("alt1 and alt2 must differ")
        elif mode == "alt1" and alt2 not in (None,):
            errors.append("alt2 is not enabled (missed_cut.mode is alt1)")

    # Tee-time locks: reject changes to players who have already teed off.
    if previous and tee_times:
        prev_starters = [int(x) for x in (previous.get("starters") or [])]
        prev_set = {
            "starters": prev_starters,
            "captain": previous.get("captain"),
            "alt1": previous.get("alt1"),
            "alt2": previous.get("alt2"),
        }
        new_set = {
            "starters": starter_ids,
            "captain": lineup.get("captain"),
            "alt1": lineup.get("alt1"),
            "alt2": lineup.get("alt2"),
        }
        touched: set[int] = set()
        if sorted(prev_starters) != sorted(starter_ids):
            touched |= set(prev_starters) | set(starter_ids)
        for key in ("captain", "alt1", "alt2"):
            if prev_set.get(key) != new_set.get(key):
                for raw in (prev_set.get(key), new_set.get(key)):
                    if raw is None:
                        continue
                    try:
                        touched.add(int(raw))
                    except (TypeError, ValueError):
                        pass
        for pid in sorted(touched):
            if player_is_locked(pid, tee_times=tee_times, now=now):
                errors.append(
                    f"player {pid} is locked (tee time passed); cannot change"
                )

    return errors


def apply_locks(
    lineup: dict[str, Any],
    *,
    tee_times: dict[str, str] | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Stamp per-player lock times for anyone past tee time."""
    clock = now or datetime.now(timezone.utc)
    locks = dict(lineup.get("locks") or {})
    involved: list[int] = []
    involved.extend(int(x) for x in (lineup.get("starters") or []))
    for key in ("captain", "alt1", "alt2"):
        raw = lineup.get(key)
        if raw is not None:
            involved.append(int(raw))
    locked_at = lineup.get("locked_at")
    for pid in involved:
        if player_is_locked(pid, tee_times=tee_times, now=clock):
            locks.setdefault(
                str(pid),
                (tee_times or {}).get(str(pid)) or clock.isoformat(),
            )
    if locks and not locked_at:
        # First lock moment for the lineup card.
        locked_at = min(locks.values())
    return {**lineup, "locks": locks, "locked_at": locked_at}


def build_lineups_payload(
    teams: list[dict[str, Any]],
    settings: GolfSettings | dict[str, Any] | None,
    *,
    season: int,
    saved_at: str | None = None,
    now_iso: str | None = None,
) -> dict[str, Any]:
    """Build ``lineups`` concern: events + default weekly lineups per team."""
    stamp = saved_at or now_iso or FIXTURE_NOW
    clock = parse_utc(now_iso or FIXTURE_NOW)
    all_ids: list[int] = []
    for team in teams:
        for player in team.get("roster") or []:
            if player.get("id") is not None:
                all_ids.append(int(player["id"]))
    # Unique preserve order for tee-time staggering.
    seen: set[int] = set()
    ordered_ids: list[int] = []
    for pid in all_ids:
        if pid not in seen:
            seen.add(pid)
            ordered_ids.append(pid)

    events = [
        build_event_with_tee_times(event, ordered_ids)
        for event in fixture_events(season)
    ]
    current = events[0]["event_id"] if events else None
    team_map: dict[str, dict[str, dict[str, Any]]] = {}
    for team in teams:
        tid = str(team["team_id"])
        roster = list(team.get("roster") or [])
        if not roster:
            continue
        base = default_lineup_from_roster(roster, settings, saved_at=stamp)
        team_map[tid] = {}
        for event in events:
            lined = apply_locks(
                dict(base),
                tee_times=event.get("tee_times"),
                now=clock,
            )
            team_map[tid][event["event_id"]] = lined

    return {
        "period_label": "event",
        "current_event_id": current,
        "events": events,
        "teams": team_map,
    }
