"""ESPN ↔ nflverse (GSIS) player ID mapping for the hub (roadmap 4.3).

Projection snapshots (4.2) key rows by nflverse ``player_id`` (GSIS). Hub
rosters key players by ESPN ``id``. This module builds a versioned crosswalk
the hub reads from the store — never at request time via ``ffa``.

Primary source: ingested ``rosters.parquet`` (``espn_id`` ↔ ``gsis_id``).
Optional fill: DynastyProcess ``load_ff_playerids()``. Coverage is measured
against unique ESPN ids on football league rosters under the sj store root.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Final

import pandas as pd

SCHEMA_VERSION: Final[int] = 1
SKILL_POSITIONS: Final[frozenset[str]] = frozenset({"QB", "RB", "WR", "TE", "K"})


def normalize_espn_id(value: Any) -> str | None:
    """Canonical string ESPN id (strip float artifacts like ``3139477.0``)."""
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "<na>", "nat"}:
        return None
    if text.endswith(".0"):
        head = text[:-2]
        if head.isdigit() or (head.startswith("-") and head[1:].isdigit()):
            return head
    # Numeric strings from parquet / JSON.
    try:
        as_float = float(text)
    except ValueError:
        return text
    if as_float.is_integer():
        return str(int(as_float))
    return text


def normalize_player_id(value: Any) -> str | None:
    """Canonical GSIS / nflverse player_id string."""
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "<na>"}:
        return None
    return text


def crosswalk_from_rosters(
    rosters: pd.DataFrame,
    *,
    season: int | None = None,
) -> pd.DataFrame:
    """Build espn_id → player_id rows from nflverse rosters (method=roster).

    Prefer the latest week/season row when duplicates disagree. Pass ``season``
    to restrict to one NFL season (recommended for export).
    """
    if rosters.empty:
        return _empty_crosswalk()

    df = rosters.copy()
    if season is not None and "season" in df.columns:
        df = df[df["season"] == season]
    if df.empty:
        return _empty_crosswalk()

    gsis_col = "gsis_id" if "gsis_id" in df.columns else (
        "player_id" if "player_id" in df.columns else None
    )
    if gsis_col is None or "espn_id" not in df.columns:
        raise ValueError(
            "rosters must include espn_id and gsis_id (or player_id) columns"
        )

    df = df.assign(
        espn_id=df["espn_id"].map(normalize_espn_id),
        player_id=df[gsis_col].map(normalize_player_id),
    )
    df = df.dropna(subset=["espn_id", "player_id"])
    if df.empty:
        return _empty_crosswalk()

    sort_cols = [c for c in ("season", "week") if c in df.columns]
    if sort_cols:
        df = df.sort_values(sort_cols, ascending=True)

    name_col = next(
        (c for c in ("full_name", "player_name", "player_display_name") if c in df.columns),
        None,
    )
    keep = ["espn_id", "player_id"]
    if name_col:
        df = df.rename(columns={name_col: "name"})
        keep.append("name")
    if "position" in df.columns:
        keep.append("position")

    # Last row wins after ascending season/week sort → latest observation.
    out = df[keep].drop_duplicates(subset=["espn_id"], keep="last").copy()
    out["method"] = "roster"
    return out.reset_index(drop=True)


def crosswalk_from_ff_playerids(ff_ids: pd.DataFrame) -> pd.DataFrame:
    """Build espn_id → player_id rows from DynastyProcess ids (method=ff_playerids)."""
    if ff_ids.empty:
        return _empty_crosswalk()
    if "espn_id" not in ff_ids.columns or "gsis_id" not in ff_ids.columns:
        raise ValueError("ff_playerids must include espn_id and gsis_id columns")

    df = ff_ids.copy()
    df = df.assign(
        espn_id=df["espn_id"].map(normalize_espn_id),
        player_id=df["gsis_id"].map(normalize_player_id),
    )
    df = df.dropna(subset=["espn_id", "player_id"])
    name_col = "name" if "name" in df.columns else None
    keep = ["espn_id", "player_id"]
    if name_col:
        keep.append("name")
    if "position" in df.columns:
        keep.append("position")
    out = df[keep].drop_duplicates(subset=["espn_id"], keep="last").copy()
    out["method"] = "ff_playerids"
    return out.reset_index(drop=True)


def merge_crosswalks(
    primary: pd.DataFrame,
    *fallbacks: pd.DataFrame,
) -> pd.DataFrame:
    """Union crosswalks; earlier frames win on espn_id collisions."""
    frames = [primary, *fallbacks]
    frames = [f for f in frames if f is not None and not f.empty]
    if not frames:
        return _empty_crosswalk()
    merged = pd.concat(frames, ignore_index=True)
    return merged.drop_duplicates(subset=["espn_id"], keep="first").reset_index(drop=True)


def fetch_ff_playerids() -> pd.DataFrame:
    """Pull DynastyProcess fantasy player ids via nflreadpy (network)."""
    from ffa.ingest import _import_module, _to_pandas

    return _to_pandas(_import_module().load_ff_playerids())


def extract_espn_players_from_snapshot(
    snapshot: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Unique ESPN players from a hub league snapshot (rosters + free agents)."""
    seen: dict[str, dict[str, Any]] = {}

    def _add(raw: Mapping[str, Any]) -> None:
        eid = normalize_espn_id(raw.get("id") if "id" in raw else raw.get("player_id"))
        if eid is None or eid in seen:
            return
        seen[eid] = {
            "espn_id": eid,
            "name": raw.get("name") or raw.get("player_name"),
            "position": raw.get("position"),
            "pro_team": raw.get("pro_team"),
            "league_id": snapshot.get("league_id"),
            "season": snapshot.get("season"),
        }

    for team in snapshot.get("teams") or []:
        for player in team.get("roster") or []:
            if isinstance(player, Mapping):
                _add(player)
    for player in snapshot.get("players") or []:
        if isinstance(player, Mapping):
            _add(player)
    return list(seen.values())


