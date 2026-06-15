"""Ingest weekly stats, rosters, and schedules from nflverse via nflreadpy.

Writes Parquet to ``data/raw/`` and registers them as DuckDB views so
downstream code can query everything with one connection. This replaces the
legacy approach of scraping 15+ projection sites -- nflverse maintains a
single authoritative pull of the underlying play-by-play data, refreshed
during the season.

``nflreadpy`` is the maintained nflverse Python client (``nfl_data_py`` was
deprecated in 2025). It returns Polars frames, so this module converts to
pandas at the boundary and normalizes a couple of column renames back to the
names the rest of the package expects:

    team                  -> recent_team   (player metadata)
    passing_interceptions -> interceptions (QB scoring; silently zero if missed)

Normalization handles *known* renames; :func:`validate_weekly_schema` catches
*unknown* ones by failing loudly at ingest, instead of letting a renamed stat
column become a column of zeros deep inside the scoring engine.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import duckdb
import pandas as pd

from ffa.scoring import STAT_COLUMNS

DEFAULT_RAW_DIR = Path("data/raw")

# Structural columns every downstream query and groupby relies on.
REQUIRED_WEEKLY_KEYS: Final[tuple[str, ...]] = ("player_id", "season", "week")

# nflverse load_player_stats column -> the canonical name the package uses.
# Only rename when the canonical column is absent, so we never clobber a
# frame that already speaks the canonical schema (e.g. synthetic test data).
WEEKLY_COLUMN_ALIASES: Final[Mapping[str, str]] = {
    "team": "recent_team",
    "passing_interceptions": "interceptions",
}


@dataclass(frozen=True)
class IngestResult:
    weekly_path: Path
    rosters_path: Path
    schedules_path: Path
    rows: dict[str, int]


def _import_module():
    """Import nflreadpy lazily so tests and offline use don't require it."""
    import nflreadpy  # noqa: WPS433 -- intentional local import

    return nflreadpy


def _to_pandas(frame) -> pd.DataFrame:
    """Coerce an nflreadpy result to pandas.

    nflreadpy returns Polars frames; ``.to_pandas()`` (pyarrow-backed) is the
    documented conversion. Accept an already-pandas frame unchanged so the
    rest of the module is testable without Polars installed.
    """
    if isinstance(frame, pd.DataFrame):
        return frame
    to_pandas = getattr(frame, "to_pandas", None)
    if callable(to_pandas):
        return to_pandas()
    raise TypeError(
        f"Expected a pandas or Polars DataFrame, got {type(frame).__name__}."
    )


def normalize_weekly_columns(
    weekly: pd.DataFrame,
    aliases: Mapping[str, str] = WEEKLY_COLUMN_ALIASES,
) -> pd.DataFrame:
    """Rename known nflverse columns to the package's canonical names.

    Pure: returns a renamed view/copy, never mutates the input. A rename is
    applied only when the source column is present and the canonical target
    is not, so frames already using canonical names pass through untouched.
    """
    rename = {
        src: dst
        for src, dst in aliases.items()
        if src in weekly.columns and dst not in weekly.columns
    }
    return weekly.rename(columns=rename) if rename else weekly


def validate_weekly_schema(
    weekly: pd.DataFrame,
    required_keys: Sequence[str] = REQUIRED_WEEKLY_KEYS,
    required_stats: Sequence[str] = STAT_COLUMNS,
) -> None:
    """Raise if a normalized weekly frame is missing expected columns.

    Run *after* :func:`normalize_weekly_columns`. Two separate checks so the
    error says which kind of break it is:

    - missing structural keys -> the data is unusable as-is;
    - missing stat columns -> a likely upstream rename. Add the new name to
      :data:`WEEKLY_COLUMN_ALIASES` so normalization maps it going forward.

    Scoring tolerates missing stat columns by design (projection frames carry
    only a subset), but a *full* nflverse weekly pull should have them all --
    so their absence here means the schema moved, and we want to know loudly
    rather than silently score those stats as zero.
    """
    missing_keys = [c for c in required_keys if c not in weekly.columns]
    if missing_keys:
        raise ValueError(
            f"weekly data is missing required key columns: {missing_keys}. "
            f"Got columns: {sorted(weekly.columns)[:20]}..."
        )
    missing_stats = [c for c in required_stats if c not in weekly.columns]
    if missing_stats:
        raise ValueError(
            f"weekly data is missing expected stat columns: {missing_stats}. "
            "nflverse likely renamed them; add the new name(s) to "
            "WEEKLY_COLUMN_ALIASES so normalization maps them to canonical names."
        )


def _seasons_arg(seasons: list[int]) -> list[int]:
    """nflreadpy accepts int | list[int] | bool | None; we always pass a list."""
    return list(seasons)


def fetch_weekly(seasons: list[int]) -> pd.DataFrame:
    """Per-player per-game stats; the canonical input for the scoring engine.

    Normalized to canonical column names and schema-validated at the boundary.
    """
    raw = _import_module().load_player_stats(_seasons_arg(seasons), summary_level="week")
    weekly = normalize_weekly_columns(_to_pandas(raw))
    validate_weekly_schema(weekly)
    return weekly


def fetch_rosters(seasons: list[int]) -> pd.DataFrame:
    return _to_pandas(_import_module().load_rosters(_seasons_arg(seasons)))


def fetch_schedules(seasons: list[int]) -> pd.DataFrame:
    return _to_pandas(_import_module().load_schedules(_seasons_arg(seasons)))


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
