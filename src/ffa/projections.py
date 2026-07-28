"""Consumable projection snapshots for the Strictly Jayers hub (roadmap 4.2).

The hub never runs ``ffa`` at request time (AUDIT #17). Instead a scheduled job
writes versioned JSON (and optional Parquet) under the same store root the hub
already reads::

    {store}/projections/{scoring}/{season}.json

Rows keep nflverse ``player_id`` values; ESPN ID join is roadmap 4.3.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Final, Literal

import pandas as pd

from ffa.league import LeagueConfig
from ffa.ranking import assign_tiers, compute_vor

SCHEMA_VERSION: Final[int] = 1

# Hub-facing aliases for posterior quantiles from summarize_seasons.
_QUANTILE_ALIASES: Final[tuple[tuple[str, str], ...]] = (
    ("floor", "q05"),
    ("median", "q50"),
    ("ceiling", "q95"),
)

FormatChoice = Literal["json", "parquet", "both"]


def scoring_slug(cfg: LeagueConfig) -> str:
    """Stable directory/file key from league config name (e.g. ``ppr``)."""
    return str(cfg.name).strip().lower().replace(" ", "-")


def build_projection_table(
    summary: pd.DataFrame,
    cfg: LeagueConfig,
    *,
    n_tiers: int = 5,
) -> pd.DataFrame:
    """Attach VOR + tiers and rename quantiles to floor/median/ceiling.

    Expected ``summary`` columns match :func:`ffa.simulation.summarize_seasons`
    (``player_id``, ``points_mean``, ``points_sd``, ``q05``…``q95``, metadata).
    """
    if summary.empty:
        return pd.DataFrame(
            columns=[
                "player_id",
                "player_name",
                "position",
                "team",
                "points_mean",
                "points_sd",
                "floor",
                "median",
                "ceiling",
                "vor",
                "tier",
            ]
        )

    ranked = compute_vor(summary, cfg.roster)
    ranked = assign_tiers(ranked, n_tiers=n_tiers)

    out = ranked.copy()
    if "player_display_name" in out.columns:
        name = out["player_display_name"]
    elif "player_name" in out.columns:
        name = out["player_name"]
    else:
        name = out["player_id"].astype(str)
    out["player_name"] = name

    if "recent_team" in out.columns:
        out["team"] = out["recent_team"]
    elif "team" not in out.columns:
        out["team"] = None

    for alias, src in _QUANTILE_ALIASES:
        if src in out.columns:
            out[alias] = out[src]
        else:
            out[alias] = float("nan")

    cols = [
        "player_id",
        "player_name",
        "position",
        "team",
        "points_mean",
        "points_sd",
        "floor",
        "median",
        "ceiling",
        "vor",
        "tier",
    ]
    return out[cols].sort_values("vor", ascending=False).reset_index(drop=True)


def players_to_records(table: pd.DataFrame) -> list[dict[str, Any]]:
    """JSON-safe player rows (native Python scalars, null for NaN)."""
    records: list[dict[str, Any]] = []
    for row in table.to_dict(orient="records"):
        clean: dict[str, Any] = {}
        for key, value in row.items():
            if value is None or (isinstance(value, float) and pd.isna(value)):
                clean[key] = None
            elif hasattr(value, "item"):
                # numpy scalar
                item = value.item()
                clean[key] = None if isinstance(item, float) and pd.isna(item) else item
            else:
                clean[key] = value
        records.append(clean)
    return records


def build_snapshot_document(
    table: pd.DataFrame,
    *,
    scoring: str,
    season: int,
    n_sims: int,
    source: dict[str, Any],
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    """Assemble the hub-readable projection snapshot document."""
    when = generated_at or datetime.now(timezone.utc)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": when.isoformat().replace("+00:00", "Z"),
        "scoring": scoring,
        "season": int(season),
        "n_sims": int(n_sims),
        "source": source,
        "players": players_to_records(table),
    }


def snapshot_paths(out_dir: Path, scoring: str, season: int) -> tuple[Path, Path]:
    """Return ``(json_path, parquet_path)`` under ``out_dir/scoring/``."""
    base = out_dir / scoring
    return base / f"{season}.json", base / f"{season}.parquet"


def write_projection_snapshot(
    document: dict[str, Any],
    table: pd.DataFrame,
    out_dir: Path,
    *,
    fmt: FormatChoice = "json",
) -> list[Path]:
    """Write snapshot file(s); returns paths written."""
    scoring = str(document["scoring"])
    season = int(document["season"])
    json_path, parquet_path = snapshot_paths(out_dir, scoring, season)
    written: list[Path] = []

    if fmt in ("json", "both"):
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
        written.append(json_path)

    if fmt in ("parquet", "both"):
        parquet_path.parent.mkdir(parents=True, exist_ok=True)
        table.to_parquet(parquet_path, index=False)
        written.append(parquet_path)

    return written


def load_projection_snapshot(path: Path) -> dict[str, Any]:
    """Read a projection JSON snapshot from disk."""
    return json.loads(path.read_text(encoding="utf-8"))
