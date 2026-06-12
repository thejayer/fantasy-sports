"""Monte Carlo snake-draft simulator.

The user picks at a fixed slot in the order; opponents pick by ADP with
multiplicative noise (so a player with ADP 12 will sometimes go at 8 and
sometimes at 20). The user picks by maximum VOR among eligible candidates
for their remaining roster needs.

This is the simplest sim that produces actionable insight: by running
many drafts, you get the distribution of rosters you might actually end
up with, plus per-player "probability available at my next pick" -- the
core number for planning two picks ahead.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ffa.league import RosterRules

_FLEX_POSITIONS: tuple[str, ...] = ("RB", "WR", "TE")


@dataclass(frozen=True)
class DraftResult:
    """Aggregated outcomes across simulated drafts."""

    user_picks: pd.DataFrame  # long: (sim, round, player_id, position, value, ...)
    availability: pd.DataFrame  # per-player probability of being available at each user round


def _snake_order(teams: int, rounds: int, user_slot: int) -> list[int]:
    """Return the team that picks at each overall pick, 1-indexed.

    With snake (a.k.a. reverse) drafting, round 1 picks 1..teams, round 2
    picks teams..1, etc. ``user_slot`` is the user's 1-indexed slot.
    """
    if not 1 <= user_slot <= teams:
        raise ValueError(f"user_slot must be in [1, {teams}], got {user_slot}.")
    order = []
    for r in range(rounds):
        if r % 2 == 0:
            order.extend(range(1, teams + 1))
        else:
            order.extend(range(teams, 0, -1))
    return order


def _slot_needs(roster: RosterRules) -> dict[str, int]:
    """Per-user roster slot counts to fill, FLEX kept separate."""
    return {
        "QB": int(roster.qb),
        "RB": int(roster.rb),
        "WR": int(roster.wr),
        "TE": int(roster.te),
        "FLEX": int(roster.flex),
        "BENCH": int(roster.bench),
    }


def _eligible_for_slot(slot: str, position: str) -> bool:
    pos = position.upper()
    if slot == "FLEX":
        return pos in _FLEX_POSITIONS
    if slot == "BENCH":
        return pos in _FLEX_POSITIONS + ("QB",)
    return slot == pos


def _user_pick(
    available_idx: np.ndarray,
    positions: np.ndarray,
    values: np.ndarray,
    needs: dict[str, int],
) -> int:
    """Choose the best available player consistent with remaining needs.

    Strategy: among all available players whose position can fill any
    still-needed slot, pick the one with the highest value.
    """
    open_slots = [s for s, n in needs.items() if n > 0]
    if not open_slots:
        return -1
    best_value = -np.inf
    best = -1
    for i in available_idx:
        pos = str(positions[i]).upper()
        if any(_eligible_for_slot(s, pos) for s in open_slots):
            if values[i] > best_value:
                best_value = values[i]
                best = int(i)
    return best


def _assign_to_slot(position: str, needs: dict[str, int]) -> str:
    """Decrement the first slot that this position fills, return the slot name."""
    pos = position.upper()
    # Specific slots take priority over FLEX/BENCH.
    for slot in ("QB", "RB", "WR", "TE"):
        if pos == slot and needs.get(slot, 0) > 0:
            needs[slot] -= 1
            return slot
    if pos in _FLEX_POSITIONS and needs.get("FLEX", 0) > 0:
        needs["FLEX"] -= 1
        return "FLEX"
    if needs.get("BENCH", 0) > 0:
        needs["BENCH"] -= 1
        return "BENCH"
    return "OVERFLOW"


def simulate_draft(
    values: pd.DataFrame,
    roster: RosterRules,
    user_slot: int,
    n_sims: int = 500,
    adp: pd.Series | None = None,
    opponent_noise: float = 0.25,
    rounds: int | None = None,
    value_col: str = "vor",
    position_col: str = "position",
    id_col: str = "player_id",
    seed: int | None = None,
) -> DraftResult:
    """Simulate ``n_sims`` snake drafts.

    Opponent behavior: each opponent samples a noisy ADP for every player
    (``adp * exp(N(0, opponent_noise))``), then picks the player with the
    lowest noisy ADP that fills a remaining slot. ``opponent_noise`` of
    0.25 corresponds to a stddev of ~25% on the ADP rank, which roughly
    matches observed draft variability in public mock data.

    User behavior: picks the available player with highest ``value_col``
    that can fill any remaining open slot in the user's roster.

    Args:
        values: candidate pool. Must contain id, position, and value cols.
        roster: league roster config; defines team count and slots.
        user_slot: user's 1-indexed draft slot.
        n_sims: number of drafts to simulate.
        adp: optional Series mapping player_id -> ADP. If absent, ADP is
            inferred from each player's value rank within the pool.
        opponent_noise: stddev of log-normal multiplier on ADP per pick.
        rounds: total rounds to draft. Defaults to the sum of starter +
            bench slots so every team fills its roster.
        seed: RNG seed for reproducibility.

    Returns:
        :class:`DraftResult` with the user's picks across sims and the
        availability matrix (probability each player is still on the
        board at each of the user's picks).
    """
    needs_template = _slot_needs(roster)
    total_per_team = sum(needs_template.values())
    if rounds is None:
        rounds = total_per_team

    n_players = len(values)
    teams = int(roster.teams)
    if teams * rounds > n_players:
        raise ValueError(
            f"Pool of {n_players} candidates can't fill {teams}*{rounds}={teams * rounds} picks."
        )

    rng = np.random.default_rng(seed)

    # Inferred ADP: rank by value descending if not provided.
    if adp is None:
        adp_series = values[value_col].rank(method="min", ascending=False).astype(float)
        adp_series.index = values[id_col]
    else:
        adp_series = adp.reindex(values[id_col]).fillna(adp.max() + 1).astype(float)
        adp_series.index = values[id_col]

    positions = values[position_col].to_numpy()
    vals = values[value_col].to_numpy(dtype=float)
    ids = values[id_col].to_numpy()
    adp_arr = adp_series.to_numpy(dtype=float)

    pick_order_team = _snake_order(teams, rounds, user_slot)
    user_overall_picks = [i + 1 for i, t in enumerate(pick_order_team) if t == user_slot]

    user_pick_records: list[dict] = []
    # availability[round_idx, player_idx] += 1 each sim that the player
    # is still on the board at the user's pick in that round.
    availability_counts = np.zeros((len(user_overall_picks), n_players), dtype=np.int64)

    for sim in range(n_sims):
        available_mask = np.ones(n_players, dtype=bool)
        sim_needs: dict[int, dict[str, int]] = {
            t: dict(needs_template) for t in range(1, teams + 1)
        }

        user_round = 0
        for pick_idx, team in enumerate(pick_order_team):
            is_user = team == user_slot
            available_idx = np.where(available_mask)[0]
            if len(available_idx) == 0:
                break

            if is_user:
                availability_counts[user_round, available_idx] += 1
                chosen = _user_pick(available_idx, positions, vals, sim_needs[team])
            else:
                # Opponent: log-normal-noised ADP among eligible-for-needs.
                noise = rng.normal(0.0, opponent_noise, size=available_idx.shape)
                noisy_adp = adp_arr[available_idx] * np.exp(noise)
                # Filter to picks that fill any open slot for this team
                open_slots = [s for s, n in sim_needs[team].items() if n > 0]
                eligible_local = np.array(
                    [
                        any(_eligible_for_slot(s, str(positions[i])) for s in open_slots)
                        for i in available_idx
                    ],
                    dtype=bool,
                )
                if not eligible_local.any():
                    eligible_local = np.ones_like(eligible_local)
                noisy_adp_masked = np.where(eligible_local, noisy_adp, np.inf)
                chosen_local = int(np.argmin(noisy_adp_masked))
                chosen = int(available_idx[chosen_local])

            if chosen < 0:
                continue
            slot = _assign_to_slot(str(positions[chosen]), sim_needs[team])
            available_mask[chosen] = False

            if is_user:
                user_pick_records.append(
                    {
                        "sim": sim,
                        "round": user_round + 1,
                        "overall_pick": pick_idx + 1,
                        "player_id": ids[chosen],
                        "position": positions[chosen],
                        "value": vals[chosen],
                        "slot": slot,
                    }
                )
                user_round += 1

    user_picks = pd.DataFrame(user_pick_records)
    availability_df = pd.DataFrame(
        availability_counts / max(n_sims, 1),
        columns=ids,
        index=pd.Index([f"round_{r + 1}" for r in range(len(user_overall_picks))], name="user_round"),
    ).T
    availability_df.index.name = id_col
    availability_df = availability_df.reset_index()

    return DraftResult(user_picks=user_picks, availability=availability_df)


def summarize_user_picks(user_picks: pd.DataFrame, top: int = 25) -> pd.DataFrame:
    """How often was each player picked by the user, and at what value?"""
    if user_picks.empty:
        return user_picks
    grouped = user_picks.groupby("player_id")
    out = pd.DataFrame(
        {
            "pick_rate": grouped.size() / user_picks["sim"].nunique(),
            "avg_round": grouped["round"].mean(),
            "avg_value": grouped["value"].mean(),
            "position": grouped["position"].first(),
        }
    ).sort_values("pick_rate", ascending=False)
    return out.head(top).reset_index()
