import numpy as np
import pandas as pd
import pytest

from ffa.quantile import (
    QuantileGenerator,
    _monotonize,
    _pit_transform_column,
    simulate_seasons_quantile_calibrated,
)
from ffa.scoring import score_player_weeks
from ffa.simulation import summarize_seasons


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


@pytest.fixture
def multi_season_weekly() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    rows = []
    profiles = [
        ("A", "WR", {"receiving_yards": 70, "receptions": 6}),
        ("B", "WR", {"receiving_yards": 50, "receptions": 4}),
        ("C", "WR", {"receiving_yards": 90, "receptions": 8}),
        ("D", "RB", {"rushing_yards": 70, "rushing_tds": 0.5}),
        ("E", "RB", {"rushing_yards": 50, "rushing_tds": 0.3}),
        ("F", "RB", {"rushing_yards": 90, "rushing_tds": 0.7}),
    ]
    for player_id, position, stats in profiles:
        for season in (2021, 2022, 2023, 2024):
            for week in range(1, 16):
                jittered = {
                    k: float(max(0, v + rng.normal(0, v * 0.2))) for k, v in stats.items()
                }
                rows.append(_wk(player_id, season, week, position=position, **jittered))
    return pd.DataFrame(rows)


# ---------- _monotonize ----------


def test_monotonize_sorts_per_row():
    a = np.array([[3.0, 1.0, 2.0], [10.0, 5.0, 8.0]])
    out = _monotonize(a)
    np.testing.assert_array_equal(out, np.array([[1.0, 2.0, 3.0], [5.0, 8.0, 10.0]]))


# ---------- _pit_transform_column ----------


def test_pit_transform_preserves_within_player_rank_order():
    """The transformation is rank-preserving: input ordering equals output ordering."""
    hist = np.array([10.0, 50.0, 30.0, 70.0, 20.0])
    pred_q = {0.1: 5.0, 0.5: 40.0, 0.9: 100.0}
    transformed = _pit_transform_column(hist, pred_q)
    assert np.argsort(hist).tolist() == np.argsort(transformed).tolist()


def test_pit_transform_matches_predicted_median_in_expectation():
    """Average of transformed values should land near the predicted median."""
    rng = np.random.default_rng(0)
    hist = rng.uniform(0, 100, size=200)
    pred_q = {0.1: 10.0, 0.5: 50.0, 0.9: 90.0}
    transformed = _pit_transform_column(hist, pred_q)
    # With a uniform empirical CDF spanning [0, 1], the average of a
    # piecewise-linear F^-1 is approximately the predicted median for a
    # symmetric quantile spec.
    assert abs(transformed.mean() - 50.0) < 5.0


def test_pit_transform_handles_empty_input():
    out = _pit_transform_column(np.array([]), {0.1: 1.0, 0.5: 2.0, 0.9: 3.0})
    assert out.size == 0


def test_pit_transform_non_negative_output():
    hist = np.array([1.0, 2.0, 3.0])
    out = _pit_transform_column(hist, {0.1: 0.0, 0.5: 0.0, 0.9: 0.5})
    assert (out >= 0).all()


# ---------- QuantileGenerator ----------


def test_quantile_generator_fits_per_position_per_stat_per_quantile(multi_season_weekly):
    gen = QuantileGenerator(lookback=3, quantiles=(0.1, 0.5, 0.9)).fit(multi_season_weekly)
    # At least one stat for at least one position must have all three quantile models.
    positions = {pos for (pos, _, _) in gen.models}
    stats = {stat for (_, stat, _) in gen.models}
    quantiles = {q for (_, _, q) in gen.models}
    assert positions.issuperset({"WR", "RB"})
    assert "receiving_yards" in stats
    assert quantiles == {0.1, 0.5, 0.9}


def test_quantile_generator_predicts_monotonic_quantiles(multi_season_weekly):
    """For any player, predicted q10 <= q50 <= q90 (post-monotonization)."""
    gen = QuantileGenerator(lookback=3).fit(multi_season_weekly)
    preds = gen.predict_quantiles(multi_season_weekly, target_season=2025)
    for stat in ("receiving_yards", "rushing_yards"):
        col10, col50, col90 = f"{stat}_q10", f"{stat}_q50", f"{stat}_q90"
        if col10 in preds.columns:
            assert (preds[col10] <= preds[col50] + 1e-6).all()
            assert (preds[col50] <= preds[col90] + 1e-6).all()


