import numpy as np
import pandas as pd

from ffa.rookies import (
    augment_with_rookies,
    build_cohort_pool,
    draft_class,
    draft_round_bucket,
    normalize_draft_picks,
    simulate_rookies,
)


def _wk(player_id, season, week, position="WR", **stats):
    base = {
        "player_id": player_id,
        "player_display_name": player_id,
        "position": position,
        "recent_team": "TEAM",
        "season": season,
        "week": week,
        "season_type": "REG",
    }
    base.update(stats)
    return base


def _draft(player_id, season, round_, position="WR", pick=10, name=None, team="TEAM"):
    return {
        "player_id": player_id,
        "season": season,
        "round": round_,
        "pick": pick,
        "position": position,
        "player_display_name": name or player_id,
        "recent_team": team,
    }


# ---------- draft_round_bucket ----------


def test_draft_round_bucket_named_and_overflow():
    assert draft_round_bucket(1) == "R1"
    assert draft_round_bucket(3) == "R3"
    assert draft_round_bucket(4) == "R4+"
    assert draft_round_bucket(7) == "R4+"


# ---------- normalize_draft_picks ----------


def test_normalize_draft_picks_maps_nflverse_names():
    raw = pd.DataFrame([{"gsis_id": "00-1", "pfr_player_name": "Joe", "team": "KC", "round": 1}])
    out = normalize_draft_picks(raw)
    assert "player_id" in out.columns and out.loc[0, "player_id"] == "00-1"
    assert "player_display_name" in out.columns and out.loc[0, "player_display_name"] == "Joe"
    assert "recent_team" in out.columns and out.loc[0, "recent_team"] == "KC"


# ---------- draft_class ----------


def test_draft_class_filters_skill_positions_and_buckets():
    dp = pd.DataFrame(
        [
            _draft("A", 2024, 1, "RB"),
            _draft("B", 2024, 4, "WR"),
            _draft("C", 2024, 1, "T"),  # non-skill, dropped
            _draft("D", 2023, 1, "QB"),  # wrong season
        ]
    )
    cls = draft_class(dp, 2024)
    assert set(cls["player_id"]) == {"A", "B"}
    assert cls.set_index("player_id").loc["A", "bucket"] == "R1"
    assert cls.set_index("player_id").loc["B", "bucket"] == "R4+"


# ---------- build_cohort_pool ----------


def _cohort_fixture():
    """Two prior R1 WR classes (rookie rows) plus noise that must be excluded."""
    draft = pd.DataFrame(
        [
            _draft("rook20", 2020, 1, "WR"),
            _draft("rook21", 2021, 1, "WR"),
            _draft("rb21", 2021, 1, "RB"),
            _draft("late", 2021, 5, "WR"),
        ]
    )
    rows = []
    # Rookie-season rows (season == draft season): these populate the pool.
    for w in range(1, 9):
        rows.append(_wk("rook20", 2020, w, "WR", receiving_yards=60, receptions=5))
        rows.append(_wk("rook21", 2021, w, "WR", receiving_yards=80, receptions=6))
        rows.append(_wk("rb21", 2021, w, "RB", rushing_yards=70))
        rows.append(_wk("late", 2021, w, "WR", receiving_yards=20, receptions=2))
    # Sophomore rows for rook20 (season 2021 != draft 2020): must be excluded.
    for w in range(1, 9):
        rows.append(_wk("rook20", 2021, w, "WR", receiving_yards=999, receptions=99))
    return pd.DataFrame(rows), draft


def test_cohort_pool_only_rookie_season_rows_from_prior_classes():
    weekly, draft = _cohort_fixture()
    pool = build_cohort_pool(weekly, draft, before_season=2022, lookback_classes=6)

    wr_r1 = pool[(pool["position"] == "WR") & (pool["bucket"] == "R1")]
    # 8 rows from rook20 (2020) + 8 from rook21 (2021); sophomore 999s excluded.
    assert len(wr_r1) == 16
    assert wr_r1["receiving_yards"].max() <= 80  # no leaked 999 sophomore rows
    # RB R1 cohort kept separate.
    assert len(pool[(pool["position"] == "RB") & (pool["bucket"] == "R1")]) == 8


