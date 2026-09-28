"""Fixture FedExCup event slate for golf lineups (roadmap 6.4c).

Synthetic events + per-player tee times (UTC). Not a live tour feed — 6.4d
owns scoring; this unblocks weekly lineup locks fail-closed.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

# Fixed fixture "anchor" so regenerating fixtures stays deterministic.
FIXTURE_NOW = "2026-03-12T14:00:00+00:00"


def fixture_events(season: int) -> list[dict[str, Any]]:
    """Two counting events for offline demos / CI.

    ``segment_id`` groups events for per-segment start caps (roadmap 8.3).
    ``through_round`` stamps how many EOD rounds have landed (1–4); fixtures
    stay final (4) so standings stay stable — unit tests cover in-progress.
    """
    return [
        {
            "event_id": f"{season}-players",
            "name": "THE PLAYERS Championship",
            "week": 1,
            "starts_at": f"{season}-03-12T12:00:00+00:00",
            "multiplier_tier": "signature",
            "segment_id": "early",
            "through_round": 4,
        },
        {
            "event_id": f"{season}-masters",
            "name": "Masters Tournament",
            "week": 2,
            "starts_at": f"{season}-04-09T12:00:00+00:00",
            "multiplier_tier": "major",
            "segment_id": "early",
            "through_round": 4,
        },
    ]


def tee_times_for_roster(
    player_ids: list[int],
    *,
    event_starts_at: str,
) -> dict[str, str]:
    """Stagger R1 tee times from event start (30 min waves)."""
    start = datetime.fromisoformat(event_starts_at.replace("Z", "+00:00"))
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    out: dict[str, str] = {}
    for index, player_id in enumerate(player_ids):
        tee = start + timedelta(minutes=30 * index)
        out[str(player_id)] = tee.isoformat().replace("+00:00", "+00:00")
    return out


def build_event_with_tee_times(
    event: dict[str, Any],
    player_ids: list[int],
) -> dict[str, Any]:
    return {
        **event,
        "tee_times": tee_times_for_roster(
            player_ids, event_starts_at=str(event["starts_at"])
        ),
    }
