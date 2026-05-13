import numpy as np
import pandas as pd
import pytest

from ffa.scoring import score_player_weeks
from ffa.simulation import (
    DEFAULT_QUANTILES,
    simulate_seasons,
    summarize_seasons,
)


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


# ---------- Determinism ----------


def test_same_seed_same_samples():
    rows = [_wk("A", 2024, w, receiving_yards=50 + (w % 7) * 10) for w in range(1, 17)]
    weekly = pd.DataFrame(rows)
    a = simulate_seasons(weekly, target_season=2025, n_samples=200, seed=42)
    b = simulate_seasons(weekly, target_season=2025, n_samples=200, seed=42)
    pd.testing.assert_frame_equal(a, b)


def test_different_seeds_differ():
    rows = [_wk("A", 2024, w, receiving_yards=50 + (w % 7) * 10) for w in range(1, 17)]
    weekly = pd.DataFrame(rows)
    a = simulate_seasons(weekly, target_season=2025, n_samples=200, seed=1)
    b = simulate_seasons(weekly, target_season=2025, n_samples=200, seed=2)
    assert not a["receiving_yards"].equals(b["receiving_yards"])


# ---------- Variance invariants ----------


def test_constant_history_yields_zero_variance():
    """Every game identical -> every bootstrap season identical -> sd = 0."""
    rows = [_wk("A", 2024, w, receiving_yards=50, receiving_tds=1) for w in range(1, 17)]
    weekly = pd.DataFrame(rows)
    samples = simulate_seasons(
        weekly, target_season=2025, n_samples=200, expected_games=17, seed=0
    )
    # 17 games * 50 yds = 850; 17 games * 1 TD = 17
    assert samples["receiving_yards"].nunique() == 1
    assert samples["receiving_yards"].iloc[0] == pytest.approx(850.0)
    assert samples["receiving_tds"].iloc[0] == pytest.approx(17.0)


def test_variable_history_yields_positive_variance():
    rows = [_wk("A", 2024, w, receiving_yards=(0 if w % 2 else 200)) for w in range(1, 17)]
    weekly = pd.DataFrame(rows)
    samples = simulate_seasons(
        weekly, target_season=2025, n_samples=500, expected_games=17, seed=0
    )
    assert samples["receiving_yards"].std() > 0


# ---------- Sample-mean recovers per-game mean * games ----------


def test_sample_mean_matches_history_mean_for_uniform_decay():
    """With decay=0 and many samples, E[season total] ~ games * E[per_game]."""
    rng = np.random.default_rng(7)
    yds_per_game = rng.uniform(20, 120, size=16)
    rows = [
        _wk("A", 2024, w, receiving_yards=float(yds_per_game[w - 1])) for w in range(1, 17)
    ]
    weekly = pd.DataFrame(rows)
    samples = simulate_seasons(
        weekly,
        target_season=2025,
        n_samples=4000,
        decay=0.0,
        expected_games=17,
        seed=0,
    )
    expected = 17 * yds_per_game.mean()
    # Bootstrap SE on the mean ~= sd(history) * sqrt(17) / sqrt(N).
    # Loose tolerance.
    assert samples["receiving_yards"].mean() == pytest.approx(expected, rel=0.05)


# ---------- Recency weighting ----------


def test_higher_decay_pulls_mean_toward_recent_seasons():
    # Old season at 200 yds/game, recent season at 50 yds/game.
    rows = [_wk("A", 2023, w, receiving_yards=200) for w in range(1, 17)]
    rows += [_wk("A", 2024, w, receiving_yards=50) for w in range(1, 17)]
    weekly = pd.DataFrame(rows)
    low = simulate_seasons(
        weekly, target_season=2025, n_samples=2000, decay=0.0, expected_games=17, seed=0
    )
    high = simulate_seasons(
        weekly, target_season=2025, n_samples=2000, decay=2.0, expected_games=17, seed=0
    )
    # decay=0 averages both seasons -> ~125/game; decay=2 strongly weights 2024 -> closer to 50.
    assert low["receiving_yards"].mean() > high["receiving_yards"].mean()
    assert high["receiving_yards"].mean() < 100 * 17  # well below the midpoint


# ---------- Filters ----------


