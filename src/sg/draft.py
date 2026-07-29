"""Offline snake draft over the synthetic OWGR pool (roadmap 6.4b).

Auction / keepers stay settings stubs — this runner only implements snake.
Picks use the same ``DraftPick`` shape as ESPN ``serialize_draft`` so the
hub ``DraftResultsPanel`` works unchanged.
"""

from __future__ import annotations

from typing import Any

from sg.pool import OwgrPlayer, owgr_pool, player_row, pool_size_for_league
from sg.settings import STARTERS, GolfSettings, validate_golf_settings


def snake_pick_order(team_ids: list[int], rounds: int) -> list[tuple[int, int, int]]:
    """Return (round, round_pick, team_id) for a classic snake draft."""
    if rounds < 1:
        raise ValueError("rounds must be >= 1")
    if len(team_ids) < 2:
        raise ValueError("snake draft needs at least 2 teams")
    order = list(team_ids)
    picks: list[tuple[int, int, int]] = []
    for rnd in range(1, rounds + 1):
        round_order = order if rnd % 2 == 1 else list(reversed(order))
        for pick_num, team_id in enumerate(round_order, start=1):
            picks.append((rnd, pick_num, team_id))
    return picks


def run_snake_draft(
    teams: list[dict[str, Any]],
    settings: GolfSettings | dict[str, Any] | None = None,
    *,
    pool: list[OwgrPlayer] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Draft into team rosters.

    Returns ``(draft_picks, players, free_agents)``. Mutates ``teams`` in place
    (fills each ``roster``). First ``starters`` picks per team use slot ``GS``;
    the rest use ``BE`` until weekly lineup (6.4c).
    """
    golf = validate_golf_settings(settings)
    if golf.draft.style != "snake":
        raise ValueError(
            f"run_snake_draft only supports snake (got {golf.draft.style!r}); "
            "auction UI is post-MVP"
        )

    starters = golf.roster.starters or STARTERS
    bench = golf.roster.bench
    rounds = starters + bench
    team_ids = [int(team["team_id"]) for team in teams]
    by_id = {int(team["team_id"]): team for team in teams}

    size = pool_size_for_league(
        team_count=len(teams), starters=starters, bench=bench
    )
    board = list(pool) if pool is not None else owgr_pool(size)
    if len(board) < len(teams) * rounds:
        raise ValueError(
            f"OWGR pool has {len(board)} players; need {len(teams) * rounds} "
            f"for {rounds} rounds"
        )

    for team in teams:
        team["roster"] = []

    draft_picks: list[dict[str, Any]] = []
    cursor = 0
    for rnd, pick_num, team_id in snake_pick_order(team_ids, rounds):
        golfer = board[cursor]
        cursor += 1
        team = by_id[team_id]
        slot = "GS" if len(team["roster"]) < starters else "BE"
        row = player_row(golfer, slot=slot)
        team["roster"].append(row)
        draft_picks.append(
            {
                "round": rnd,
                "round_pick": pick_num,
                "team_id": team_id,
                "player_id": golfer["id"],
                "player_name": golfer["name"],
                "bid_amount": 0,
                "keeper": False,
                "nominating_team_id": None,
            }
        )

    players = _unique_players(teams)
    free_agents = [
        player_row(golfer, slot="FA") for golfer in board[cursor:]
    ]
    return draft_picks, players, free_agents


def _unique_players(teams: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[Any, dict[str, Any]] = {}
    for team in teams:
        for player in team.get("roster") or []:
            key = player.get("id")
            if key is None:
                continue
            if key not in seen:
                seen[key] = {
                    **player,
                    "fantasy_team": team.get("name"),
                }
    return sorted(
        seen.values(),
        key=lambda row: (
            (row.get("season_stats") or {}).get("OWGR") or 9999,
            row.get("name") or "",
        ),
    )
