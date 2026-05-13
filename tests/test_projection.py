import math

import numpy as np
import pandas as pd
import pytest

from ffa.projection import (
    DEFAULT_DEPTH_MULTIPLIERS,
    apply_depth_multiplier,
    latest_depth_chart,
    project_per_game,
    project_season,
)
from ffa.scoring import score_player_weeks


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


# ---------- Recency weighting math ----------


def test_constant_average_recovers_input_per_game():
    """Two seasons at identical per-game rate must yield that rate exactly."""
    # 10 games per season, 200 receiving yards each game.
    rows = []
    for season in (2023, 2024):
        for week in range(1, 11):
            rows.append(_wk("A", season, week, receiving_yards=200, receptions=10))
    weekly = pd.DataFrame(rows)

    proj = project_per_game(weekly, target_season=2025, lookback=3, decay=0.5)

    row = proj.loc[proj["player_id"] == "A"].iloc[0]
    assert row["receiving_yards"] == pytest.approx(200.0)
    assert row["receptions"] == pytest.approx(10.0)


def test_recency_weight_pulls_toward_recent_season():
    """If recent season is higher-rate, weighted per-game must exceed older rate."""
    rows = []
    # 2023: 5 games at 10 yds = 50 yds total, 10 yds/game
    for week in range(1, 6):
        rows.append(_wk("A", 2023, week, receiving_yards=10))
    # 2024: 10 games at 40 yds = 400 yds total, 40 yds/game
    for week in range(1, 11):
        rows.append(_wk("A", 2024, week, receiving_yards=40))
    weekly = pd.DataFrame(rows)

    proj = project_per_game(weekly, target_season=2025, lookback=3, decay=0.5)
    yds = proj.loc[proj["player_id"] == "A", "receiving_yards"].iloc[0]

    # Hand calc:
    #   w_2024 = exp(-0.5) ~ 0.6065;  w_2023 = exp(-1.0) ~ 0.3679
    #   weighted_yds   = 0.6065*400 + 0.3679*50    = 260.6
    #   weighted_games = 0.6065*10  + 0.3679*5     =   7.905
    #   per_game       = 32.97
    w24, w23 = math.exp(-0.5), math.exp(-1.0)
    expected = (w24 * 400 + w23 * 50) / (w24 * 10 + w23 * 5)
    assert yds == pytest.approx(expected, rel=1e-4)
    assert 10 < yds < 40  # sanity: between the two season rates


def test_decay_zero_is_uniform_weighting():
    """decay=0 collapses recency weight to 1 across all lookback seasons."""
    rows = []
    for week in range(1, 11):
        rows.append(_wk("A", 2023, week, rushing_yards=10))
    for week in range(1, 11):
        rows.append(_wk("A", 2024, week, rushing_yards=30))
    weekly = pd.DataFrame(rows)

    proj = project_per_game(weekly, target_season=2025, lookback=3, decay=0.0)
    # Uniform weights -> (300 + 100) / (10 + 10) = 20
    assert proj.loc[proj["player_id"] == "A", "rushing_yards"].iloc[0] == pytest.approx(20.0)


def test_min_weighted_games_filter_drops_short_history():
    """A 2-game player should be filtered when the floor is set high."""
    rows = [_wk("A", 2024, w, receiving_yards=50) for w in (1, 2)]
    # Add a healthy player so the output isn't empty.
    rows += [_wk("B", 2024, w, receiving_yards=50) for w in range(1, 17)]
    weekly = pd.DataFrame(rows)

    proj = project_per_game(weekly, target_season=2025, min_weighted_games=4.0)
    assert "A" not in proj["player_id"].values
    assert "B" in proj["player_id"].values


def test_lookback_window_excludes_old_seasons():
    """Seasons older than the lookback window must not influence the projection."""
    rows = [_wk("A", 2018, w, rushing_yards=999) for w in range(1, 17)]
    rows += [_wk("A", 2024, w, rushing_yards=50) for w in range(1, 17)]
    weekly = pd.DataFrame(rows)

    proj = project_per_game(weekly, target_season=2025, lookback=3, decay=0.5)
    yds = proj.loc[proj["player_id"] == "A", "rushing_yards"].iloc[0]
    assert yds == pytest.approx(50.0)


# ---------- Purity / metadata ----------


def test_projection_is_pure(weekly_fixture):
    before = weekly_fixture.copy()
    project_per_game(weekly_fixture, target_season=2025)
    pd.testing.assert_frame_equal(weekly_fixture, before)


def test_metadata_carried_through(weekly_fixture):
    proj = project_per_game(weekly_fixture, target_season=2025)
    assert "position" in proj.columns
    assert "recent_team" in proj.columns


def test_missing_required_columns_raise():
    with pytest.raises(ValueError, match="missing required columns"):
        project_per_game(pd.DataFrame({"x": [1]}), target_season=2025)


# ---------- Depth chart adjustment ----------


