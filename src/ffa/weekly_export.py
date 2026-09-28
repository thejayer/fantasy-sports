"""Hub-consumable typical-week posterior snapshots (weekly posteriors).

The hub never runs ``ffa`` at request time. A scheduled job writes versioned
JSON under the same store root the hub already reads::

    {store}/weekly_projections/{scoring}/{season}.json

Rows keep nflverse ``player_id`` values; join ESPN ids via the player map.
``grain`` is ``typical_week``: each sample is one bootstrapped historical game
(not a schedule-/opponent-adjusted week). Season totals remain under
``projections/``; playoff-odds MC still needs joint week×team scores.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Final

import pandas as pd

from ffa.league import LeagueConfig
from ffa.projections import (
    SCHEMA_VERSION as _PROJECTION_SCHEMA_VERSION,
)
from ffa.projections import (
    build_projection_table,
    players_to_records,
)

SCHEMA_VERSION: Final[int] = 1
GRAIN_TYPICAL_WEEK: Final[str] = "typical_week"


def weekly_snapshot_path(out_dir: Path, scoring: str, season: int) -> Path:
    """Return ``out_dir/{scoring}/{season}.json``."""
    return out_dir / scoring / f"{int(season)}.json"


def build_weekly_projection_table(
    summary: pd.DataFrame,
    cfg: LeagueConfig,
    *,
    n_tiers: int = 5,
) -> pd.DataFrame:
    """VOR + floor/median/ceiling aliases for typical-week fantasy points."""
    return build_projection_table(summary, cfg, n_tiers=n_tiers)


def build_weekly_snapshot_document(
    table: pd.DataFrame,
    *,
    scoring: str,
    season: int,
    n_sims: int,
    source: dict[str, Any],
    grain: str = GRAIN_TYPICAL_WEEK,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    """Assemble the hub-readable weekly projection snapshot document."""
    when = generated_at or datetime.now(timezone.utc)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": when.isoformat().replace("+00:00", "Z"),
        "scoring": scoring,
        "season": int(season),
        "grain": grain,
        "n_sims": int(n_sims),
        "source": {
            **source,
            "projection_schema_version": _PROJECTION_SCHEMA_VERSION,
        },
        "players": players_to_records(table),
    }


def write_weekly_projection_snapshot(
    document: dict[str, Any],
    out_dir: Path,
) -> Path:
    """Write weekly snapshot JSON; returns the path written."""
    scoring = str(document["scoring"])
    season = int(document["season"])
    path = weekly_snapshot_path(out_dir, scoring, season)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    return path


def load_weekly_projection_snapshot(path: Path) -> dict[str, Any]:
    """Read a weekly projection JSON snapshot from disk."""
    return json.loads(path.read_text(encoding="utf-8"))
