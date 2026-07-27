"""Snapshot storage for Strictly Jayers league data.

Two backends share one interface:

* :class:`FileStore` -- local filesystem, used for development and tests.
* :class:`GcsStore` -- a Cloud Storage bucket, used in production so snapshots
  survive Cloud Run instance recycles and are shared across instances.

Set ``SJ_GCS_BUCKET`` to select the Cloud Storage backend.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

DEFAULT_STORE_DIR = Path(__file__).resolve().parents[2] / "data" / "sj"
FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "sj"

INDEX_NAME = "index.json"


def season_path(store_dir: Path, league_id: str, season: int) -> Path:
    return store_dir / league_id / f"{season}.json"


def _index_entry(data: dict[str, Any], rel_path: str) -> dict[str, Any]:
    return {
        "league_id": data["league_id"],
        "espn_league_id": data.get("espn_league_id"),
        "name": data.get("name"),
        "sport": data.get("sport"),
        "format": data.get("format"),
        "season": data.get("season"),
        "team_count": data.get("team_count"),
        "synced_at": data.get("synced_at"),
        "path": rel_path,
    }


def _stamp(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {**snapshot, "synced_at": datetime.now(timezone.utc).isoformat()}


def _dump(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


class SnapshotStore(Protocol):
    """Read/write league-season snapshots."""

    def write(self, snapshot: dict[str, Any]) -> str: ...

    def read(self, league_id: str, season: int) -> dict[str, Any] | None: ...

    def list(self) -> list[dict[str, Any]]: ...


class FileStore:
    """Snapshots as JSON files under ``root``."""

    def __init__(self, root: Path | str = DEFAULT_STORE_DIR) -> None:
        self.root = Path(root)

    def write(self, snapshot: dict[str, Any]) -> str:
        payload = _stamp(snapshot)
        path = season_path(self.root, payload["league_id"], payload["season"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_dump(payload), encoding="utf-8")
        self._rewrite_index()
        return str(path)

    def read(self, league_id: str, season: int) -> dict[str, Any] | None:
        path = season_path(self.root, league_id, season)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def list(self) -> list[dict[str, Any]]:
        index_path = self.root / INDEX_NAME
        if not index_path.exists():
            return []
        return json.loads(index_path.read_text(encoding="utf-8")).get("leagues", [])

    def _rewrite_index(self) -> None:
        leagues: list[dict[str, Any]] = []
        for path in sorted(self.root.glob("*/*.json")):
            if path.name == INDEX_NAME:
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            leagues.append(_index_entry(data, str(path.relative_to(self.root))))
        index = {"generated_at": datetime.now(timezone.utc).isoformat(), "leagues": leagues}
        (self.root / INDEX_NAME).write_text(_dump(index), encoding="utf-8")


class GcsStore:
    """Snapshots as objects in a Cloud Storage bucket."""

    def __init__(self, bucket: str, prefix: str = "") -> None:
        self.bucket_name = bucket
        self.prefix = prefix.strip("/")
        self._bucket: Any | None = None

    # Imported lazily so the package works without the GCS extra installed.
    def _get_bucket(self) -> Any:
        if self._bucket is None:
            from google.cloud import storage

            self._bucket = storage.Client().bucket(self.bucket_name)
        return self._bucket

    def _key(self, *parts: str) -> str:
        return "/".join([p for p in (self.prefix, *parts) if p])

    def write(self, snapshot: dict[str, Any]) -> str:
        payload = _stamp(snapshot)
        rel = f"{payload['league_id']}/{payload['season']}.json"
        blob = self._get_bucket().blob(self._key(rel))
        blob.cache_control = "no-cache"
        blob.upload_from_string(_dump(payload), content_type="application/json")
        self._rewrite_index()
        return f"gs://{self.bucket_name}/{self._key(rel)}"

    def read(self, league_id: str, season: int) -> dict[str, Any] | None:
        blob = self._get_bucket().blob(self._key(f"{league_id}/{season}.json"))
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text())

    def list(self) -> list[dict[str, Any]]:
        blob = self._get_bucket().blob(self._key(INDEX_NAME))
        if not blob.exists():
            return []
        return json.loads(blob.download_as_text()).get("leagues", [])

    def _rewrite_index(self) -> None:
        bucket = self._get_bucket()
        base = f"{self.prefix}/" if self.prefix else ""
        leagues: list[dict[str, Any]] = []
        for blob in bucket.list_blobs(prefix=base or None):
            rel = blob.name[len(base) :] if base else blob.name
            if not rel.endswith(".json") or rel == INDEX_NAME or "/" not in rel:
                continue
            data = json.loads(blob.download_as_text())
            leagues.append(_index_entry(data, rel))
        leagues.sort(key=lambda item: (item["league_id"], -(item["season"] or 0)))
        index = {"generated_at": datetime.now(timezone.utc).isoformat(), "leagues": leagues}
        index_blob = bucket.blob(self._key(INDEX_NAME))
        index_blob.cache_control = "no-cache"
        index_blob.upload_from_string(_dump(index), content_type="application/json")


def resolve_store(store_dir: Path | str | None = None) -> SnapshotStore:
    """Pick a backend.

    An explicit ``store_dir`` always wins so tests and local runs stay on disk;
    otherwise ``SJ_GCS_BUCKET`` selects Cloud Storage.
    """
    if store_dir is not None:
        return FileStore(store_dir)
    bucket = os.environ.get("SJ_GCS_BUCKET")
    if bucket:
        return GcsStore(bucket, os.environ.get("SJ_GCS_PREFIX", ""))
    return FileStore(DEFAULT_STORE_DIR)


def describe_store(store_dir: Path | str | None = None) -> str:
    store = resolve_store(store_dir)
    if isinstance(store, GcsStore):
        return f"gs://{store.bucket_name}/{store.prefix}".rstrip("/")
    return str(store.root)  # type: ignore[union-attr]


def write_snapshot(
    snapshot: dict[str, Any],
    store_dir: Path | str | None = None,
) -> str:
    """Persist one league-season snapshot; returns the location written."""
    return resolve_store(store_dir).write(snapshot)


def read_snapshot(
    league_id: str,
    season: int,
    store_dir: Path | str | None = None,
) -> dict[str, Any]:
    """Read a snapshot, falling back to committed fixtures."""
    snapshot = resolve_store(store_dir).read(league_id, season)
    if snapshot is not None:
        return snapshot
    if store_dir is None:
        fallback = FileStore(FIXTURES_DIR).read(league_id, season)
        if fallback is not None:
            return fallback
    raise FileNotFoundError(f"No snapshot for {league_id} season {season}")


def list_snapshots(store_dir: Path | str | None = None) -> list[dict[str, Any]]:
    """List available snapshots, falling back to committed fixtures."""
    items = resolve_store(store_dir).list()
    if not items and store_dir is None:
        items = FileStore(FIXTURES_DIR).list()
    return sorted(items, key=lambda x: (x["sport"], x["league_id"], -x["season"]))