def test_latest_depth_chart_picks_most_recent_week():
    dc = pd.DataFrame(
        [
            {"player_id": "A", "position": "WR", "season": 2024, "week": 1, "depth_team": "2"},
            {"player_id": "A", "position": "WR", "season": 2024, "week": 17, "depth_team": "1"},
            {"player_id": "B", "position": "RB", "season": 2024, "week": 5, "depth_team": "3"},
        ],
    )
    latest = latest_depth_chart(dc)
    assert latest.loc[latest["player_id"] == "A", "depth_position"].iloc[0] == 1
    assert latest.loc[latest["player_id"] == "B", "depth_position"].iloc[0] == 3


def test_depth_multiplier_scales_per_position():
    projections = pd.DataFrame(
        [
            {"player_id": "WR1", "position": "WR", "receiving_yards": 100, "receptions": 8},
            {"player_id": "WR4", "position": "WR", "receiving_yards": 100, "receptions": 8},
            {"player_id": "RB1", "position": "RB", "rushing_yards": 100, "rushing_tds": 1},
        ],
    )
    depth = pd.DataFrame(
        [
            {"player_id": "WR1", "depth_position": 1},
            {"player_id": "WR4", "depth_position": 4},
            {"player_id": "RB1", "depth_position": 1},
        ],
    )
    adjusted = apply_depth_multiplier(projections, depth)

    wr1 = adjusted.loc[adjusted["player_id"] == "WR1"].iloc[0]
    wr4 = adjusted.loc[adjusted["player_id"] == "WR4"].iloc[0]
    rb1 = adjusted.loc[adjusted["player_id"] == "RB1"].iloc[0]

    assert wr1["receiving_yards"] == pytest.approx(100.0)
    assert wr4["receiving_yards"] == pytest.approx(100.0 * DEFAULT_DEPTH_MULTIPLIERS["WR"][4])
    assert rb1["rushing_yards"] == pytest.approx(100.0)


def test_depth_multiplier_zeroes_out_unconfigured_slot():
    """A WR6 isn't in the default table -> multiplier 0."""
    projections = pd.DataFrame(
        [{"player_id": "WR6", "position": "WR", "receiving_yards": 50}],
    )
    depth = pd.DataFrame([{"player_id": "WR6", "depth_position": 6}])
    adjusted = apply_depth_multiplier(projections, depth)
    assert adjusted["receiving_yards"].iloc[0] == 0.0


def test_depth_multiplier_drop_missing_filters_undrafted():
    projections = pd.DataFrame(
        [
            {"player_id": "A", "position": "WR", "receiving_yards": 50},
            {"player_id": "B", "position": "WR", "receiving_yards": 50},
        ],
    )
    depth = pd.DataFrame([{"player_id": "A", "depth_position": 1}])
    adjusted = apply_depth_multiplier(projections, depth, drop_missing=True)
    assert list(adjusted["player_id"]) == ["A"]


# ---------- Season totals + scoring round-trip ----------


def test_project_season_scalar_multiplies_all_stats():
    per_game = pd.DataFrame(
        [{"player_id": "A", "position": "RB", "rushing_yards": 80, "rushing_tds": 0.5}],
    )
    season = project_season(per_game, expected_games=17.0)
    row = season.iloc[0]
    assert row["rushing_yards"] == pytest.approx(80 * 17)
    assert row["rushing_tds"] == pytest.approx(0.5 * 17)


def test_project_season_series_allows_per_player_overrides():
    per_game = pd.DataFrame(
        [
            {"player_id": "A", "rushing_yards": 80},
            {"player_id": "B", "rushing_yards": 100},
        ],
    )
    games = pd.Series([13.0, 17.0], index=per_game.index)
    season = project_season(per_game, expected_games=games)
    assert season["rushing_yards"].tolist() == pytest.approx([80 * 13, 100 * 17])


def test_projection_feeds_scoring_engine(standard):
    """End-to-end: weekly history -> per-game -> season -> fantasy points."""
    rows = []
    for season in (2023, 2024):
        for w in range(1, 17):
            rows.append(
                _wk("A", season, w, position="RB", rushing_yards=80, rushing_tds=0.5),
            )
    weekly = pd.DataFrame(rows)

    per_game = project_per_game(weekly, target_season=2025)
    season = project_season(per_game, expected_games=17)
    pts = score_player_weeks(season, standard)

    # Per game: 8 rush yds-point + 3 rush TD pts = 11. Times 17 = 187.
    assert pts.iloc[0] == pytest.approx(187.0)


# ---------- Fixtures ----------


@pytest.fixture
def weekly_fixture() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    rows = []
    for player_id, position, base_yds in [("A", "WR", 60), ("B", "RB", 70), ("C", "QB", 250)]:
        for season in (2022, 2023, 2024):
            for week in range(1, 17):
                stat_col = {
                    "WR": "receiving_yards",
                    "RB": "rushing_yards",
                    "QB": "passing_yards",
                }[position]
                rows.append(
                    _wk(
                        player_id,
                        season,
                        week,
                        position=position,
                        **{stat_col: float(base_yds + rng.normal(0, 5))},
                    ),
                )
    return pd.DataFrame(rows)
