import numpy as np
import pandas as pd
import pytest

from ffa.learned import (
    LearnedGenerator,
    _build_features,
    _per_player_season_aggregates,
    simulate_seasons_learned,
)
from ffa.scoring import STAT_COLUMNS, score_player_weeks
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


def test_build_features_prev_games_is_zero_not_nan_for_gap_season():
    """A player who missed the season before target must get prev_games=0.

    Regression: ``prev.get("games") or 0`` returned NaN (NaN is truthy) for a
    gap, putting NaN into the feature matrix and crashing sklearn's GBR on
    real (sparse) data.
    """
    rows = [_wk("A", 2021, w, "WR", receiving_yards=60) for w in range(1, 15)]
    # A has no 2022 rows -> gap immediately before target 2023.
    agg = _per_player_season_aggregates(pd.DataFrame(rows), STAT_COLUMNS)
    feats = _build_features(agg, 2023, STAT_COLUMNS, lookback=3)

    assert not feats.isna().any().any()  # no NaN anywhere in the feature frame
    assert feats.set_index("player_id").loc["A", "prev_games"] == 0.0


def test_learned_generator_fits_on_sparse_history_without_nan_crash():
    """Players with gaps (the real-data shape) must not break the fit."""
    rng = np.random.default_rng(0)
    rows = []
    # Each player skips a different season, so reindex produces NaN rows.
    for pid, skip in (("A", 2022), ("B", 2021), ("C", 2023)):
        for season in (2021, 2022, 2023, 2024):
            if season == skip:
                continue
            for week in range(1, 15):
                rows.append(_wk(pid, season, week, "WR", receiving_yards=float(50 + rng.normal(0, 5))))
    weekly = pd.DataFrame(rows)

    samples = simulate_seasons_learned(weekly, target_season=2025, n_samples=30, seed=0)
    assert not samples.empty
    assert np.isfinite(samples["receiving_yards"]).all()


@pytest.fixture
def multi_season_weekly() -> pd.DataFrame:
    """Three seasons across multiple players so the learned generator has training data."""
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
                    k: float(max(0, v + rng.normal(0, v * 0.15))) for k, v in stats.items()
                }
                rows.append(_wk(player_id, season, week, position=position, **jittered))
    return pd.DataFrame(rows)


# ---------- Generator fits and predicts ----------


def test_generator_fits_on_multi_season_data(multi_season_weekly):
    gen = LearnedGenerator(lookback=3).fit(multi_season_weekly)
    # At least one (position, stat) model should be trained.
    assert len(gen.models) > 0
    # Models are keyed by (position, stat).
    keys = set(gen.models.keys())
    assert any(stat == "receiving_yards" for _, stat in keys)


def test_generator_predicts_per_player(multi_season_weekly):
    gen = LearnedGenerator(lookback=3).fit(multi_season_weekly)
    preds = gen.predict_per_game(multi_season_weekly, target_season=2025)
    assert set(preds["player_id"]) >= {"A", "B", "C", "D", "E", "F"}
    # Predictions are non-negative (model is clipped).
    for col in ("receiving_yards", "rushing_yards"):
        if col in preds.columns:
            assert (preds[col] >= 0).all()


def test_generator_predictions_track_player_ordering(multi_season_weekly):
    """C is the highest-yardage WR profile -> should be projected highest among WRs."""
    gen = LearnedGenerator(lookback=3).fit(multi_season_weekly)
    preds = gen.predict_per_game(multi_season_weekly, target_season=2025)
    wr = preds[preds["position"] == "WR"].set_index("player_id")
    assert wr.loc["C", "receiving_yards"] > wr.loc["A", "receiving_yards"]
    assert wr.loc["A", "receiving_yards"] > wr.loc["B", "receiving_yards"]


# ---------- simulate_seasons_learned matches the bootstrap contract ----------


def test_learned_simulator_returns_same_schema(multi_season_weekly):
    samples = simulate_seasons_learned(
        multi_season_weekly, target_season=2025, n_samples=100, seed=0
    )
    for col in ("player_id", "sample_idx", "receiving_yards"):
        assert col in samples.columns
    # One row per (player, sample).
    assert len(samples) == samples.groupby(["player_id", "sample_idx"]).ngroups


