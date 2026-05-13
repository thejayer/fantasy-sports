import pandas as pd
import pytest

from ffa.league import RosterRules
from ffa.ranking import assign_tiers, compute_vor


# ---------- VOR ----------


def test_vor_replacement_index_picks_first_non_starter():
    roster = RosterRules(teams=12, qb=1, rb=2, wr=2, te=1, flex=0)
    # 12 teams * 1 QB starter = 12 starters; QB13 (index 12) is replacement.
    assert roster.replacement_index("QB") == 12
    assert roster.replacement_index("RB") == 24
    assert roster.replacement_index("TE") == 12


def test_vor_flex_split_shifts_replacement_for_flex_eligible_positions():
    roster = RosterRules(teams=10, qb=1, rb=2, wr=2, te=1, flex=1)
    # RB starters per team = 2 + 1/3 -> 10 * 2.333 = 23 (rounded).
    assert roster.replacement_index("QB") == 10
    assert roster.replacement_index("RB") == 23
    assert roster.replacement_index("TE") == 13


def test_compute_vor_subtracts_replacement():
    # Build a small projection table where replacement at each position
    # is easy to identify by hand.
    rows = []
    for i in range(15):  # 15 QBs, points 300 down to 230
        rows.append({"player_id": f"QB{i}", "position": "QB", "points_mean": 300 - i * 5})
    for i in range(30):  # 30 RBs, points 200 down to 113
        rows.append({"player_id": f"RB{i}", "position": "RB", "points_mean": 200 - i * 3})
    summary = pd.DataFrame(rows)

    roster = RosterRules(teams=12, qb=1, rb=2, wr=2, te=1, flex=0)
    out = compute_vor(summary, roster)

    # Replacement QB = QB12 (0-indexed) -> 300 - 12*5 = 240
    qb_replacement = 300 - 12 * 5
    assert out.loc[out["player_id"] == "QB0", "vor"].iloc[0] == pytest.approx(300 - qb_replacement)
    # Replacement RB = RB24 -> 200 - 24*3 = 128
    rb_replacement = 200 - 24 * 3
    assert out.loc[out["player_id"] == "RB0", "vor"].iloc[0] == pytest.approx(200 - rb_replacement)


def test_compute_vor_falls_back_when_pool_too_shallow():
    """If a position has fewer players than starting slots, replacement is the worst."""
    summary = pd.DataFrame(
        [{"player_id": "TE1", "position": "TE", "points_mean": 100}],
    )
    roster = RosterRules(teams=12, qb=1, rb=2, wr=2, te=1, flex=0)
    out = compute_vor(summary, roster)
    # Only one TE -> replacement is themselves -> VOR = 0.
    assert out["vor"].iloc[0] == pytest.approx(0.0)


def test_compute_vor_handles_empty_input():
    out = compute_vor(pd.DataFrame(columns=["player_id", "position", "points_mean"]), RosterRules())
    assert out.empty
    assert "vor" in out.columns


# ---------- Tiers ----------


def test_tiers_split_at_largest_gaps():
    """Construct points with two obvious gaps; verify 3 tiers form there."""
    points = [300, 295, 290, 250, 245, 240, 200, 195]
    summary = pd.DataFrame(
        [
            {"player_id": f"P{i}", "position": "WR", "points_mean": pts}
            for i, pts in enumerate(points)
        ],
    )
    out = assign_tiers(summary, n_tiers=3).sort_values("points_mean", ascending=False)
    tiers = out["tier"].tolist()
    # Tier 1: 300,295,290 ; tier 2: 250,245,240 ; tier 3: 200,195
    assert tiers == [1, 1, 1, 2, 2, 2, 3, 3]


def test_tiers_independent_per_position():
    summary = pd.DataFrame(
        [
            {"player_id": "Q1", "position": "QB", "points_mean": 320},
            {"player_id": "Q2", "position": "QB", "points_mean": 250},
            {"player_id": "W1", "position": "WR", "points_mean": 280},
            {"player_id": "W2", "position": "WR", "points_mean": 270},
        ],
    )
    out = assign_tiers(summary, n_tiers=2)
    # Each position should have its own tier numbering starting at 1.
    qb_tiers = sorted(out.loc[out["position"] == "QB", "tier"].unique().tolist())
    wr_tiers = sorted(out.loc[out["position"] == "WR", "tier"].unique().tolist())
    assert qb_tiers == [1, 2]
    assert 1 in wr_tiers


def test_tiers_handles_tiny_position():
    summary = pd.DataFrame(
        [{"player_id": "T1", "position": "TE", "points_mean": 150}],
    )
    out = assign_tiers(summary, n_tiers=5)
    assert out["tier"].iloc[0] == 1
