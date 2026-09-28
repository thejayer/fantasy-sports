"""Offline OWGR drafts — snake + auction, optional keepers.

Picks use the ESPN ``DraftPick`` shape so hub ``DraftResultsPanel`` works.
Auction establishes acquisition cost (``bid_amount``); no weekly salary.
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


def keeper_cost(budget: int, roster_slots: int) -> int:
    """Flat offline keeper price — leaves room for auction fill."""
    if roster_slots < 1:
        return 1
    return max(1, min(20, budget // (roster_slots * 2)))


def run_golf_draft(
    teams: list[dict[str, Any]],
    settings: GolfSettings | dict[str, Any] | None = None,
    *,
    pool: list[OwgrPlayer] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Dispatch snake or auction from ``settings.draft.style``."""
    golf = validate_golf_settings(settings)
    if golf.draft.style == "auction":
        return run_auction_draft(teams, golf, pool=pool)
    return run_snake_draft(teams, golf, pool=pool)


# Back-compat alias for callers/tests.
run_draft = run_golf_draft


def run_snake_draft(
    teams: list[dict[str, Any]],
    settings: GolfSettings | dict[str, Any] | None = None,
    *,
    pool: list[OwgrPlayer] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Snake-draft into team rosters. First ``keeper_slots`` rounds are keepers."""
    golf = validate_golf_settings(settings)
    if golf.draft.style != "snake":
        raise ValueError(f"run_snake_draft only supports snake (got {golf.draft.style!r})")

    starters = golf.roster.starters or STARTERS
    bench = golf.roster.bench
    rounds = starters + bench
    keeper_slots = golf.draft.keeper_slots if golf.draft.keepers else 0
    if keeper_slots > rounds:
        raise ValueError("keeper_slots cannot exceed roster size")

    team_ids = [int(team["team_id"]) for team in teams]
    by_id = {int(team["team_id"]): team for team in teams}

    size = pool_size_for_league(team_count=len(teams), starters=starters, bench=bench)
    board = list(pool) if pool is not None else owgr_pool(size)
    if len(board) < len(teams) * rounds:
        raise ValueError(
            f"OWGR pool has {len(board)} players; need {len(teams) * rounds} for {rounds} rounds"
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
                "keeper": rnd <= keeper_slots,
                "nominating_team_id": None,
            }
        )

    players = _unique_players(teams)
    free_agents = [player_row(golfer, slot="FA") for golfer in board[cursor:]]
    return draft_picks, players, free_agents


def run_auction_draft(
    teams: list[dict[str, Any]],
    settings: GolfSettings | dict[str, Any] | None = None,
    *,
    pool: list[OwgrPlayer] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Deterministic offline auction over the OWGR pool.

    1. Optional keeper phase (snake order, flat cost from budget).
    2. Nominate remaining players in rotating team order; bid = max spendable
       leaving $1 per remaining open slot; price = 1 or second-max+1.
    """
    golf = validate_golf_settings(settings)
    if golf.draft.style != "auction":
        raise ValueError(f"run_auction_draft only supports auction (got {golf.draft.style!r})")

    starters = golf.roster.starters or STARTERS
    bench = golf.roster.bench
    roster_slots = starters + bench
    keeper_slots = golf.draft.keeper_slots if golf.draft.keepers else 0
    if keeper_slots > roster_slots:
        raise ValueError("keeper_slots cannot exceed roster size")

    team_ids = [int(team["team_id"]) for team in teams]
    by_id = {int(team["team_id"]): team for team in teams}
    budget = int(golf.draft.budget)
    budgets = {tid: budget for tid in team_ids}
    cost = keeper_cost(budget, roster_slots)

    size = pool_size_for_league(team_count=len(teams), starters=starters, bench=bench)
    board = list(pool) if pool is not None else owgr_pool(size)
    if len(board) < len(teams) * roster_slots:
        raise ValueError(f"OWGR pool has {len(board)} players; need {len(teams) * roster_slots}")

    for team in teams:
        team["roster"] = []

    draft_picks: list[dict[str, Any]] = []
    cursor = 0

    # --- Keepers (snake) ---
    if keeper_slots > 0:
        for rnd, pick_num, team_id in snake_pick_order(team_ids, keeper_slots):
            if budgets[team_id] < cost:
                raise ValueError(
                    f"team {team_id} cannot afford keeper cost {cost} "
                    f"with budget {budgets[team_id]}"
                )
            golfer = board[cursor]
            cursor += 1
            team = by_id[team_id]
            slot = "GS" if len(team["roster"]) < starters else "BE"
            team["roster"].append(player_row(golfer, slot=slot))
            budgets[team_id] -= cost
            draft_picks.append(
                {
                    "round": rnd,
                    "round_pick": pick_num,
                    "team_id": team_id,
                    "player_id": golfer["id"],
                    "player_name": golfer["name"],
                    "bid_amount": cost,
                    "keeper": True,
                    "nominating_team_id": team_id,
                }
            )

    # --- Auction fill ---
    auction_round = keeper_slots + 1
    nominator_idx = 0
    while any(len(by_id[tid]["roster"]) < roster_slots for tid in team_ids):
        # Skip nominators who are full.
        started = nominator_idx
        while len(by_id[team_ids[nominator_idx]]["roster"]) >= roster_slots:
            nominator_idx = (nominator_idx + 1) % len(team_ids)
            if nominator_idx == started:
                break
        nominator = team_ids[nominator_idx]
        if len(by_id[nominator]["roster"]) >= roster_slots:
            break

        golfer = board[cursor]
        cursor += 1

        max_bids: dict[int, int] = {}
        for tid in team_ids:
            open_slots = roster_slots - len(by_id[tid]["roster"])
            if open_slots <= 0:
                continue
            # Leave $1 for each remaining slot after this purchase.
            max_bids[tid] = budgets[tid] - (open_slots - 1)
        eligible = {tid: bid for tid, bid in max_bids.items() if bid >= 1}
        if not eligible:
            raise ValueError("auction stalled: no team can bid $1")

        winner = min(
            eligible,
            key=lambda tid: (
                -eligible[tid],
                len(by_id[tid]["roster"]),
                tid,
            ),
        )
        others = [eligible[tid] for tid in eligible if tid != winner]
        if not others:
            price = 1
        else:
            price = min(eligible[winner], max(others) + 1)
        price = max(1, min(price, eligible[winner]))

        team = by_id[winner]
        slot = "GS" if len(team["roster"]) < starters else "BE"
        team["roster"].append(player_row(golfer, slot=slot))
        budgets[winner] -= price
        pick_num = sum(1 for p in draft_picks if p["round"] == auction_round) + 1
        draft_picks.append(
            {
                "round": auction_round,
                "round_pick": pick_num,
                "team_id": winner,
                "player_id": golfer["id"],
                "player_name": golfer["name"],
                "bid_amount": price,
                "keeper": False,
                "nominating_team_id": nominator,
            }
        )
        # Advance nominator each nomination; bump auction "round" when wrap.
        nominator_idx = (nominator_idx + 1) % len(team_ids)
        if nominator_idx == 0:
            auction_round += 1

    players = _unique_players(teams)
    free_agents = [player_row(golfer, slot="FA") for golfer in board[cursor:]]
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
