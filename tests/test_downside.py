import numpy as np
import pandas as pd
import pytest

from ffa.downside import apply_downside
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


# ---------- apply_downside ----------


def test_bust_rate_zero_is_identity_and_rng_neutral():
    totals = np.arange(40, dtype=float).reshape(20, 2)
    rng = np.random.default_rng(0)
    state = rng.bit_generator.state
    out = apply_downside(totals, 0.0, rng)
    np.testing.assert_array_equal(out, totals)
    assert rng.bit_generator.state == state  # no draw consumed when off


def test_bust_only_scales_down_never_up():
    totals = np.full((2000, 1), 100.0)
    out = apply_downside(totals, 0.5, np.random.default_rng(0))
    # Every value is either unchanged (non-bust) or strictly reduced.
    assert out.max() <= 100.0
    assert out.min() >= 0.0
    # With rate 0.5 some seasons bust, some don't.
    assert (out < 100.0).any() and (out == 100.0).any()


def test_bust_fraction_matches_rate():
    totals = np.full((5000, 1), 100.0)
    out = apply_downside(totals, 0.2, np.random.default_rng(1), severity_low=0.0, severity_high=0.6)
    busted = (out < 100.0).mean()
    assert busted == pytest.approx(0.2, abs=0.03)
    # Busted seasons land within [0, 60] of the original 100.
    busted_vals = out[out < 100.0]
    assert busted_vals.max() <= 60.0 + 1e-9


def test_bust_preserves_cross_stat_ratios():
    # A two-stat line in fixed 2:1 ratio stays 2:1 after multiplicative bust.
    totals = np.tile([200.0, 100.0], (500, 1))
    out = apply_downside(totals, 1.0, np.random.default_rng(0), severity_low=0.1, severity_high=0.9)
    np.testing.assert_allclose(out[:, 0] / out[:, 1], 2.0)


def test_invalid_severity_raises():
    with pytest.raises(ValueError, match="severity"):
        apply_downside(np.ones((4, 1)), 0.5, np.random.default_rng(0), severity_low=0.5, severity_high=0.2)


@pytest.mark.parametrize("bad_rate", [-0.1, 1.5])
def test_invalid_bust_rate_raises(bad_rate):
    with pytest.raises(ValueError, match="bust_rate"):
        apply_downside(np.ones((4, 1)), bad_rate, np.random.default_rng(0))


# ---------- through the generator ----------


def _steady_player():
    # One player, constant 50 yds/game, full 17-game seasons -> fixed games
    # gives zero variance, isolating the downside mechanism's effect.
    rows = []
    for season in (2022, 2023):
        for week in range(1, 18):
            rows.append(_wk("A", season, week, receiving_yards=50))
    return pd.DataFrame(rows)


def test_generator_bust_rate_zero_unchanged():
    weekly = _steady_player()
    base = simulate_seasons(weekly, 2024, n_samples=300, seed=0)
    same = simulate_seasons(weekly, 2024, n_samples=300, bust_rate=0.0, seed=0)
    pd.testing.assert_frame_equal(base, same)


def test_generator_bust_rate_fattens_lower_tail_only():
    weekly = _steady_player()
    base = simulate_seasons(weekly, 2024, n_samples=2000, seed=0)
    busty = simulate_seasons(weekly, 2024, n_samples=2000, bust_rate=0.15, seed=0)

    b = base["receiving_yards"]
    d = busty["receiving_yards"]
    # Baseline is the constant 17*50 = 850 (no variance).
    assert b.std() == pytest.approx(0.0)
    # Downside only lowers: the ceiling is unchanged, the floor drops a lot.
    assert d.max() == pytest.approx(850.0)
    assert d.quantile(0.05) < 850.0
    assert d.min() < 850.0
    # Median is untouched (most seasons aren't busts).
    assert d.median() == pytest.approx(850.0)


def test_generator_bust_is_deterministic_with_seed():
    weekly = _steady_player()
    a = simulate_seasons(weekly, 2024, n_samples=200, bust_rate=0.2, seed=7)
    b = simulate_seasons(weekly, 2024, n_samples=200, bust_rate=0.2, seed=7)
    pd.testing.assert_frame_equal(a, b)
