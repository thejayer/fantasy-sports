import numpy as np
import pandas as pd
import pytest

from ffa.level import LevelModel, apply_level_jitter, projected_tier, resolve_level
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


# ---------- apply_level_jitter ----------


def test_level_sd_zero_is_identity_and_rng_neutral():
    totals = np.arange(40, dtype=float).reshape(20, 2)
    rng = np.random.default_rng(0)
    state = rng.bit_generator.state
    out = apply_level_jitter(totals, 0.0, rng)
    np.testing.assert_array_equal(out, totals)
    assert rng.bit_generator.state == state  # no draw consumed when off


def test_mean_preserving_factor_has_unit_expectation():
    totals = np.full((200000, 1), 100.0)
    out = apply_level_jitter(totals, 0.4, np.random.default_rng(0), mean=1.0)
    # E[factor] = 1 -> mean of scaled totals ~ 100, no projection drift.
    assert out.mean() == pytest.approx(100.0, rel=0.01)


def test_mean_below_one_drifts_projection_down():
    totals = np.full((200000, 1), 100.0)
    out = apply_level_jitter(totals, 0.4, np.random.default_rng(0), mean=0.9)
    assert out.mean() == pytest.approx(90.0, rel=0.01)


def test_level_jitter_is_two_sided():
    # Unlike the bust mixture (down only), some seasons scale up, some down.
    totals = np.full((5000, 1), 100.0)
    out = apply_level_jitter(totals, 0.3, np.random.default_rng(0))
    assert (out > 100.0).any() and (out < 100.0).any()
    assert (out > 0.0).all()  # log-normal is positive


def test_level_jitter_preserves_cross_stat_ratios():
    totals = np.tile([200.0, 100.0], (500, 1))
    out = apply_level_jitter(totals, 0.4, np.random.default_rng(0))
    np.testing.assert_allclose(out[:, 0] / out[:, 1], 2.0)


@pytest.mark.parametrize("bad_sd", [-0.1])
def test_negative_level_sd_raises(bad_sd):
    with pytest.raises(ValueError, match="level_sd"):
        apply_level_jitter(np.ones((4, 1)), bad_sd, np.random.default_rng(0))


@pytest.mark.parametrize("bad_mean", [0.0, -1.0])
def test_nonpositive_mean_raises(bad_mean):
    with pytest.raises(ValueError, match="mean"):
        apply_level_jitter(np.ones((4, 1)), 0.3, np.random.default_rng(0), mean=bad_mean)


# ---------- through the generator ----------


def _steady_player():
    rows = []
    for season in (2022, 2023):
        for week in range(1, 18):
            rows.append(_wk("A", season, week, receiving_yards=50))
    return pd.DataFrame(rows)


def test_generator_level_sd_zero_unchanged():
    weekly = _steady_player()
    base = simulate_seasons(weekly, 2024, n_samples=300, seed=0)
    same = simulate_seasons(weekly, 2024, n_samples=300, level_sd=0.0, seed=0)
    pd.testing.assert_frame_equal(base, same)


def test_generator_level_jitter_widens_both_tails():
    weekly = _steady_player()
    base = simulate_seasons(weekly, 2024, n_samples=3000, seed=0)
    jit = simulate_seasons(weekly, 2024, n_samples=3000, level_sd=0.3, seed=0)

    b = base["receiving_yards"]
    d = jit["receiving_yards"]
    assert b.std() == pytest.approx(0.0)  # constant baseline (17*50)
    # Two-sided: ceiling rises above and floor drops below the baseline.
    assert d.max() > 850.0
    assert d.quantile(0.05) < 850.0
    # Mean-preserving keeps the center near the baseline.
    assert d.mean() == pytest.approx(850.0, rel=0.03)


def test_generator_level_jitter_deterministic():
    weekly = _steady_player()
    a = simulate_seasons(weekly, 2024, n_samples=200, level_sd=0.3, seed=5)
    b = simulate_seasons(weekly, 2024, n_samples=200, level_sd=0.3, seed=5)
    pd.testing.assert_frame_equal(a, b)


def test_generator_forwards_level_mean_to_shift_projection_down():
    # level_mean is threaded through simulate_seasons -> apply_level_jitter;
    # at the same spread, mean 0.9 must produce a ~10%-lower projection than
    # the mean-preserving default.
    weekly = _steady_player()
    neutral = simulate_seasons(weekly, 2024, n_samples=4000, level_sd=0.3, level_mean=1.0, seed=0)
    drifted = simulate_seasons(weekly, 2024, n_samples=4000, level_sd=0.3, level_mean=0.9, seed=0)

    m_neutral = neutral["receiving_yards"].mean()
    m_drifted = drifted["receiving_yards"].mean()
    assert m_drifted < m_neutral
    assert m_drifted == pytest.approx(0.9 * m_neutral, rel=0.03)


# ---------- LevelModel (phase 17, conditioned) ----------


def test_level_model_conditions_spread_on_tier_and_drift_on_experience():
    m = LevelModel()
    sd_low, mean_rook = m.level_for("low", 0)     # fringe rookie
    sd_high, mean_vet = m.level_for("high", 12)   # star veteran
    assert sd_low > sd_high                        # fringe wider than stars
    assert mean_rook > mean_vet                    # rookies need less correction
    assert sd_low == pytest.approx(0.60 * 1.25)
    assert sd_high == pytest.approx(0.60 * 0.80)
    assert mean_rook == pytest.approx(0.90 + 0.15)  # experience score +1
    assert mean_vet == pytest.approx(0.90 - 0.15)   # experience score -1


def test_level_model_neutral_on_missing_features():
    sd, mean = LevelModel().level_for(None, None)
    assert sd == pytest.approx(0.60)   # unknown tier -> multiplier 1.0
    assert mean == pytest.approx(0.90)  # unknown experience -> score 0


def test_resolve_level_uses_table_then_falls_back():
    pl = {"A": (0.5, 0.9)}
    assert resolve_level("A", pl, 0.1, 1.0) == (0.5, 0.9)
    assert resolve_level("B", pl, 0.1, 1.0) == (0.1, 1.0)   # not in table
    assert resolve_level("A", None, 0.1, 1.0) == (0.1, 1.0)  # no table


def test_projected_tier_assigns_terciles_by_rank():
    t = projected_tier(pd.Series([1, 2, 3, 4, 5, 6, 7, 8, 9]))
    assert set(t.unique()) == {"low", "mid", "high"}
    assert t.iloc[0] == "low" and t.iloc[-1] == "high"


def test_generator_player_level_applies_per_player():
    rows = []
    for pid in ("A", "B"):
        for season in (2022, 2023):
            for week in range(1, 18):
                rows.append(_wk(pid, season, week, receiving_yards=50))
    weekly = pd.DataFrame(rows)
    # A: sd 0 (off) -> constant; B: jitter -> spread.
    player_level = {"A": (0.0, 1.0), "B": (0.4, 1.0)}
    s = simulate_seasons(weekly, 2024, n_samples=2000, player_level=player_level, seed=0)
    assert s[s["player_id"] == "A"]["receiving_yards"].std() == pytest.approx(0.0)
    assert s[s["player_id"] == "B"]["receiving_yards"].std() > 0.0