def collect_hub_espn_players(sj_root: Path) -> list[dict[str, Any]]:
    """Walk football league snapshots under ``sj_root`` for unique ESPN ids."""
    from sj.store import FileStore

    root = Path(sj_root)
    if not root.exists():
        return []

    store = FileStore(root)
    by_espn: dict[str, dict[str, Any]] = {}
    for item in store.list():
        if item.get("sport") != "football":
            continue
        league_id = item.get("league_id")
        season = item.get("season")
        if not league_id or season is None:
            continue
        snapshot = store.read(str(league_id), int(season))
        if not snapshot:
            continue
        for player in extract_espn_players_from_snapshot(snapshot):
            by_espn.setdefault(player["espn_id"], player)
    return list(by_espn.values())


def compute_hub_coverage(
    hub_players: Iterable[Mapping[str, Any]],
    crosswalk: pd.DataFrame,
) -> dict[str, Any]:
    """Fraction of hub ESPN ids that resolve to a GSIS player_id."""
    lookup = {
        str(row["espn_id"]): str(row["player_id"])
        for _, row in crosswalk.iterrows()
        if row.get("espn_id") is not None and row.get("player_id") is not None
    }
    rostered = list(hub_players)
    resolved: list[dict[str, Any]] = []
    misses: list[dict[str, Any]] = []
    for player in rostered:
        eid = normalize_espn_id(player.get("espn_id"))
        if eid is None:
            continue
        gsis = lookup.get(eid)
        if gsis is not None:
            resolved.append(
                {
                    "espn_id": eid,
                    "player_id": gsis,
                    "name": player.get("name"),
                    "position": player.get("position"),
                }
            )
        else:
            misses.append(
                {
                    "espn_id": eid,
                    "name": player.get("name"),
                    "position": player.get("position"),
                    "pro_team": player.get("pro_team"),
                    "league_id": player.get("league_id"),
                    "season": player.get("season"),
                    "reason": "unmapped",
                }
            )

    n = len(rostered)
    m = len(resolved)
    return {
        "rostered": n,
        "resolved": m,
        "rate": (m / n) if n else None,
        "misses": misses,
    }


def skill_roster_stats(rosters: pd.DataFrame, *, season: int | None = None) -> dict[str, Any]:
    """How many skill-position roster rows lack an espn_id (engine-side gap)."""
    df = rosters
    if season is not None and "season" in df.columns:
        df = df[df["season"] == season]
    if "position" in df.columns:
        df = df[df["position"].astype(str).isin(SKILL_POSITIONS)]
    if df.empty:
        return {"skill_players": 0, "with_espn_id": 0, "missing_espn_id": 0}

    gsis_col = "gsis_id" if "gsis_id" in df.columns else "player_id"
    unique = df.drop_duplicates(subset=[gsis_col]) if gsis_col in df.columns else df
    espn = unique["espn_id"].map(normalize_espn_id) if "espn_id" in unique.columns else None
    with_espn = int(espn.notna().sum()) if espn is not None else 0
    total = len(unique)
    return {
        "skill_players": total,
        "with_espn_id": with_espn,
        "missing_espn_id": total - with_espn,
    }


def build_player_map_document(
    crosswalk: pd.DataFrame,
    *,
    season: int,
    coverage: dict[str, Any] | None = None,
    stats: dict[str, Any] | None = None,
    source: dict[str, Any] | None = None,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    """Assemble the hub-readable player map document."""
    when = generated_at or datetime.now(timezone.utc)
    methods = (
        crosswalk["method"].value_counts().to_dict()
        if not crosswalk.empty and "method" in crosswalk.columns
        else {}
    )
    mappings: list[dict[str, Any]] = []
    for row in crosswalk.to_dict(orient="records"):
        mappings.append(
            {
                "espn_id": row.get("espn_id"),
                "player_id": row.get("player_id"),
                "name": row.get("name"),
                "position": row.get("position"),
                "method": row.get("method"),
            }
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": when.isoformat().replace("+00:00", "Z"),
        "season": int(season),
        "stats": {
            "mappings": len(mappings),
            "methods": {str(k): int(v) for k, v in methods.items()},
            **(stats or {}),
        },
        "coverage": coverage
        or {"rostered": 0, "resolved": 0, "rate": None, "misses": []},
        "source": source or {"engine": "ffa"},
        "mappings": mappings,
    }


def write_player_map(document: dict[str, Any], out_dir: Path) -> Path:
    """Write ``{out_dir}/{season}.json``; returns the path written."""
    season = int(document["season"])
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{season}.json"
    path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    return path


def load_player_map(path: Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def lookup_player_id(document: Mapping[str, Any], espn_id: Any) -> str | None:
    """Resolve one ESPN id against a loaded map document."""
    key = normalize_espn_id(espn_id)
    if key is None:
        return None
    for row in document.get("mappings") or []:
        if normalize_espn_id(row.get("espn_id")) == key:
            return normalize_player_id(row.get("player_id"))
    return None


def _empty_crosswalk() -> pd.DataFrame:
    return pd.DataFrame(columns=["espn_id", "player_id", "name", "position", "method"])
