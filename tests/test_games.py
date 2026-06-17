import numpy as np
import pandas as pd
import pytest

from ffa.games import (
    GamesModel,
    bootstrap_season_totals,
    resolve_games_counts,
    stable_position,
)
from ffa.simulation import simulate_seasons


def _wk(player_id, season, week, position="WR", **stats):
    base = {
        "player_id": player_id,
        "player_display_name": player_id,
        "position": position,
        "recent_team": "TEAM",
        "season": season,
        "week": week,
    }
    base.update(stats)
    return base


# ---------- bootstrap_season_totals ----------


def test_bootstrap_sums_exactly_games_counts_rows():
    # A pool of all-ones rows: summing k rows must total exactly k.
    matrix = np.ones((6, 1), dtype=float)
    counts = np.array([1, 2, 3, 4, 5])
    rng = np.random.default_rng(0)
    totals = bootstrap_season_totals(matrix, n_samples=5, games_counts=counts, rng=rng)
    assert totals[:, 0].tolist() == [1.0, 2.0, 3.0, 4.0, 5.0]


def test_bootstrap_fixed_counts_matches_plain_choice_sum():
    # With a constant games count, the helper must reproduce the old path
    # rng.choice(n, size=(n_samples, n_games)).sum(axis=1) exactly.
    matrix = np.arange(20, dtype=float).reshape(10, 2)
    weights = np.full(10, 0.1)
    n_samples, n_games = 50, 17

    rng_a = np.random.default_rng(7)
    got = bootstrap_season_totals(
        matrix, n_samples, np.full(n_samples, n_games), rng_a, weights=weights
    )
    rng_b = np.random.default_rng(7)
    idx = rng_b.choice(10, size=(n_samples, n_games), replace=True, p=weights)
    want = matrix[idx].sum(axis=1)
    np.testing.assert_array_equal(got, want)


# ---------- GamesModel ----------


def _games_history():
    rows = []
    # A (WR): 17 games in 2021, 8 in 2022.
    rows += [_wk("A", 2021, w, "WR", receiving_yards=50) for w in range(1, 18)]
    rows += [_wk("A", 2022, w, "WR", receiving_yards=50) for w in range(1, 9)]
    # B (RB): single season, 17 games.
    rows += [_wk("B", 2022, w, "RB", rushing_yards=40) for w in range(1, 18)]
    return pd.DataFrame(rows)


def test_from_history_counts_clip_and_pools():
    gm = GamesModel.from_history(_games_history(), max_games=17)
    assert sorted(gm.by_player["A"].tolist()) == [8, 17]
    assert gm.by_player["B"].tolist() == [17]
    assert sorted(gm.by_position["WR"].tolist()) == [8, 17]
    assert gm.by_position["RB"].tolist() == [17]


def test_from_history_clips_to_max_games():
    # 20 weekly rows in one season, capped at max_games=17.
    rows = [_wk("A", 2022, w, "WR", receiving_yards=10) for w in range(1, 21)]
    gm = GamesModel.from_history(pd.DataFrame(rows), max_games=17)
    assert gm.by_player["A"].tolist() == [17]


def test_sample_uses_own_history_when_enough_seasons():
    gm = GamesModel.from_history(_games_history(), min_own_seasons=2, max_games=17)
    rng = np.random.default_rng(0)
    draws = gm.sample("A", "WR", n_samples=500, rng=rng)
    assert set(np.unique(draws)).issubset({8, 17})  # only A's own counts


def test_sample_falls_back_to_position_when_history_thin():
    gm = GamesModel.from_history(_games_history(), min_own_seasons=2, max_games=17)
    rng = np.random.default_rng(0)
    # B has one season (< min_own_seasons) -> RB position pool, which is [17].
    draws = gm.sample("B", "RB", n_samples=100, rng=rng)
    assert set(np.unique(draws)) == {17}


def test_sample_returns_none_for_empty_model():
    gm = GamesModel({}, {}, np.array([], dtype=int))
    assert gm.sample("X", "WR", n_samples=10, rng=np.random.default_rng(0)) is None


# ---------- stable_position ----------


def test_stable_position_uses_mode_independent_of_order_and_nulls():
    g1 = pd.DataFrame({"position": ["WR", "WR", None, "RB"]})
    g2 = pd.DataFrame({"position": ["RB", None, "WR", "WR"]})  # shuffled order
    assert stable_position(g1) == "WR"
    assert stable_position(g2) == "WR"  # same value regardless of row order
    assert stable_position(pd.DataFrame({"position": [None, None]})) is None
    assert stable_position(pd.DataFrame({"x": [1]})) is None  # no position column


# ---------- resolve_games_counts ----------


def test_resolve_fixed_when_no_model_and_does_not_touch_rng():
    rng = np.random.default_rng(0)
    state_before = rng.bit_generator.state
    counts = resolve_games_counts(None, "A", "WR", n_games=17, n_samples=10, rng=rng)
    assert counts.tolist() == [17] * 10
    # No draw consumed -> generator state unchanged (fixed mode is RNG-neutral).
    assert rng.bit_generator.state == state_before


def test_resolve_falls_back_to_fixed_when_model_has_no_pool():
    gm = GamesModel({}, {}, np.array([], dtype=int))
    counts = resolve_games_counts(gm, "A", "WR", n_games=17, n_samples=8, rng=np.random.default_rng(0))
    assert counts.tolist() == [17] * 8


# ---------- end-to-end through a generator ----------


def _variable_games_player():
    rows = []
    # Constant 50 yds/game, but games vary by season: 17, 17, 6.
    for season, g in ((2021, 17), (2022, 17), (2023, 6)):
        rows += [_wk("A", season, w, "WR", receiving_yards=50) for w in range(1, g + 1)]
    return pd.DataFrame(rows)


def test_empirical_lowers_mean_and_widens_spread_vs_fixed():
    weekly = _variable_games_player()
    fixed = simulate_seasons(weekly, 2024, n_samples=500, games_model="fixed", seed=0)
    emp = simulate_seasons(weekly, 2024, n_samples=500, games_model="empirical", seed=0)

    # Fixed: every sim is 17 * 50 = 850 with zero variance.
    assert fixed["receiving_yards"].std() == pytest.approx(0.0)
    assert fixed["receiving_yards"].mean() == pytest.approx(850.0)
    # Empirical samples some 6-game seasons -> lower mean, real spread.
    assert emp["receiving_yards"].mean() < 850.0
    assert emp["receiving_yards"].std() > 0.0


def test_empirical_is_deterministic_with_seed():
    weekly = _variable_games_player()
    a = simulate_seasons(weekly, 2024, n_samples=200, games_model="empirical", seed=3)
    b = simulate_seasons(weekly, 2024, n_samples=200, games_model="empirical", seed=3)
    pd.testing.assert_frame_equal(a, b)


def test_unknown_games_model_raises():
    weekly = _variable_games_player()
    with pytest.raises(ValueError, match="Unknown games_model"):
        simulate_seasons(weekly, 2024, n_samples=10, games_model="nope")
