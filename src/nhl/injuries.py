"""Injury log (HOCKEY-PORT.md H6): ESPN + Daily Faceoff statuses per sync.

Each sync compares every ESPN player's status (ESPN ``injury_status`` and the
Daily Faceoff injury word from ``lines.json``) with the previous log and
records transitions:

- ``hurt``: healthy → day-to-day / out, or day-to-day → out (worse);
- ``nearing_return``: out → day-to-day;
- ``back``: day-to-day / out → healthy.

The first log for a league-season is a quiet baseline (no events), so turning
the feature on never floods the feed. Stdlib only, like the rest of
``src/nhl``.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

SCHEMA_VERSION = 1
# Keep recent history only; the hub shows the last couple of weeks.
KEEP_DAYS = 45
MAX_EVENTS = 400

HEALTHY, DAY_TO_DAY, OUT = 0, 1, 2
LEVEL_LABEL = {HEALTHY: "healthy", DAY_TO_DAY: "day-to-day", OUT: "out"}

_ESPN_LEVEL = {
    "ACTIVE": HEALTHY,
    "NORMAL": HEALTHY,
    "DAY_TO_DAY": DAY_TO_DAY,
    "QUESTIONABLE": DAY_TO_DAY,
    "DOUBTFUL": DAY_TO_DAY,
    "PROBABLE": DAY_TO_DAY,
    "OUT": OUT,
    "INJURY_RESERVE": OUT,
    "SUSPENSION": OUT,
}
_DFO_LEVEL = {
    "dtd": DAY_TO_DAY,
    "gtd": DAY_TO_DAY,
    "out": OUT,
    "ir": OUT,
    "ltir": OUT,
    "suspended": OUT,
}


def espn_level(status: Any) -> int | None:
    """ESPN ``injury_status`` → level; None when ESPN sent nothing."""
    if status is None or status == "":
        return None
    return _ESPN_LEVEL.get(str(status).upper(), HEALTHY)


def dfo_level(line: dict[str, Any] | None) -> int | None:
    """Daily Faceoff level for one ``lines.json`` player; None when unlisted."""
    if not isinstance(line, dict):
        return None
    word = str(line.get("injury") or "").lower()
    if word:
        return _DFO_LEVEL.get(word, DAY_TO_DAY)
    if line.get("gtd"):
        return DAY_TO_DAY
    return HEALTHY


def combined_level(espn: int | None, dfo: int | None) -> int:
    """The worse of the two sources (unknown counts as healthy)."""
    return max(espn or HEALTHY, dfo or HEALTHY)


def current_statuses(
    snapshot: dict[str, Any] | None,
    player_map: dict[str, Any] | None,
    lines: dict[str, Any] | None,
    previous: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """``{espn_id: {name, team_id, nhl_team, espn, dfo, level}}`` right now.

    Without a snapshot (the afternoon lines job) ESPN statuses and rosters are
    carried over from ``previous``; only the Daily Faceoff side is refreshed.
    """
    mapped = (player_map or {}).get("players") or {}
    dfo_players = (lines or {}).get("players") or {}
    out: dict[str, dict[str, Any]] = {}

    def dfo_for(espn_id: str) -> tuple[str | None, int | None]:
        nhl_id = (mapped.get(espn_id) or {}).get("nhl_id")
        line = dfo_players.get(str(nhl_id)) if nhl_id is not None else None
        if line is None:
            return None, None
        word = line.get("injury") or ("gtd" if line.get("gtd") else None)
        return word, dfo_level(line)

    if snapshot is not None:
        rows: list[tuple[dict[str, Any], int | None]] = []
        for team in snapshot.get("teams") or []:
            for p in team.get("roster") or []:
                rows.append((p, team.get("team_id")))
        for p in snapshot.get("free_agents") or []:
            rows.append((p, None))
        for p, team_id in rows:
            if p.get("id") is None:
                continue
            espn_id = str(p["id"])
            if espn_id in out:
                continue
            word, dfo = dfo_for(espn_id)
            espn = espn_level(p.get("injury_status"))
            out[espn_id] = {
                "name": p.get("name"),
                "team_id": team_id,
                "slot": p.get("slot"),
                "nhl_team": (mapped.get(espn_id) or {}).get("nhl_team") or p.get("pro_team"),
                "espn": p.get("injury_status") or None,
                "dfo": word,
                "level": combined_level(espn, dfo),
            }
        return out

    for espn_id, prev in ((previous or {}).get("players") or {}).items():
        word, dfo = dfo_for(espn_id)
        out[espn_id] = {
            **{k: prev.get(k) for k in ("name", "team_id", "slot", "nhl_team", "espn")},
            "dfo": word,
            "level": combined_level(espn_level(prev.get("espn")), dfo),
        }
    return out


def transition(before: int, after: int) -> str | None:
    if after > before:
        return "hurt"
    if before == OUT and after == DAY_TO_DAY:
        return "nearing_return"
    if before > HEALTHY and after == HEALTHY:
        return "back"
    return None


def update_injury_log(
    previous: dict[str, Any] | None,
    current: dict[str, dict[str, Any]],
    *,
    header: dict[str, Any],
    at: str,
    source: str,
) -> dict[str, Any]:
    """Merge ``current`` into ``previous`` and append new transitions.

    ``at`` is the sync timestamp (ISO); ``source`` names the job ("sync" /
    "lines"). A player missing from ``current`` keeps the previous entry.
    """
    prev_players = (previous or {}).get("players") or {}
    baseline = previous is None
    players: dict[str, dict[str, Any]] = dict(prev_players)
    events: list[dict[str, Any]] = list((previous or {}).get("events") or [])
    day = at[:10]
    for espn_id, now in current.items():
        before = prev_players.get(espn_id)
        before_level = int(before["level"]) if before else HEALTHY
        kind = None if baseline or before is None else transition(before_level, now["level"])
        since = before.get("since") if before and before_level == now["level"] else day
        players[espn_id] = {**now, "since": since}
        if kind:
            events.append({
                "id": f"{espn_id}:{at}",
                "at": at,
                "espn_id": espn_id,
                "name": now.get("name"),
                "team_id": now.get("team_id"),
                "nhl_team": now.get("nhl_team"),
                "kind": kind,
                "from": LEVEL_LABEL[before_level],
                "to": LEVEL_LABEL[now["level"]],
                "espn": now.get("espn"),
                "dfo": now.get("dfo"),
                "source": source,
            })
    cutoff = (dt.date.fromisoformat(day) - dt.timedelta(days=KEEP_DAYS)).isoformat()
    events = [e for e in events if str(e.get("at", ""))[:10] >= cutoff][-MAX_EVENTS:]
    return {
        **header,
        "schema_version": SCHEMA_VERSION,
        "updated_at": at,
        "baseline": baseline and not events,
        "players": players,
        "events": events,
    }


__all__ = [
    "DAY_TO_DAY",
    "HEALTHY",
    "OUT",
    "combined_level",
    "current_statuses",
    "dfo_level",
    "espn_level",
    "transition",
    "update_injury_log",
]