def test_min_history_games_filters_short_careers():
    rows = [_wk("A", 2024, w, receiving_yards=50) for w in (1, 2)]
    rows += [_wk("B", 2024, w, receiving_yards=50) for w in range(1, 17)]
    weekly = pd.DataFrame(rows)
    samples = simulate_seasons(
        weekly,
        target_season=2025,
        n_samples=50,
        min_history_games=4,
        seed=0,
    )
    assert set(samples["player_id"].unique()) == {"B"}


def test_empty_history_returns_empty():
    weekly = pd.DataFrame(
        [_wk("A", 2018, 1, receiving_yards=10)]  # outside lookback window
    )
    samples = simulate_seasons(weekly, target_season=2025, lookback=3, n_samples=10)
    assert samples.empty
    assert "player_id" in samples.columns


def test_missing_required_columns_raise():
    with pytest.raises(ValueError, match="missing required columns"):
        simulate_seasons(pd.DataFrame({"x": [1]}), target_season=2025)


# ---------- Output structure ----------


def test_sample_idx_is_unique_per_player(small_weekly):
    samples = simulate_seasons(small_weekly, target_season=2025, n_samples=50, seed=0)
    # Every (player_id, sample_idx) is unique
    assert len(samples) == samples.groupby(["player_id", "sample_idx"]).ngroups


def test_metadata_carried_through(small_weekly):
    samples = simulate_seasons(small_weekly, target_season=2025, n_samples=20, seed=0)
    assert "position" in samples.columns
    assert "recent_team" in samples.columns


# ---------- Posterior summary ----------


def test_summary_columns_and_quantile_ordering(small_weekly, ppr):
    samples = simulate_seasons(small_weekly, target_season=2025, n_samples=500, seed=0)
    summary = summarize_seasons(samples, ppr)

    expected_qcols = [f"q{int(round(q * 100)):02d}" for q in DEFAULT_QUANTILES]
    for col in ("points_mean", "points_sd", *expected_qcols):
        assert col in summary.columns

    # Quantile monotonicity is a hard invariant.
    for _, row in summary.iterrows():
        qs = [row[c] for c in expected_qcols]
        assert qs == sorted(qs)


def test_summary_mean_matches_scoring_of_mean_stats(ppr):
    """With linear scoring (no bonuses), mean of points == points of mean stats."""
    rows = [_wk("A", 2024, w, receiving_yards=80, receptions=6) for w in range(1, 17)]
    weekly = pd.DataFrame(rows)
    samples = simulate_seasons(
        weekly, target_season=2025, n_samples=500, expected_games=17, seed=0
    )
    summary = summarize_seasons(samples, ppr)
    # 17 games * 80 yds /10 + 17 games * 6 rec * 1 = 136 + 102 = 238
    assert summary["points_mean"].iloc[0] == pytest.approx(238.0)
    assert summary["points_sd"].iloc[0] == pytest.approx(0.0, abs=1e-9)


def test_summary_ordered_by_points_mean(small_weekly, ppr):
    samples = simulate_seasons(small_weekly, target_season=2025, n_samples=200, seed=0)
    summary = summarize_seasons(samples, ppr)
    means = summary["points_mean"].tolist()
    assert means == sorted(means, reverse=True)


def test_summary_handles_empty_input(ppr):
    out = summarize_seasons(pd.DataFrame(), ppr)
    assert out.empty


# ---------- End-to-end: samples scored under any league ----------


def test_scoring_engine_runs_on_long_sample_frame(small_weekly, ppr):
    samples = simulate_seasons(small_weekly, target_season=2025, n_samples=100, seed=0)
    pts = score_player_weeks(samples, ppr)
    assert len(pts) == len(samples)
    assert (pts >= -100).all()  # sanity bound


# ---------- Fixture ----------


@pytest.fixture
def small_weekly() -> pd.DataFrame:
    rng = np.random.default_rng(123)
    rows = []
    profiles = [
        ("A", "WR", {"receiving_yards": 70, "receptions": 6, "receiving_tds": 0.5}),
        ("B", "RB", {"rushing_yards": 70, "rushing_tds": 0.5}),
        ("C", "QB", {"passing_yards": 250, "passing_tds": 1.5, "interceptions": 0.5}),
    ]
    for player_id, position, stats in profiles:
        for season in (2023, 2024):
            for week in range(1, 17):
                jittered = {k: float(max(0, v + rng.normal(0, v * 0.2))) for k, v in stats.items()}
                rows.append(_wk(player_id, season, week, position=position, **jittered))
    return pd.DataFrame(rows)
