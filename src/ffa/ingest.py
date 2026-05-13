"""Ingest weekly stats, rosters, and schedules from nflverse via nfl_data_py.

Writes Parquet to ``data/raw/`` and registers them as DuckDB views so
downstream code can query everything with one connection. This replaces the
legacy approach of scraping 15+ projection sites -- nflverse maintains a
single authoritative pull of the underlying play-by-play data, refreshed
during the season.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import duckdb
import pandas as pd

DEFAULT_RAW_DIR = Path("data/raw")


@dataclass(frozen=True)
class IngestResult:
    weekly_path: Path
    rosters_path: Path
    schedules_path: Path
    rows: dict[str, int]


def _import_module():
    """Import nfl_data_py lazily so tests don't require the package."""
    import nfl_data_py  # noqa: WPS433 -- intentional local import

    return nfl_data_py


def fetch_weekly(seasons: list[int]) -> pd.DataFrame:
    """Per-player per-game stats. The canonical input for the scoring engine."""
    return _import_module().import_weekly_data(seasons)


def fetch_rosters(seasons: list[int]) -> pd.DataFrame:
    return _import_module().import_seasonal_rosters(seasons)


def fetch_schedules(seasons: list[int]) -> pd.DataFrame:
    return _import_module().import_schedules(seasons)


def ingest_seasons(seasons: list[int], out_dir: Path = DEFAULT_RAW_DIR) -> IngestResult:
    """Pull weekly stats, rosters, and schedules; write one Parquet each."""
    out_dir.mkdir(parents=True, exist_ok=True)

    weekly = fetch_weekly(seasons)
    rosters = fetch_rosters(seasons)
    schedules = fetch_schedules(seasons)

    weekly_path = out_dir / "weekly.parquet"
    rosters_path = out_dir / "rosters.parquet"
    schedules_path = out_dir / "schedules.parquet"

    weekly.to_parquet(weekly_path, index=False)
    rosters.to_parquet(rosters_path, index=False)
    schedules.to_parquet(schedules_path, index=False)

    return IngestResult(
        weekly_path=weekly_path,
        rosters_path=rosters_path,
        schedules_path=schedules_path,
        rows={"weekly": len(weekly), "rosters": len(rosters), "schedules": len(schedules)},
    )


def open_warehouse(
    db_path: Path | str = "data/ffa.duckdb",
    raw_dir: Path = DEFAULT_RAW_DIR,
) -> duckdb.DuckDBPyConnection:
    """Open a DuckDB connection with the raw Parquet files registered as views.

    The DB file itself stays small -- the data lives in Parquet on disk, which
    keeps the warehouse cheap to rebuild and trivial to inspect with any other
    tool (pandas, polars, duckdb CLI).
    """
    con = duckdb.connect(str(db_path))
    raw_dir = Path(raw_dir)
    for name in ("weekly", "rosters", "schedules"):
        path = raw_dir / f"{name}.parquet"
        if path.exists():
            # DuckDB can't bind parameters inside read_parquet(); inline the
            # path with single-quote escaping. The path is internal, not user
            # input from the network, so this is sufficient.
            literal = str(path).replace("'", "''")
            con.execute(
                f"CREATE OR REPLACE VIEW {name} AS SELECT * FROM read_parquet('{literal}')"
            )
    return con