def test_cohort_pool_excludes_target_and_future_classes():
    weekly, draft = _cohort_fixture()
    # before_season 2021 -> only the 2020 class qualifies.
    pool = build_cohort_pool(weekly, draft, before_season=2021, lookback_classes=6)
    assert set(pool["position"].unique()) == {"WR"}
    assert len(pool) == 8  # rook20 only


# ---------- simulate_rookies ----------


def test_simulate_rookies_contract_and_determinism():
    weekly, draft = _cohort_fixture()
    draft = pd.concat([draft, pd.DataFrame([_draft("newWR", 2022, 1, "WR")])], ignore_index=True)

    a = simulate_rookies(weekly, draft, target_season=2022, n_samples=100, expected_games=17, seed=1)
    b = simulate_rookies(weekly, draft, target_season=2022, n_samples=100, expected_games=17, seed=1)

    assert {"player_id", "sample_idx", "receiving_yards", "position"} <= set(a.columns)
    assert (a["player_id"] == "newWR").all()
    assert a["position"].iloc[0] == "WR"
    assert len(a) == 100
    pd.testing.assert_frame_equal(a, b)
    # Season totals are ~17 * cohort-per-game (60-80 yds); sanity bounds.
    assert 17 * 40 < a["receiving_yards"].mean() < 17 * 100


def test_simulate_rookies_falls_back_to_position_pool_when_cohort_thin():
    weekly, draft = _cohort_fixture()
    # New R1 RB: the (RB, R1) pool has only 8 rows (< default min_pool_games=24),
    # so it should fall back to the position-wide RB pool rather than skip.
    draft = pd.concat([draft, pd.DataFrame([_draft("newRB", 2022, 1, "RB")])], ignore_index=True)

    out = simulate_rookies(
        weekly, draft, target_season=2022, n_samples=50, expected_games=17, seed=0,
    )
    rb = out[out["player_id"] == "newRB"]
    assert len(rb) == 50
    assert rb["rushing_yards"].mean() > 0


def test_simulate_rookies_skips_position_with_no_pool():
    weekly, draft = _cohort_fixture()
    # No QB has ever appeared -> a new QB rookie has no cohort and is skipped.
    draft = pd.concat([draft, pd.DataFrame([_draft("newQB", 2022, 1, "QB")])], ignore_index=True)
    out = simulate_rookies(weekly, draft, target_season=2022, n_samples=50, seed=0)
    assert "newQB" not in set(out["player_id"])


def test_simulate_rookies_empty_when_no_incoming_class():
    weekly, draft = _cohort_fixture()
    out = simulate_rookies(weekly, draft, target_season=2030, n_samples=50, seed=0)
    assert out.empty


# ---------- augment_with_rookies ----------


def test_augment_appends_rookies_to_veteran_samples():
    weekly, draft = _cohort_fixture()
    draft = pd.concat([draft, pd.DataFrame([_draft("newWR", 2022, 1, "WR")])], ignore_index=True)
    veteran = pd.DataFrame(
        {
            "player_id": ["vet"] * 50,
            "sample_idx": np.arange(50),
            "receiving_yards": np.full(50, 500.0),
            "receptions": np.full(50, 50.0),
            "position": "WR",
        }
    )

    out = augment_with_rookies(
        veteran, weekly, draft, target_season=2022, n_samples=50, expected_games=17, seed=0
    )
    assert set(out["player_id"]) == {"vet", "newWR"}
    assert len(out) == 100


def test_augment_is_noop_without_projectable_rookies():
    weekly, draft = _cohort_fixture()  # no 2022 class in this draft frame
    veteran = pd.DataFrame(
        {"player_id": ["vet"], "sample_idx": [0], "receiving_yards": [500.0], "position": ["WR"]}
    )
    out = augment_with_rookies(veteran, weekly, draft, target_season=2022, n_samples=1, seed=0)
    pd.testing.assert_frame_equal(out, veteran)
