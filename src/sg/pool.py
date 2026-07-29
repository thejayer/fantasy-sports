"""Synthetic OWGR draft pool for offline fixtures (roadmap 6.4b).

Not a live ranking feed — stable ids + names so snake drafts and hub UI
work without tour APIs. Top rows use recognizable PGA names; the rest are
numbered fillers so large leagues (14 × 25) still draft cleanly.
"""

from __future__ import annotations

from typing import Any, TypedDict


class OwgrPlayer(TypedDict):
    id: int
    name: str
    owgr_rank: int
    country: str | None


# Recognizable top of the pool (ids = OWGR-ish ranks for fixture stability).
_NAMED_POOL: tuple[tuple[str, str | None], ...] = (
    ("Scottie Scheffler", "USA"),
    ("Rory McIlroy", "NIR"),
    ("Xander Schauffele", "USA"),
    ("Collin Morikawa", "USA"),
    ("Ludvig Aberg", "SWE"),
    ("Jon Rahm", "ESP"),
    ("Wyndham Clark", "USA"),
    ("Viktor Hovland", "NOR"),
    ("Patrick Cantlay", "USA"),
    ("Tommy Fleetwood", "ENG"),
    ("Hideki Matsuyama", "JPN"),
    ("Justin Thomas", "USA"),
    ("Sahith Theegala", "USA"),
    ("Max Homa", "USA"),
    ("Brian Harman", "USA"),
    ("Matt Fitzpatrick", "ENG"),
    ("Tony Finau", "USA"),
    ("Sam Burns", "USA"),
    ("Jordan Spieth", "USA"),
    ("Shane Lowry", "IRL"),
    ("Russell Henley", "USA"),
    ("Sungjae Im", "KOR"),
    ("Jason Day", "AUS"),
    ("Tom Kim", "KOR"),
    ("Sepp Straka", "AUT"),
    ("Chris Kirk", "USA"),
    ("Byeong Hun An", "KOR"),
    ("Cameron Young", "USA"),
    ("Keegan Bradley", "USA"),
    ("Adam Scott", "AUS"),
    ("Billy Horschel", "USA"),
    ("Corey Conners", "CAN"),
    ("Si Woo Kim", "KOR"),
    ("Harris English", "USA"),
    ("Aaron Rai", "ENG"),
    ("Akira Aoyama", "JPN"),
    ("Denny McCarthy", "USA"),
    ("Eric Cole", "USA"),
    ("Stephan Jaeger", "GER"),
    ("Alex Noren", "SWE"),
    ("Min Woo Lee", "AUS"),
    ("Nick Taylor", "CAN"),
    ("Will Zalatoris", "USA"),
    ("Davis Thompson", "USA"),
    ("J.T. Poston", "USA"),
    ("Adam Hadwin", "CAN"),
    ("Taylor Pendrith", "CAN"),
    ("Austin Eckroat", "USA"),
    ("Jake Knapp", "USA"),
    ("Nicolai Hojgaard", "DEN"),
)


def owgr_pool(size: int) -> list[OwgrPlayer]:
    """Return the first ``size`` synthetic OWGR rows (rank 1..size)."""
    if size < 1:
        raise ValueError("OWGR pool size must be >= 1")
    players: list[OwgrPlayer] = []
    for rank in range(1, size + 1):
        if rank <= len(_NAMED_POOL):
            name, country = _NAMED_POOL[rank - 1]
        else:
            name = f"OWGR Golfer {rank}"
            country = None
        players.append(
            {
                "id": rank,
                "name": name,
                "owgr_rank": rank,
                "country": country,
            }
        )
    return players


def pool_size_for_league(*, team_count: int, starters: int, bench: int) -> int:
    """Pool covers a full draft plus a small undrafted buffer for FA display."""
    needed = team_count * (starters + bench)
    # Buffer so free_agents is non-empty after a full snake draft.
    return max(needed + 20, needed + team_count)


def player_row(golfer: OwgrPlayer, *, slot: str) -> dict[str, Any]:
    """Hub/ESPN-shaped player dict for a golf roster or FA row."""
    return {
        "id": golfer["id"],
        "name": golfer["name"],
        "position": "G",
        "slot": slot,
        "pro_team": golfer.get("country"),
        "injury_status": None,
        "status": "ACTIVE",
        "injured": False,
        "eligible_slots": ["GS", "BE", "ALT"],
        "acquisition_type": "DRAFT" if slot != "FA" else "FREEAGENT",
        "percent_owned": None,
        "total_points": 0.0,
        "projected_total_points": None,
        "avg_points": None,
        "season_stats": {"OWGR": float(golfer["owgr_rank"])},
        "role": "golfer",
    }
