import numpy as np
import pandas as pd
import pytest

from ffa.backtest import (
    evaluate_projections,
    pinball_loss,
    realized_season_totals,
    run_backtest,
    summarize_evaluation,
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


def _multi_season(levels=None) -> pd.DataFrame:
    """Players with distinct, stable per-game rates across four seasons."""
    if levels is None:
        levels = {"A": 30.0, "B": 60.0, "C": 90.0}
    rng = np.random.default_rng(0)
    rows = []
    for player_id, level in levels.items():
        for season in (2021, 2022, 2023, 2024):
            for week in range(1, 15):
                yds = float(max(0.0, level + rng.normal(0, 3)))
                rows.append(_wk(player_id, season, week, receiving_yards=yds))
    return pd.DataFrame(rows)


# ---------- Realized totals ----------


def test_realized_totals_sums_and_scores(standard):
    rows = [_wk("A", 2024, w, receiving_yards=100) for w in range(1, 5)]
    rows += [_wk("B", 2024, w, position="RB", rushing_yards=50) for w in range(1, 3)]
    weekly = pd.DataFrame(rows)

    real = realized_season_totals(weekly, 2024, standard)

    a = real.loc[real["player_id"] == "A"].iloc[0]
    assert a["games_played"] == 4
    assert a["receiving_yards"] == pytest.approx(400.0)
    assert a["points_realized"] == pytest.approx(40.0)  # standard: 10 rec yds / pt
    b = real.loc[real["player_id"] == "B"].iloc[0]
    assert b["games_played"] == 2
    assert b["points_realized"] == pytest.approx(10.0)


def test_realized_totals_excludes_postseason(standard):
    rows = [_wk("A", 2024, w, season_type="REG", receiving_yards=100) for w in range(1, 5)]
    rows += [_wk("A", 2024, 19, season_type="POST", receiving_yards=999)]

    real = realized_season_totals(pd.DataFrame(rows), 2024, standard)

    assert real.iloc[0]["receiving_yards"] == pytest.approx(400.0)
    assert real.iloc[0]["games_played"] == 4


# ---------- Pinball loss ----------


def test_pinball_loss_hand_computed():
    # Realized above the prediction: loss = tau * (y - q).
    assert pinball_loss([10.0], [8.0], tau=0.9) == pytest.approx(0.9 * 2.0)
    # Realized below the prediction: loss = (1 - tau) * (q - y).
    assert pinball_loss([10.0], [14.0], tau=0.9) == pytest.approx(0.1 * 4.0)
    # Mean over pairs at the median.
    assert pinball_loss([10.0, 10.0], [8.0, 14.0], tau=0.5) == pytest.approx((1.0 + 2.0) / 2)


# ---------- Metric summary ----------


def test_summarize_evaluation_metrics_hand_checked():
    evald = pd.DataFrame(
        {
            "player_id": list("abcd"),
            "position": ["WR"] * 4,
            "points_mean": [100.0, 80.0, 60.0, 40.0],
            "points_realized": [90.0, 85.0, 55.0, 45.0],
            "q05": [50.0, 40.0, 30.0, 50.0],  # d: realized 45 < q05 50 -> outside
            "q95": [150.0, 120.0, 90.0, 60.0],
        }
    )

    met = summarize_evaluation(evald)
    all_row = met.loc[met["position"] == "ALL"].iloc[0]

    # Errors: +10, -5, +5, -5.
    assert all_row["n_players"] == 4
    assert all_row["mae"] == pytest.approx(6.25)
    assert all_row["bias"] == pytest.approx(1.25)
    assert all_row["spearman"] == pytest.approx(1.0)  # identical rank order
    assert all_row["cover_q05_q95"] == pytest.approx(3 / 4)
    # Per-position row exists and matches (single position).
    wr_row = met.loc[met["position"] == "WR"].iloc[0]
    assert wr_row["mae"] == pytest.approx(6.25)


def test_evaluate_projections_inner_joins_and_filters_positions():
    summary = pd.DataFrame(
        {
            "player_id": ["A", "B", "K1"],
            "position": ["WR", "RB", "K"],
            "points_mean": [100.0, 90.0, 120.0],
        }
    )
    realized = pd.DataFrame(
        {
            "player_id": ["A", "K1", "ROOKIE"],
            "games_played": [10, 10, 10],
            "points_realized": [95.0, 110.0, 80.0],
        }
    )

    evald = evaluate_projections(summary, realized)

    # B never played, K1 is filtered by position, ROOKIE was never projected.
    assert evald["player_id"].tolist() == ["A"]


# ---------- Walk-forward end to end ----------


def test_run_backtest_end_to_end(standard):
    weekly = _multi_season()

    result = run_backtest(
        weekly, seasons=[2023, 2024], league=standard, generator="bootstrap",
        n_samples=200, seed=0,
    )

    met = result.metrics
    assert set(met["season"].unique()) == {2023, 2024}
    all_rows = met[met["position"] == "ALL"]
    assert (all_rows["n_players"] == 3).all()
    # Distinct stable levels -> projected rank order matches realized.
    assert (all_rows["spearman"] > 0.99).all()
    # Synthetic seasons are 14 games but projections assume 17 -> optimistic.
    assert (all_rows["bias"] > 0).all()
    assert ((all_rows["cover_q05_q95"] >= 0) & (all_rows["cover_q05_q95"] <= 1)).all()
    # Player-level rows: 3 players x 2 seasons.
    assert len(result.players) == 6


def test_run_backtest_counts_unprojected_rookies(standard):
    weekly = _multi_season()
    rookie = [_wk("ROOKIE", 2024, w, receiving_yards=80) for w in range(1, 15)]
    weekly = pd.concat([weekly, pd.DataFrame(rookie)], ignore_index=True)

    result = run_backtest(
        weekly, seasons=[2024], league=standard, generator="bootstrap",
        n_samples=100, seed=0,
    )

    all_row = result.metrics.loc[result.metrics["position"] == "ALL"].iloc[0]
    assert all_row["n_unprojected"] == 1
    assert "ROOKIE" not in set(result.players["player_id"])


def test_run_backtest_never_uses_holdout_data(standard):
    """A monster holdout season must not leak into its own projection."""
    weekly = _multi_season(levels={"A": 30.0})
    boom = [_wk("A", 2024, w, receiving_yards=300.0) for w in range(15, 18)]
    weekly = pd.concat([weekly, pd.DataFrame(boom)], ignore_index=True)

    result = run_backtest(
        weekly, seasons=[2024], league=standard, generator="bootstrap",
        n_samples=200, seed=0,
    )

    row = result.players.iloc[0]
    # History caps out near 30 yds/game; 17 * ~40 is a generous ceiling that
    # the projection can only exceed by sampling leaked 300-yard games.
    assert row["points_mean"] < 17 * 40 / 10
    # Realized totals DO include the boom games (they happened).
    assert row["points_realized"] > row["points_mean"]


def test_run_backtest_learned_generator_smoke(standard):
    weekly = _multi_season()

    result = run_backtest(
        weekly, seasons=[2024], league=standard, generator="learned",
        n_samples=50, seed=0,
    )

    all_row = result.metrics.loc[result.metrics["position"] == "ALL"].iloc[0]
    assert all_row["n_players"] == 3
    assert np.isfinite(all_row["mae"])


def test_run_backtest_deterministic(standard):
    weekly = _multi_season()
    a = run_backtest(weekly, [2024], standard, generator="bootstrap", n_samples=100, seed=7)
    b = run_backtest(weekly, [2024], standard, generator="bootstrap", n_samples=100, seed=7)
    pd.testing.assert_frame_equal(a.metrics, b.metrics)
    pd.testing.assert_frame_equal(a.players, b.players)


def test_run_backtest_unknown_generator_raises(standard):
    weekly = pd.DataFrame([_wk("A", 2023, 1, receiving_yards=10)])
    with pytest.raises(ValueError, match="Unknown generator"):
        run_backtest(weekly, [2024], standard, generator="nope")


def _draft_row(player_id, season, round_, position="WR", pick=10):
    return {
        "player_id": player_id,
        "season": season,
        "round": round_,
        "pick": pick,
        "position": position,
        "player_display_name": player_id,
        "recent_team": "TEAM",
    }


def test_run_backtest_include_rookies_reduces_blind_spot(standard):
    weekly = _multi_season()  # veterans A/B/C, 2021-2024
    rows = []
    # Prior-class WR rookies whose rookie-season rows form the cohort pool.
    for pid, yr in (("p21", 2021), ("p22", 2022), ("p23", 2023)):
        for w in range(1, 15):
            rows.append(_wk(pid, yr, w, receiving_yards=55.0))
    # Incoming rookie: rows only in the holdout season (no prior history).
    for w in range(1, 15):
        rows.append(_wk("ROOK", 2024, w, receiving_yards=60.0))
    weekly = pd.concat([weekly, pd.DataFrame(rows)], ignore_index=True)
    draft = pd.DataFrame(
        [_draft_row("p21", 2021, 1), _draft_row("p22", 2022, 1),
         _draft_row("p23", 2023, 1), _draft_row("ROOK", 2024, 1)]
    )

    base = run_backtest(weekly, [2024], standard, generator="bootstrap", n_samples=100, seed=0)
    rk = run_backtest(
        weekly, [2024], standard, generator="bootstrap", n_samples=100,
        include_rookies=True, draft_picks=draft, seed=0,
    )

    # The incoming rookie is a blind spot for the veteran-only run...
    assert "ROOK" not in set(base.players["player_id"])
    base_all = base.metrics.loc[base.metrics["position"] == "ALL"].iloc[0]
    assert base_all["n_unprojected"] >= 1
    # ...and becomes projected (and scored) once rookies are included.
    assert "ROOK" in set(rk.players["player_id"])
    rk_all = rk.metrics.loc[rk.metrics["position"] == "ALL"].iloc[0]
    assert rk_all["n_unprojected"] < base_all["n_unprojected"]
    assert rk_all["n_players"] > base_all["n_players"]


def test_run_backtest_include_rookies_requires_draft_picks(standard):
    weekly = _multi_season()
    with pytest.raises(ValueError, match="requires a draft_picks"):
        run_backtest(weekly, [2024], standard, include_rookies=True)
