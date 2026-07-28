"""Hub-consumable Monte Carlo draft-sim snapshots (roadmap 4.5).

The hub never runs ``ffa`` at request time. A scheduled job writes versioned
JSON under the same store root the hub already reads::

    {store}/draft_sim/{scoring}/{season}/slot_{N}.json

Rows keep nflverse ``player_id`` values; join ESPN ids via the player map when
needed. Availability columns are probabilities (0–1) that the player is still
on the board at the user's pick in that round.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Final

import pandas as pd

from ffa.draft import DraftResult, summarize_user_picks
from ffa.projections import players_to_records

SCHEMA_VERSION: Final[int] = 1


def draft_sim_path(
    out_dir: Path, scoring: str, season: int, user_slot: int
) -> Path:
    """Return ``out_dir/{scoring}/{season}/slot_{N}.json``."""
    return out_dir / scoring / str(season) / f"slot_{int(user_slot)}.json"


def build_pick_rate_table(
    user_picks: pd.DataFrame,
    ranked: pd.DataFrame,
    *,
    top: int | None = None,
) -> pd.DataFrame:
    """Pick-rate summary joined to names / VOR from the ranked board."""
    summary = summarize_user_picks(
        user_picks, top=top if top is not None else 10**9
    )
    if summary.empty:
        return pd.DataFrame(
            columns=[
                "player_id",
                "player_name",
                "position",
                "pick_rate",
                "avg_round",
                "avg_value",
                "vor",
            ]
        )

    meta = ranked.copy()
    if "player_display_name" in meta.columns:
        meta["player_name"] = meta["player_display_name"]
    elif "player_name" not in meta.columns:
        meta["player_name"] = meta["player_id"].astype(str)
    keep = [c for c in ("player_id", "player_name", "vor") if c in meta.columns]
    merged = summary.merge(meta[keep], on="player_id", how="left")
    if "position" not in merged.columns and "position" in meta.columns:
        merged = merged.merge(meta[["player_id", "position"]], on="player_id", how="left")
    cols = [
        "player_id",
        "player_name",
        "position",
        "pick_rate",
        "avg_round",
        "avg_value",
        "vor",
    ]
    for col in cols:
        if col not in merged.columns:
            merged[col] = None
    return merged[cols].reset_index(drop=True)


def build_availability_table(
    availability: pd.DataFrame,
    ranked: pd.DataFrame,
    *,
    top: int | None = 80,
) -> pd.DataFrame:
    """Availability matrix joined to names / VOR; keep probability scale 0–1."""
    if availability.empty:
        return availability

    meta = ranked.copy()
    if "player_display_name" in meta.columns:
        meta["player_name"] = meta["player_display_name"]
    elif "player_name" not in meta.columns:
        meta["player_name"] = meta["player_id"].astype(str)
    keep = [
        c
        for c in ("player_id", "player_name", "position", "vor")
        if c in meta.columns
    ]
    merged = availability.merge(meta[keep], on="player_id", how="left")
    round_cols = [c for c in merged.columns if str(c).startswith("round_")]
    sort_col = "vor" if "vor" in merged.columns else (round_cols[0] if round_cols else "player_id")
    ascending = sort_col != "vor"
    merged = merged.sort_values(sort_col, ascending=ascending)
    if top is not None:
        merged = merged.head(top)
    cols = [
        c
        for c in ("player_id", "player_name", "position", "vor", *round_cols)
        if c in merged.columns
    ]
    return merged[cols].reset_index(drop=True)


def build_draft_sim_document(
    result: DraftResult,
    ranked: pd.DataFrame,
    *,
    scoring: str,
    season: int,
    user_slot: int,
    n_sims: int,
    teams: int,
    rounds: int,
    source: dict[str, Any],
    pick_rate_top: int | None = 40,
    availability_top: int | None = 80,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    """Assemble one hub-readable draft-sim document for a single slot."""
    when = generated_at or datetime.now(timezone.utc)
    picks = build_pick_rate_table(
        result.user_picks, ranked, top=pick_rate_top
    )
    avail = build_availability_table(
        result.availability, ranked, top=availability_top
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": when.isoformat().replace("+00:00", "Z"),
        "scoring": scoring,
        "season": int(season),
        "user_slot": int(user_slot),
        "n_sims": int(n_sims),
        "teams": int(teams),
        "rounds": int(rounds),
        "source": source,
        "pick_rates": players_to_records(picks),
        "availability": players_to_records(avail),
    }


def write_draft_sim_snapshot(
    document: dict[str, Any], out_dir: Path
) -> Path:
    """Write ``draft_sim/{scoring}/{season}/slot_{N}.json``; return path."""
    path = draft_sim_path(
        out_dir,
        str(document["scoring"]),
        int(document["season"]),
        int(document["user_slot"]),
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(document, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    return path


def load_draft_sim_snapshot(path: Path) -> dict[str, Any]:
    """Read a draft-sim JSON snapshot from disk."""
    return json.loads(path.read_text(encoding="utf-8"))
