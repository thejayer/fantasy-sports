"""ESPN-wide ownership for hockey players (HOCKEY-PORT.md H7).

``percentOwned`` (% of ESPN leagues rostering the player), ``percentChange``
(7-day change) and ``percentStarted`` come from the league endpoint's
``kona_player_info`` view with an ``x-fantasy-filter`` header. espn-api's
hockey ``Player`` does not keep them, so :func:`attach_hockey_ownership`
fetches them for every rostered player and free agent and writes
``percent_owned`` / ``percent_change`` / ``percent_started`` onto the snapshot
rows before the season write.

Request shape, checked live against hockey-main (2027, preseason): the view
needs ``scoringPeriodId`` **and** a sort (``sortPercOwned``) next to
``filterIds`` or ESPN answers 400; ``kona_playercard`` with bare
``filterIds`` is the fallback.
"""

from __future__ import annotations

import json
import sys
from typing import Any

CHUNK = 50
STATUSES = ["FREEAGENT", "WAIVERS", "ONTEAM"]


def _requests(ids: list[int], period: int) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    return [
        (
            {"view": "kona_player_info", "scoringPeriodId": period},
            {"players": {
                "filterIds": {"value": ids},
                "filterStatus": {"value": STATUSES},
                "limit": len(ids),
                "sortPercOwned": {"sortPriority": 1, "sortAsc": False},
            }},
        ),
        ({"view": "kona_playercard"}, {"players": {"filterIds": {"value": ids}}}),
    ]


def _num(value: Any) -> float | None:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def parse_ownership(payload: dict[str, Any] | None) -> dict[int, dict[str, float | None]]:
    """``{espn_id: {owned, change, started}}`` from a ``players`` payload."""
    out: dict[int, dict[str, float | None]] = {}
    for entry in (payload or {}).get("players") or []:
        if not isinstance(entry, dict):
            continue
        player = entry.get("player") if isinstance(entry.get("player"), dict) else entry
        own = player.get("ownership") or {}
        pid = player.get("id", entry.get("id"))
        if pid is None or own.get("percentOwned") is None:
            continue
        out[int(pid)] = {
            "owned": _num(own.get("percentOwned")),
            "change": _num(own.get("percentChange")),
            "started": _num(own.get("percentStarted")),
        }
    return out


def fetch_espn_ownership(league: Any, ids: list[int]) -> dict[int, dict[str, float | None]]:
    """Ownership for ``ids`` in chunks of 50; the first request shape that works wins.

    Raises only when every chunk failed (so a partial answer still lands).
    """
    request = getattr(getattr(league, "espn_request", None), "league_get", None)
    if request is None or not ids:
        return {}
    period = int(getattr(league, "scoringPeriodId", None) or getattr(league, "current_week", None) or 1)
    out: dict[int, dict[str, float | None]] = {}
    last_error: Exception | None = None
    for start in range(0, len(ids), CHUNK):
        chunk = ids[start:start + CHUNK]
        for params, filters in _requests(chunk, period):
            try:
                payload = request(params=params, headers={"x-fantasy-filter": json.dumps(filters)})
            except Exception as exc:  # noqa: BLE001 - try the next request shape
                last_error = exc
                continue
            out.update(parse_ownership(payload))
            break
    if not out and last_error is not None:
        raise last_error
    return out


def _snapshot_rows(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    rows = [p for team in snapshot.get("teams") or [] for p in team.get("roster") or []]
    return rows + list(snapshot.get("free_agents") or [])


def attach_hockey_ownership(league: Any, snapshot: dict[str, Any]) -> int:
    """Write ownership onto every rostered player and free agent in ``snapshot``.

    Returns how many rows got a value. ESPN failures print to stderr and never
    fail the league-season (ownership is a nice-to-have).
    """
    rows = _snapshot_rows(snapshot)
    ids = sorted({int(p["id"]) for p in rows if p.get("id") is not None})
    try:
        owned = fetch_espn_ownership(league, ids)
    except Exception as exc:  # noqa: BLE001
        print(f"ownership {snapshot.get('league_id')}: failed: {exc}", file=sys.stderr)
        return 0
    hits = 0
    for p in rows:
        got = owned.get(int(p["id"])) if p.get("id") is not None else None
        if not got:
            continue
        p["percent_owned"] = got["owned"]
        p["percent_change"] = got["change"]
        p["percent_started"] = got["started"]
        hits += 1
    print(f"ownership {snapshot.get('league_id')}: {hits}/{len(rows)} players", file=sys.stderr)
    return hits


__all__ = ["attach_hockey_ownership", "fetch_espn_ownership", "parse_ownership"]
