"""Fixture PGA Tour round scores (roadmap 6.4d) — offline, no live tour API."""

from __future__ import annotations

from typing import Any, Literal

RoundStatus = Literal["active", "mc", "wd", "dns"]

# Calendar mapping for a standard Thu–Sun stroke-play event.
ROUND_LABELS: dict[int, str] = {1: "Thu", 2: "Fri", 3: "Sat", 4: "Sun"}
MIDWEEK_ROUNDS = frozenset({1, 2})
WEEKEND_ROUNDS = frozenset({3, 4})


def fixture_player_rounds(
    player_id: int,
    *,
    miss_cut: bool = False,
) -> list[dict[str, Any]]:
    """Deterministic 4-round card for one player.

    Points mode is ``neg_to_par`` (lower to-par → more fantasy points). Spread
    scores by player id so team totals differ without a live feed.
    """
    # Stable pseudo-random-ish to-par in [-4, +4] from id.
    base = ((player_id * 17) % 9) - 4
    rows: list[dict[str, Any]] = []
    for rnd in (1, 2, 3, 4):
        drift = ((player_id + rnd * 3) % 5) - 2
        to_par = int(base + drift)
        if miss_cut and rnd >= 3:
            rows.append(
                {
                    "player_id": player_id,
                    "round": rnd,
                    "to_par": None,
                    "status": "mc",
                }
            )
        elif miss_cut and rnd == 2:
            # Mark cut after Friday; Fri itself still counts as active.
            rows.append(
                {
                    "player_id": player_id,
                    "round": rnd,
                    "to_par": to_par,
                    "status": "active",
                }
            )
        else:
            rows.append(
                {
                    "player_id": player_id,
                    "round": rnd,
                    "to_par": to_par,
                    "status": "active",
                }
            )
    if miss_cut:
        # Explicit Fri night cut stamp on round 2 row is enough; weekend = mc.
        pass
    return rows


def fixture_event_rounds(
    event_id: str,
    player_ids: list[int],
    *,
    miss_cut_every: int = 7,
) -> dict[str, Any]:
    """Build a full event round file for the given field."""
    scores: list[dict[str, Any]] = []
    for pid in player_ids:
        miss = miss_cut_every > 0 and (pid % miss_cut_every == 0)
        scores.extend(fixture_player_rounds(pid, miss_cut=miss))
    return {
        "event_id": event_id,
        "grain": "end_of_day",
        "rounds": scores,
    }


def index_rounds(
    round_file: dict[str, Any],
) -> dict[int, dict[int, dict[str, Any]]]:
    """``player_id → round_num → row``."""
    out: dict[int, dict[int, dict[str, Any]]] = {}
    for row in round_file.get("rounds") or []:
        try:
            pid = int(row["player_id"])
            rnd = int(row["round"])
        except (KeyError, TypeError, ValueError):
            continue
        out.setdefault(pid, {})[rnd] = row
    return out
