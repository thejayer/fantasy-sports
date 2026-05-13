import pandas as pd
import pytest

from ffa.scoring import score_player_weeks, score_stat_line


# ---------- QB stat lines ----------


def test_qb_standard_scoring(standard):
    # 300 pass yds = 12, 3 pass TD = 12, 1 INT = -2, 20 rush yds = 2 -> 24
    pts = score_stat_line(
        {
            "passing_yards": 300,
            "passing_tds": 3,
            "interceptions": 1,
            "rushing_yards": 20,
        },
        standard,
    )
    assert pts == pytest.approx(24.0)


def test_qb_passing_2pt_conversion(standard):
    pts = score_stat_line({"passing_2pt_conversions": 1}, standard)
    assert pts == pytest.approx(2.0)


# ---------- WR stat lines ----------


def test_wr_standard_vs_ppr_vs_half(standard, ppr, half_ppr):
    line = {"receptions": 8, "receiving_yards": 100, "receiving_tds": 1}
    # standard: 10 + 6 = 16
    assert score_stat_line(line, standard) == pytest.approx(16.0)
    # ppr: 16 + 8 = 24
    assert score_stat_line(line, ppr) == pytest.approx(24.0)
    # half ppr: 16 + 4 = 20
    assert score_stat_line(line, half_ppr) == pytest.approx(20.0)


# ---------- Bonuses ----------


def test_yardage_bonuses_stack_for_200_yard_game(superflex_bonus):
    # 200 rush yds = 20 base + 6 TD = 26, +3 (>=100) + 5 (>=200) = 34
    line = {"rushing_yards": 200, "rushing_tds": 1}
    pts = score_stat_line(line, superflex_bonus)
    assert pts == pytest.approx(34.0)


def test_passing_bonus_at_300_yards(superflex_bonus):
    # 300 pass yds = 12 base, +6 TD = 18, +3 (>=300) = 21; below 400 -> no second bonus
    line = {"passing_yards": 300, "passing_tds": 1}
    pts = score_stat_line(line, superflex_bonus)
    assert pts == pytest.approx(21.0)


# ---------- Fumbles ----------


def test_fumbles_lost_aggregate_across_columns(standard):
    line = {"rushing_fumbles_lost": 1, "receiving_fumbles_lost": 1, "sack_fumbles_lost": 1}
    # 3 fumbles lost * -2 = -6
    assert score_stat_line(line, standard) == pytest.approx(-6.0)


# ---------- Vectorized form ----------


def test_score_player_weeks_is_vectorized_and_pure(ppr):
    df = pd.DataFrame(
        [
            {"receptions": 5, "receiving_yards": 50, "receiving_tds": 0},
            {"receptions": 0, "receiving_yards": 0, "receiving_tds": 0},
            {"receptions": 10, "receiving_yards": 120, "receiving_tds": 2},
        ],
    )
    before = df.copy()
    pts = score_player_weeks(df, ppr)
    pd.testing.assert_frame_equal(df, before)  # purity: inputs untouched
    assert list(pts.round(1)) == [10.0, 0.0, 34.0]


def test_missing_columns_are_treated_as_zero(standard):
    # A projection DF might only carry the stats the model produced.
    df = pd.DataFrame([{"passing_yards": 250}])
    pts = score_player_weeks(df, standard)
    assert pts.iloc[0] == pytest.approx(10.0)


def test_empty_dataframe_returns_empty_series(standard):
    df = pd.DataFrame(columns=["passing_yards"])
    pts = score_player_weeks(df, standard)
    assert len(pts) == 0
