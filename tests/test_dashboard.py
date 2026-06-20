"""Tests for the dashboard's pure chart/table helpers.

These don't spin up Streamlit. The key guard is that ``distribution_chart``
produces a valid Altair spec -- calling ``.to_dict()`` runs the same schema
validation that raised ``SchemaValidationError`` in the browser when the old
code fed pandas Interval objects to ``st.bar_chart``.
"""

import numpy as np
import pandas as pd
import pytest

pytest.importorskip("altair", reason="dashboard extras not installed")
pytest.importorskip("streamlit", reason="dashboard extras not installed")

from ffa.dashboard import (  # noqa: E402
    availability_view,
    distribution_chart,
    outcome_sparklines,
    risk_badges,
)
from ffa.league import LeagueConfig  # noqa: E402


def test_risk_badges_split_field_into_terciles():
    # Nine players with increasing relative spread (q95-q05)/q50.
    rels = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    q50 = [100.0] * 9
    q05 = [100 - 50 * r for r in rels]
    q95 = [100 + 50 * r for r in rels]
    labels = risk_badges(q05, q50, q95)
    assert labels[0] == "🟢 Safe"        # tightest of the field
    assert labels[-1] == "🔴 Volatile"   # widest of the field
    assert labels.count("🟢 Safe") == 3 and labels.count("🔴 Volatile") == 3


def test_risk_badges_guards_nan_and_empty():
    assert risk_badges([10], [0], [20]) == ["—"]   # q50 <= 0
    assert risk_badges([], [], []) == []


def test_outcome_sparklines_bins_per_player_on_shared_scale():
    # Two players: one low (~10 pts), one high (~200 pts). Shared range -> the
    # high player's mass sits in later bins than the low player's.
    rng = np.random.default_rng(0)
    rows = []
    for pid, lvl in (("low", 10.0), ("high", 200.0)):
        for _ in range(500):
            rows.append({"player_id": pid, "receiving_yards": max(0.0, lvl + rng.normal(0, 5)) * 10})
    samples = pd.DataFrame(rows)
    league = LeagueConfig()  # 1 pt / 10 receiving yards under defaults

    sparks = outcome_sparklines(samples, league, ["low", "high"], bins=8)
    assert set(sparks) == {"low", "high"}
    assert len(sparks["low"]) == 8 and sum(sparks["low"]) == 500
    # Low player's outcomes fall in the first bins; high player's spread later.
    low_centroid = np.average(range(8), weights=sparks["low"])
    high_centroid = np.average(range(8), weights=sparks["high"])
    assert high_centroid > low_centroid


def test_outcome_sparklines_empty_for_unknown_players():
    samples = pd.DataFrame({"player_id": ["A"], "receiving_yards": [50.0]})
    assert outcome_sparklines(samples, LeagueConfig(), ["Z"]) == {}


def test_distribution_chart_produces_valid_altair_spec():
    rng = np.random.default_rng(0)
    pts = pd.Series(rng.normal(180, 30, size=1000))
    chart = distribution_chart(pts, floor=130.0, median=180.0, ceiling=230.0)
    # .to_dict() runs Altair schema validation; this is what used to blow up.
    spec = chart.to_dict()
    assert "layer" in spec or "vconcat" in spec or "mark" in spec


def test_distribution_chart_handles_small_sample():
    pts = pd.Series([10.0, 12.0, 15.0])
    chart = distribution_chart(pts, 10.0, 12.0, 15.0)
    assert chart.to_dict()  # no exception


def test_distribution_chart_handles_constant_series():
    pts = pd.Series([100.0] * 50)
    chart = distribution_chart(pts, 100.0, 100.0, 100.0)
    assert chart.to_dict()


def test_availability_view_formats_percentages_and_joins_names():
    availability = pd.DataFrame(
        {
            "player_id": ["A", "B", "C"],
            "round_1": [1.0, 0.5, 0.0],
            "round_2": [0.8, 0.2, 0.0],
        }
    )
    ranked = pd.DataFrame(
        {
            "player_id": ["A", "B", "C"],
            "player_display_name": ["Alice", "Bob", "Carol"],
            "position": ["WR", "RB", "TE"],
            "vor": [50.0, 30.0, 10.0],
        }
    )
    view = availability_view(availability, ranked, top=10)

    assert list(view["player_display_name"]) == ["Alice", "Bob", "Carol"]  # sorted by vor desc
    # Percentages scaled to 0-100.
    assert view.loc[view["player_display_name"] == "A", "round_1"].empty  # name-joined, not id
    assert view["round_1"].tolist() == [100.0, 50.0, 0.0]
    assert "position" in view.columns


def test_availability_view_handles_missing_meta():
    availability = pd.DataFrame({"player_id": ["A"], "round_1": [0.5]})
    ranked = pd.DataFrame({"player_id": ["A"], "vor": [10.0]})
    view = availability_view(availability, ranked)
    assert view["round_1"].tolist() == [50.0]


@pytest.mark.parametrize("bad_value", [np.nan])
def test_distribution_chart_tolerates_nan_rules(bad_value):
    pts = pd.Series([1.0, 2.0, 3.0, 4.0])
    # Even if a quantile came back NaN, building the spec shouldn't raise.
    chart = distribution_chart(pts, bad_value, 2.5, bad_value)
    assert chart.to_dict()