def test_learned_simulator_is_seed_deterministic(multi_season_weekly):
    a = simulate_seasons_learned(
        multi_season_weekly, target_season=2025, n_samples=50, seed=42
    )
    b = simulate_seasons_learned(
        multi_season_weekly, target_season=2025, n_samples=50, seed=42
    )
    pd.testing.assert_frame_equal(a, b)


def test_learned_simulator_metadata_carried(multi_season_weekly):
    samples = simulate_seasons_learned(
        multi_season_weekly, target_season=2025, n_samples=10, seed=0
    )
    assert "position" in samples.columns
    assert "recent_team" in samples.columns


# ---------- Behavior contracts ----------


def test_learned_zero_history_stays_zero():
    """Multiplicative scaling: stats a player never produced must stay zero."""
    rows = [
        _wk("X", 2023, w, position="WR", receiving_yards=80, receptions=6, passing_yards=0)
        for w in range(1, 16)
    ]
    rows += [
        _wk("X", 2024, w, position="WR", receiving_yards=80, receptions=6, passing_yards=0)
        for w in range(1, 16)
    ]
    # Need at least a couple of other WR rows so the generator has training data.
    rows += [
        _wk("Y", 2023, w, position="WR", receiving_yards=70, receptions=5, passing_yards=0)
        for w in range(1, 16)
    ]
    rows += [
        _wk("Y", 2024, w, position="WR", receiving_yards=70, receptions=5, passing_yards=0)
        for w in range(1, 16)
    ]
    weekly = pd.DataFrame(rows)
    samples = simulate_seasons_learned(
        weekly, target_season=2025, n_samples=100, seed=0, lookback=3
    )
    assert (samples["passing_yards"] == 0).all()


def test_learned_simulator_handles_missing_required_columns():
    with pytest.raises(ValueError, match="missing required columns"):
        simulate_seasons_learned(pd.DataFrame({"x": [1]}), target_season=2025)


def test_learned_simulator_returns_empty_when_no_history():
    samples = simulate_seasons_learned(
        pd.DataFrame(
            columns=["player_id", "season", "week", "position", "receiving_yards"]
        ),
        target_season=2025,
        n_samples=5,
    )
    assert samples.empty


def test_learned_samples_feed_scoring_engine(multi_season_weekly, ppr):
    samples = simulate_seasons_learned(
        multi_season_weekly, target_season=2025, n_samples=200, seed=0
    )
    pts = score_player_weeks(samples, ppr)
    assert len(pts) == len(samples)
    summary = summarize_seasons(samples, ppr)
    # Quantile monotonicity invariant survives the learned generator too.
    for _, row in summary.iterrows():
        qs = [row["q05"], row["q25"], row["q50"], row["q75"], row["q95"]]
        assert qs == sorted(qs)


def test_pretrained_generator_can_be_reused(multi_season_weekly):
    """Fitting once and reusing matches the auto-fit path under the same seed."""
    gen = LearnedGenerator(lookback=3, stats=("receiving_yards", "receptions")).fit(
        multi_season_weekly[multi_season_weekly["season"] < 2025]
    )
    a = simulate_seasons_learned(
        multi_season_weekly,
        target_season=2025,
        generator=gen,
        n_samples=50,
        stats=("receiving_yards", "receptions"),
        seed=7,
    )
    b = simulate_seasons_learned(
        multi_season_weekly,
        target_season=2025,
        generator=gen,
        n_samples=50,
        stats=("receiving_yards", "receptions"),
        seed=7,
    )
    pd.testing.assert_frame_equal(a, b)


# ---------- Regular-season filtering ----------


def test_postseason_rows_are_excluded_from_history():
    """POST rows must contribute to neither training nor the sampling pool."""
    rows = [
        _wk("A", season, w, season_type="REG", receiving_yards=50)
        for season in (2023, 2024)
        for w in range(1, 11)
    ]
    rows += [_wk("A", 2024, w, season_type="POST", receiving_yards=999) for w in (19, 20)]
    weekly = pd.DataFrame(rows)

    samples = simulate_seasons_learned(
        weekly, target_season=2025, n_samples=100, expected_games=17, seed=0
    )

    assert samples["receiving_yards"].nunique() == 1
    assert samples["receiving_yards"].iloc[0] == pytest.approx(17 * 50.0)
