"""Tests for the warehouse plumbing and the ingest boundary adapter.

The live nflreadpy fetch hits the network and isn't covered here. What *is*
covered are the pure helpers that sit between nflreadpy and the rest of the
package: Polars->pandas conversion, column normalization, and schema
validation -- the parts that protect downstream code from an upstream rename.
"""

from pathlib import Path

import pandas as pd
import pytest

from ffa.ingest import (
    REQUIRED_WEEKLY_KEYS,
    _to_pandas,
    normalize_weekly_columns,
    open_warehouse,
    validate_weekly_schema,
)
from ffa.scoring import STAT_COLUMNS, score_player_weeks


def _full_weekly_row(**overrides) -> dict:
    """A weekly row carrying every canonical key + stat column (zeros)."""
    row = {k: 0 for k in STAT_COLUMNS}
    row.update(
        {
            "player_id": "A",
            "season": 2024,
            "week": 1,
            "position": "QB",
            "recent_team": "KC",
        }
    )
    row.update(overrides)
    return row


# ---------- _to_pandas ----------


def test_to_pandas_passes_through_pandas():
    df = pd.DataFrame({"a": [1, 2]})
    assert _to_pandas(df) is df


def test_to_pandas_calls_to_pandas_on_polars_like():
    sentinel = pd.DataFrame({"a": [1]})

    class _PolarsLike:
        def to_pandas(self):
            return sentinel

    assert _to_pandas(_PolarsLike()) is sentinel


def test_to_pandas_rejects_unconvertible():
    with pytest.raises(TypeError, match="pandas or Polars"):
        _to_pandas(object())


# ---------- normalize_weekly_columns ----------


def test_normalize_renames_known_nflverse_aliases():
    raw = pd.DataFrame([{"team": "KC", "passing_interceptions": 2, "player_id": "A"}])
    out = normalize_weekly_columns(raw)
    assert "recent_team" in out.columns and "team" not in out.columns
    assert "interceptions" in out.columns and "passing_interceptions" not in out.columns
    assert out.loc[0, "recent_team"] == "KC"
    assert out.loc[0, "interceptions"] == 2


def test_normalize_is_passthrough_for_canonical_frame():
    canonical = pd.DataFrame([{"recent_team": "KC", "interceptions": 1, "player_id": "A"}])
    out = normalize_weekly_columns(canonical)
    assert list(out.columns) == list(canonical.columns)


def test_normalize_does_not_clobber_existing_canonical_column():
    # If both the alias and the canonical name exist, keep canonical untouched.
    raw = pd.DataFrame([{"team": "KC", "recent_team": "SF", "player_id": "A"}])
    out = normalize_weekly_columns(raw)
    assert out.loc[0, "recent_team"] == "SF"
    assert "team" in out.columns  # left alone, not renamed over recent_team


def test_normalize_does_not_mutate_input():
    raw = pd.DataFrame([{"team": "KC", "player_id": "A"}])
    before = list(raw.columns)
    normalize_weekly_columns(raw)
    assert list(raw.columns) == before


# ---------- validate_weekly_schema ----------


def test_validate_accepts_full_normalized_frame():
    df = pd.DataFrame([_full_weekly_row()])
    validate_weekly_schema(df)  # should not raise


def test_validate_raises_on_missing_structural_key():
    df = pd.DataFrame([_full_weekly_row()]).drop(columns=["player_id"])
    with pytest.raises(ValueError, match="required key columns"):
        validate_weekly_schema(df)


def test_validate_raises_on_missing_stat_with_actionable_message():
    df = pd.DataFrame([_full_weekly_row()]).drop(columns=["interceptions"])
    with pytest.raises(ValueError, match="WEEKLY_COLUMN_ALIASES"):
        validate_weekly_schema(df)


def test_validate_required_keys_constant_matches_engine_assumptions():
    # The keys the simulators independently require must be a subset.
    assert set(REQUIRED_WEEKLY_KEYS) == {"player_id", "season", "week"}


def test_raw_nflverse_shape_round_trips_through_normalize_then_validate():
    """A frame using raw nflverse names normalizes and then validates clean."""
    raw = pd.DataFrame([_full_weekly_row()]).rename(
        columns={"recent_team": "team", "interceptions": "passing_interceptions"}
    )
    # Drop canonical names entirely to mimic a true raw pull.
    normalized = normalize_weekly_columns(raw)
    validate_weekly_schema(normalized)
    assert "interceptions" in normalized.columns
    assert "recent_team" in normalized.columns


# ---------- warehouse ----------


def test_warehouse_registers_views_and_feeds_scoring(tmp_path: Path, ppr):
    raw = tmp_path / "raw"
    raw.mkdir()
    weekly = pd.DataFrame(
        [
            {"player_id": "A", "week": 1, "receptions": 5, "receiving_yards": 50},
            {"player_id": "A", "week": 2, "receptions": 8, "receiving_yards": 110, "receiving_tds": 1},
        ],
    )
    weekly.to_parquet(raw / "weekly.parquet", index=False)

    con = open_warehouse(db_path=tmp_path / "ffa.duckdb", raw_dir=raw)
    fetched = con.execute("SELECT * FROM weekly ORDER BY week").df()
    pts = score_player_weeks(fetched, ppr)
    # week 1 PPR: 5 + 5 = 10; week 2: 8 + 11 + 6 = 25
    assert list(pts.round(1)) == [10.0, 25.0]