def test_quantile_generator_distinguishes_player_profiles(multi_season_weekly):
    """Player C (90 yds/game profile) should have a higher predicted q50 than B (50)."""
    gen = QuantileGenerator(lookback=3).fit(multi_season_weekly)
    preds = gen.predict_quantiles(multi_season_weekly, target_season=2025).set_index("player_id")
    assert preds.loc["C", "receiving_yards_q50"] > preds.loc["B", "receiving_yards_q50"]


# ---------- simulate_seasons_quantile_calibrated ----------


def test_quantile_simulator_returns_same_schema(multi_season_weekly):
    samples = simulate_seasons_quantile_calibrated(
        multi_season_weekly, target_season=2025, n_samples=100, seed=0
    )
    for col in ("player_id", "sample_idx", "receiving_yards"):
        assert col in samples.columns
    assert len(samples) == samples.groupby(["player_id", "sample_idx"]).ngroups


def test_quantile_simulator_is_seed_deterministic(multi_season_weekly):
    a = simulate_seasons_quantile_calibrated(
        multi_season_weekly, target_season=2025, n_samples=50, seed=42
    )
    b = simulate_seasons_quantile_calibrated(
        multi_season_weekly, target_season=2025, n_samples=50, seed=42
    )
    pd.testing.assert_frame_equal(a, b)


def test_quantile_simulator_sample_marginals_calibrate_to_predicted_quantiles():
    """When sampling 1 game per "season", per-game samples should match predicted quantiles."""
    rng = np.random.default_rng(0)
    rows = []
    # Build training data where higher prior_pg leads to higher current_pg, ~linear.
    for player_id, mean_yds in [("A", 30), ("B", 60), ("C", 90), ("D", 120), ("E", 150)]:
        for season in (2021, 2022, 2023, 2024):
            for week in range(1, 17):
                rows.append(
                    _wk(
                        player_id,
                        season,
                        week,
                        position="WR",
                        receiving_yards=float(max(0, mean_yds + rng.normal(0, 25))),
                    )
                )
    weekly = pd.DataFrame(rows)
    samples = simulate_seasons_quantile_calibrated(
        weekly,
        target_season=2025,
        n_samples=5000,
        expected_games=1,  # per-game samples align with predicted marginals
        decay=0.0,
        seed=0,
    )
    # For player C with mean_yds=90, predicted q50 should be near 90;
    # the median of per-game samples should be close.
    c_samples = samples.loc[samples["player_id"] == "C", "receiving_yards"]
    assert abs(c_samples.median() - 90.0) < 25.0


def test_quantile_simulator_metadata_carried_through(multi_season_weekly):
    samples = simulate_seasons_quantile_calibrated(
        multi_season_weekly, target_season=2025, n_samples=20, seed=0
    )
    assert "position" in samples.columns


def test_quantile_simulator_handles_missing_required_columns():
    with pytest.raises(ValueError, match="missing required columns"):
        simulate_seasons_quantile_calibrated(pd.DataFrame({"x": [1]}), target_season=2025)


def test_quantile_samples_feed_scoring_engine(multi_season_weekly, ppr):
    samples = simulate_seasons_quantile_calibrated(
        multi_season_weekly, target_season=2025, n_samples=200, seed=0
    )
    pts = score_player_weeks(samples, ppr)
    assert len(pts) == len(samples)
    summary = summarize_seasons(samples, ppr)
    for _, row in summary.iterrows():
        qs = [row["q05"], row["q25"], row["q50"], row["q75"], row["q95"]]
        assert qs == sorted(qs)


def test_pretrained_quantile_generator_can_be_reused(multi_season_weekly):
    gen = QuantileGenerator(
        lookback=3,
        stats=("receiving_yards", "receptions"),
        quantiles=(0.1, 0.5, 0.9),
    ).fit(multi_season_weekly[multi_season_weekly["season"] < 2025])
    a = simulate_seasons_quantile_calibrated(
        multi_season_weekly,
        target_season=2025,
        generator=gen,
        n_samples=50,
        stats=("receiving_yards", "receptions"),
        seed=7,
    )
    b = simulate_seasons_quantile_calibrated(
        multi_season_weekly,
        target_season=2025,
        generator=gen,
        n_samples=50,
        stats=("receiving_yards", "receptions"),
        seed=7,
    )
    pd.testing.assert_frame_equal(a, b)
