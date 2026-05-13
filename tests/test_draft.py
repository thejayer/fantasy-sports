import pandas as pd
import pytest

from ffa.draft import simulate_draft, summarize_user_picks
from ffa.league import RosterRules


def _candidate_pool(n: int = 200) -> pd.DataFrame:
    """Pool with descending VOR; ADP equals 1-indexed rank."""
    rows = []
    for i in range(n):
        # Cycle through positions to keep the pool eligible-rich at every slot.
        position = ["QB", "RB", "WR", "TE", "RB", "WR"][i % 6]
        rows.append({"player_id": f"P{i}", "position": position, "vor": (n - i)})
    df = pd.DataFrame(rows)
    return df


# ---------- Determinism / basic shape ----------


def test_same_seed_yields_same_user_picks():
    pool = _candidate_pool()
    roster = RosterRules(teams=10, qb=1, rb=2, wr=2, te=1, flex=1, bench=4)
    a = simulate_draft(pool, roster, user_slot=3, n_sims=20, seed=42)
    b = simulate_draft(pool, roster, user_slot=3, n_sims=20, seed=42)
    pd.testing.assert_frame_equal(a.user_picks, b.user_picks)


def test_user_rounds_match_total_roster_slots():
    pool = _candidate_pool()
    roster = RosterRules(teams=8, qb=1, rb=2, wr=2, te=1, flex=1, bench=3)
    expected_rounds = roster.qb + roster.rb + roster.wr + roster.te + roster.flex + roster.bench
    result = simulate_draft(pool, roster, user_slot=4, n_sims=10, seed=0)
    # Each sim should yield expected_rounds picks for the user.
    counts = result.user_picks.groupby("sim").size()
    assert (counts == expected_rounds).all()


def test_user_picks_obey_slot_constraints():
    """The user should never pick more starters at a position than the roster allows."""
    pool = _candidate_pool()
    roster = RosterRules(teams=8, qb=1, rb=2, wr=2, te=1, flex=1, bench=2)
    result = simulate_draft(pool, roster, user_slot=4, n_sims=10, seed=0)
    for _, sim_picks in result.user_picks.groupby("sim"):
        # Count starters at each strict slot.
        slot_counts = sim_picks["slot"].value_counts().to_dict()
        assert slot_counts.get("QB", 0) <= roster.qb
        assert slot_counts.get("RB", 0) <= roster.rb
        assert slot_counts.get("WR", 0) <= roster.wr
        assert slot_counts.get("TE", 0) <= roster.te
        assert slot_counts.get("FLEX", 0) <= roster.flex


# ---------- Availability matrix ----------


def test_availability_decreases_for_top_players_across_rounds():
    """The #1-VOR player should be less available in later rounds."""
    pool = _candidate_pool()
    roster = RosterRules(teams=10, qb=1, rb=2, wr=2, te=1, flex=1, bench=4)
    result = simulate_draft(pool, roster, user_slot=10, n_sims=50, seed=0)
    top_player = pool.iloc[0]["player_id"]
    avail = result.availability.set_index("player_id").loc[top_player]
    round_cols = [c for c in avail.index if c.startswith("round_")]
    values = avail[round_cols].tolist()
    # Non-increasing: once gone, the player stays gone.
    assert all(values[i] >= values[i + 1] for i in range(len(values) - 1))


def test_availability_rows_match_pool():
    pool = _candidate_pool(n=120)
    roster = RosterRules(teams=10, qb=1, rb=2, wr=2, te=1, flex=1, bench=4)
    result = simulate_draft(pool, roster, user_slot=5, n_sims=5, seed=0)
    assert set(result.availability["player_id"]) == set(pool["player_id"])


# ---------- User pick strategy ----------


def test_user_picks_highest_value_available_in_round_1():
    """User at slot 1 in round 1 should always get the #1 VOR-eligible player."""
    pool = _candidate_pool()
    roster = RosterRules(teams=10, qb=1, rb=2, wr=2, te=1, flex=1, bench=4)
    result = simulate_draft(pool, roster, user_slot=1, n_sims=20, seed=0)
    round_1_picks = result.user_picks[result.user_picks["round"] == 1]["player_id"].unique()
    top_id = pool.sort_values("vor", ascending=False).iloc[0]["player_id"]
    assert list(round_1_picks) == [top_id]


# ---------- Validation ----------


def test_invalid_user_slot_raises():
    pool = _candidate_pool()
    roster = RosterRules(teams=8, qb=1, rb=2, wr=2, te=1, flex=1, bench=2)
    with pytest.raises(ValueError, match="user_slot"):
        simulate_draft(pool, roster, user_slot=99, n_sims=2, seed=0)


def test_undersized_pool_raises():
    pool = _candidate_pool(n=10)
    roster = RosterRules(teams=8, qb=1, rb=2, wr=2, te=1, flex=1, bench=2)
    with pytest.raises(ValueError, match="can't fill"):
        simulate_draft(pool, roster, user_slot=1, n_sims=1, seed=0)


# ---------- summarize_user_picks ----------


def test_summarize_user_picks_rates_sum_correctly():
    pool = _candidate_pool()
    roster = RosterRules(teams=10, qb=1, rb=2, wr=2, te=1, flex=1, bench=4)
    result = simulate_draft(pool, roster, user_slot=10, n_sims=20, seed=0)
    summary = summarize_user_picks(result.user_picks, top=50)
    assert "pick_rate" in summary.columns
    assert summary["pick_rate"].between(0, 1).all()
