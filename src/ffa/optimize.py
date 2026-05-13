"""Roster optimization as an integer linear program.

For an auction league with a budget, this picks the lineup that
maximizes total VOR (or any value column) subject to:

    - per-position slot counts (qb, rb, wr, te, k, dst)
    - one flex slot (RB/WR/TE eligible)
    - total cost <= budget (only if costs and budget are supplied)
    - each player picked at most once

For redraft / non-auction leagues there's no budget constraint, so the
ILP collapses to: take the top ``qb`` QBs, top ``rb`` RBs, etc., plus
the best remaining RB/WR/TE for flex. PuLP handles both cleanly with one
formulation.

K/DST scoring is not yet implemented in the scoring engine, so this
optimizer is QB/RB/WR/TE-only by default. Pass ``include_kdst=True``
once you wire up kicker/defense projections.
"""

from __future__ import annotations

from typing import Iterable

import pandas as pd
import pulp

from ffa.league import RosterRules

_FLEX_POSITIONS: tuple[str, ...] = ("RB", "WR", "TE")


def optimize_lineup(
    values: pd.DataFrame,
    roster: RosterRules,
    costs: pd.Series | None = None,
    budget: float | None = None,
    value_col: str = "vor",
    position_col: str = "position",
    id_col: str = "player_id",
    include_kdst: bool = False,
) -> pd.DataFrame:
    """Solve the ILP and return the chosen lineup.

    Args:
        values: one row per candidate; must contain ``id_col``,
            ``position_col``, and ``value_col``.
        roster: league roster configuration.
        costs: optional Series indexed by ``id_col`` giving each player's
            cost. Required if ``budget`` is set.
        budget: optional total-cost cap. If None, the cost constraint is
            omitted (redraft / draft-pick optimization).
        value_col: column to maximize over (typically ``vor`` or
            ``points_mean``).
        position_col: column holding the position string.
        id_col: column holding the unique player identifier.
        include_kdst: include K/DST slots in the lineup. Off by default
            since the scoring engine doesn't yet compute K/DST points.

    Returns:
        Sub-DataFrame of ``values`` containing only selected players,
        with a ``slot`` column indicating which roster slot each player
        was assigned to (``"QB"``, ``"RB"``, ..., ``"FLEX"``).
    """
    if (budget is None) != (costs is None):
        raise ValueError("Provide both `costs` and `budget`, or neither.")

    required = {id_col, position_col, value_col}
    missing = required - set(values.columns)
    if missing:
        raise ValueError(f"values is missing required columns: {sorted(missing)}")

    if values[id_col].duplicated().any():
        raise ValueError(f"Duplicate {id_col} values in input.")

    slot_counts = {
        "QB": roster.qb,
        "RB": roster.rb,
        "WR": roster.wr,
        "TE": roster.te,
        "FLEX": roster.flex,
    }
    if include_kdst:
        slot_counts["K"] = roster.k
        slot_counts["DST"] = roster.dst
    slot_counts = {s: int(n) for s, n in slot_counts.items() if n > 0}

    eligible_for: dict[str, set[str]] = {
        "QB": {"QB"},
        "RB": {"RB"},
        "WR": {"WR"},
        "TE": {"TE"},
        "K": {"K"},
        "DST": {"DST"},
        "FLEX": set(_FLEX_POSITIONS),
    }

    prob = pulp.LpProblem("ffa_lineup", pulp.LpMaximize)

    # Binary x[slot, player_id] = 1 if the player fills that slot.
    x: dict[tuple[str, str], pulp.LpVariable] = {}
    for slot in slot_counts:
        slot_eligible = eligible_for[slot]
        for _, row in values.iterrows():
            if str(row[position_col]).upper() in slot_eligible:
                x[(slot, row[id_col])] = pulp.LpVariable(
                    f"x_{slot}_{row[id_col]}", lowBound=0, upBound=1, cat="Binary"
                )

    # Objective: maximize total value selected.
    value_lookup = dict(zip(values[id_col], values[value_col]))
    prob += pulp.lpSum(value_lookup[pid] * var for (slot, pid), var in x.items())

    # Each slot has exactly `count` players (or fewer if not enough exist).
    for slot, count in slot_counts.items():
        prob += pulp.lpSum(var for (s, _), var in x.items() if s == slot) <= count

    # Each player picked at most once across slots.
    for pid in values[id_col]:
        slot_vars = [var for (s, p), var in x.items() if p == pid]
        if slot_vars:
            prob += pulp.lpSum(slot_vars) <= 1

    if budget is not None:
        if not isinstance(costs, pd.Series):
            raise TypeError("costs must be a pandas Series when budget is set.")
        prob += (
            pulp.lpSum(float(costs.get(pid, 0.0)) * var for (_, pid), var in x.items())
            <= float(budget)
        )

    status = prob.solve(pulp.PULP_CBC_CMD(msg=False))
    if pulp.LpStatus[status] != "Optimal":
        raise RuntimeError(f"ILP did not solve to optimality (status={pulp.LpStatus[status]}).")

    chosen: list[tuple[str, str]] = [
        (slot, pid) for (slot, pid), var in x.items() if var.value() and var.value() > 0.5
    ]
    if not chosen:
        return values.iloc[0:0].assign(slot=pd.Series(dtype=str))

    chosen_df = pd.DataFrame(chosen, columns=["slot", id_col])
    out = chosen_df.merge(values, on=id_col, how="left")
    return out.sort_values(["slot", value_col], ascending=[True, False]).reset_index(drop=True)


def greedy_lineup(
    values: pd.DataFrame,
    roster: RosterRules,
    value_col: str = "vor",
    position_col: str = "position",
    id_col: str = "player_id",
) -> pd.DataFrame:
    """Greedy lineup without budget constraints. Useful as an ILP-free sanity check.

    Fills slots in order QB/RB/WR/TE then FLEX, taking the best available
    eligible player each time. With no budget this matches the ILP
    optimum on standard rosters.
    """
    sorted_v = values.sort_values(value_col, ascending=False).reset_index(drop=True)
    picked: set[str] = set()
    rows: list[dict] = []

    def take(slot: str, n: int, eligible: Iterable[str]) -> None:
        eligible_set = {p.upper() for p in eligible}
        for _, row in sorted_v.iterrows():
            if n <= 0:
                break
            if row[id_col] in picked:
                continue
            if str(row[position_col]).upper() not in eligible_set:
                continue
            picked.add(row[id_col])
            rows.append({**row.to_dict(), "slot": slot})
            n -= 1

    take("QB", roster.qb, ["QB"])
    take("RB", roster.rb, ["RB"])
    take("WR", roster.wr, ["WR"])
    take("TE", roster.te, ["TE"])
    take("FLEX", roster.flex, _FLEX_POSITIONS)

    return pd.DataFrame(rows)
