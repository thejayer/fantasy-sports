"""Filesystem store for synced Strictly Jayers league snapshots."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_STORE_DIR = Path(__file__).resolve().parents[2] / "data" / "sj"
FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "sj"


def season_path(store_dir: Path, league_id: str, season: int) -> Path:
    return store_dir / league_id / f"{season}.json"


def write_snapshot(
    snapshot: dict[str, Any],
    store_dir: Path | str = DEFAULT_STORE_DIR,
) -> Path:
    root = Path(store_dir)
    league_id = snapshot["league_id"]
    season = snapshot["season"]
    path = season_path(root, league_id, season)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        **snapshot,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _rewrite_index(root)
    return path


def read_snapshot(
    league_id: str,
    season: int,
    store_dir: Path | str | None = None,
) -> dict[str, Any]:
    roots = []
    if store_dir is not None:
        roots.append(Path(store_dir))
    else:
        roots.extend([DEFAULT_STORE_DIR, FIXTURES_DIR])
    for root in roots:
        path = season_path(root, league_id, season)
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    raise FileNotFoundError(f"No snapshot for {league_id} season {season}")


def list_snapshots(store_dir: Path | str | None = None) -> list[dict[str, Any]]:
    roots = []
    if store_dir is not None:
        roots.append(Path(store_dir))
    else:
        roots.extend([DEFAULT_STORE_DIR, FIXTURES_DIR])
    seen: set[tuple[str, int]] = set()
    out: list[dict[str, Any]] = []
    for root in roots:
        index_path = root / "index.json"
        if not index_path.exists():
            continue
        for item in json.loads(index_path.read_text(encoding="utf-8")).get("leagues", []):
            key = (item["league_id"], item["season"])
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
    out.sort(key=lambda x: (x["sport"], x["league_id"], -x["season"]))
    return out


def _rewrite_index(store_dir: Path) -> None:
    leagues: list[dict[str, Any]] = []
    for path in sorted(store_dir.glob("*/*.json")):
        if path.name == "index.json":
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        leagues.append(
            {
                "league_id": data["league_id"],
                "espn_league_id": data.get("espn_league_id"),
                "name": data.get("name"),
                "sport": data.get("sport"),
                "format": data.get("format"),
                "season": data.get("season"),
                "team_count": data.get("team_count"),
                "synced_at": data.get("synced_at"),
                "path": str(path.relative_to(store_dir)),
            }
        )
    index = {"generated_at": datetime.now(timezone.utc).isoformat(), "leagues": leagues}
    (store_dir / "index.json").write_text(
        json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
