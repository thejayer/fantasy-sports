import pandas as pd
import pytest

from ffa.league import RosterRules
from ffa.optimize import greedy_lineup, optimize_lineup


def _pool() -> pd.DataFrame:
    """Generous candidate pool covering all positions."""
    rows = []
    # Make values strictly decreasing within position so optima are obvious.
    for i in range(20):
        rows.append({"player_id": f"QB{i}", "position": "QB", "vor": 100 - i})
    for i in range(50):
        rows.append({"player_id": f"RB{i}", "position": "RB", "vor": 90 - i})
    for i in range(50):
        rows.append({"player_id": f"WR{i}", "position": "WR", "vor": 85 - i})
    for i in range(20):
        rows.append({"player_id": f"TE{i}", "position": "TE", "vor": 60 - i})
    return pd.DataFrame(rows)


# ---------- No-budget optimum matches the obvious top-of-board picks ----------


def test_optimize_without_budget_picks_top_players_per_slot():
    pool = _pool()
    roster = RosterRules(teams=12, qb=1, rb=2, wr=2, te=1, flex=1)
    lineup = optimize_lineup(pool, roster)

    # Should be 7 slots: QB + 2 RB + 2 WR + 1 TE + 1 FLEX.
    assert len(lineup) == 7
    slot_counts = lineup["slot"].value_counts().to_dict()
    assert slot_counts == {"RB": 2, "WR": 2, "QB": 1, "TE": 1, "FLEX": 1}

    # QB0 is the unique best QB and must be chosen.
    assert "QB0" in lineup["player_id"].tolist()
    # The two top RBs and top WRs are chosen.
    assert {"RB0", "RB1"}.issubset(set(lineup["player_id"]))
    assert {"WR0", "WR1"}.issubset(set(lineup["player_id"]))
    # FLEX should go to RB2 (next-best flex-eligible after RB1) since
    # RB scores (90..) dominate WR (85..) and TE (60..).
    assert "RB2" in lineup["player_id"].tolist()


def test_greedy_matches_ilp_without_budget():
    pool = _pool()
    roster = RosterRules(teams=12, qb=1, rb=2, wr=2, te=1, flex=1)
    ilp = optimize_lineup(pool, roster)
    greedy = greedy_lineup(pool, roster)
    assert set(ilp["player_id"]) == set(greedy["player_id"])


# ---------- Budget constraint forces tradeoffs ----------


def test_optimize_respects_budget_constraint():
    pool = _pool()
    roster = RosterRules(teams=12, qb=1, rb=2, wr=2, te=1, flex=1)
    # Make the top players expensive; cheap-but-decent players exist below.
    costs = pd.Series(
        {pid: (50 if pid.endswith("0") else 1) for pid in pool["player_id"]}
    )
    lineup = optimize_lineup(pool, roster, costs=costs, budget=20)

    total_cost = float(costs.loc[lineup["player_id"]].sum())
    assert total_cost <= 20
    # With budget=20 we can't afford any of the $50 top-of-position players.
    for slot_top in ("QB0", "RB0", "WR0", "TE0"):
        assert slot_top not in lineup["player_id"].tolist()
    # Roster still complete.
    assert len(lineup) == 7


def test_optimize_budget_requires_costs():
    pool = _pool()
    with pytest.raises(ValueError, match="costs"):
        optimize_lineup(pool, RosterRules(), budget=100)
    with pytest.raises(ValueError, match="costs"):
        optimize_lineup(pool, RosterRules(), costs=pd.Series({"x": 1}))


def test_optimize_rejects_duplicate_ids():
    pool = pd.DataFrame(
        [
            {"player_id": "A", "position": "QB", "vor": 10},
            {"player_id": "A", "position": "QB", "vor": 5},
        ],
    )
    with pytest.raises(ValueError, match="Duplicate"):
        optimize_lineup(pool, RosterRules())
