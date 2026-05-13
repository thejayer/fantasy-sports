"""Smoke tests for the warehouse plumbing.

The actual nfl_data_py fetch hits the network and isn't covered here. Instead
we write synthetic Parquet files and verify DuckDB picks them up as views and
that the scoring engine can be applied to the result.
"""

from pathlib import Path

import pandas as pd

from ffa.ingest import open_warehouse
from ffa.scoring import score_player_weeks


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
