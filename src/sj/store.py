"""Snapshot storage for Strictly Jayers league data.

Two backends share one interface:

* :class:`FileStore` -- local filesystem, used for development and tests.
* :class:`GcsStore` -- a Cloud Storage bucket, used in production so snapshots
  survive Cloud Run instance recycles and are shared across instances.

Set ``SJ_GCS_BUCKET`` to select the Cloud Storage backend.

On-disk layout (schema_version 2, roadmap 2.2)::

    {root}/
      index.json
      {league_id}/{season}/
        manifest.json          # written last so readers never see a partial season
        standings.json
        rosters.json
        matchups.json
        draft.json
        settings.json
        transactions.json
        free_agents.json

Legacy schema_version 1 monoliths (``{league_id}/{season}.json``) remain
readable — committed fixtures still use that shape. Writers only emit v2.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

from sj.snapshot_layout import (
    CONCERN_FILES,
    MANIFEST_NAME,
    assemble_snapshot,
    manifest_rel,
    monolith_rel,
    pro_schedule_rel,
    season_dir_rel,
    split_snapshot,
    week_box_score_rel,
)

DEFAULT_STORE_DIR = Path(__file__).resolve().parents[2] / "data" / "sj"
FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "sj"

INDEX_NAME = "index.json"


def season_path(store_dir: Path, league_id: str, season: int) -> Path:
    """Legacy v1 monolith path — kept for callers/tests that still name it."""
    return store_dir / monolith_rel(league_id, season)


def season_manifest_path(store_dir: Path, league_id: str, season: int) -> Path:
    return store_dir / manifest_rel(league_id, season)


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


def _is_v1_monolith_rel(rel: str) -> bool:
    """True for ``league/2025.json`` — not ``league/2025/standings.json``."""
    if not rel.endswith(".json") or rel == INDEX_NAME or rel.endswith(f"/{MANIFEST_NAME}"):
        return False
    parts = rel.split("/")
    return len(parts) == 2 and parts[1][:-5].isdigit()


def _is_manifest_rel(rel: str) -> bool:
    return rel.endswith(f"/{MANIFEST_NAME}")


def _index_leagues(document: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not document:
        return []
    return list(document.get("leagues") or [])


def _upsert_league_entry(
    leagues: list[dict[str, Any]], entry: dict[str, Any]
) -> list[dict[str, Any]]:
    """Replace any existing row for (league_id, season) and keep sort order."""
    key = (entry.get("league_id"), entry.get("season"))
    updated = [
        item for item in leagues if (item.get("league_id"), item.get("season")) != key
    ]
    updated.append(entry)
    updated.sort(key=lambda item: (item["league_id"], -(item["season"] or 0)))
    return updated


def _index_document(leagues: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "leagues": leagues,
    }


def _refuse_espn_overwrite_of_golf(
    existing: dict[str, Any] | None,
    incoming: dict[str, Any],
) -> None:
    """Block sync from clobbering a hub-native golf season in a shared store.

    Golf should live under ``SJ_HUB_DIR`` / a separate hub bucket; this guard is
    belt-and-suspenders if files ever share a root with ESPN sync.
    """
    if not existing:
        return
    if existing.get("sport") == "golf" and incoming.get("sport") != "golf":
        raise ValueError(
            f"refusing to overwrite hub-native golf league "
            f"{existing.get('league_id')} {existing.get('season')} with "
            f"sport={incoming.get('sport')!r}"
        )


class SnapshotStore(Protocol):
    """Read/write league-season snapshots."""

    def write(self, snapshot: dict[str, Any]) -> str: ...

    def read(self, league_id: str, season: int) -> dict[str, Any] | None: ...

    def list(self) -> list[dict[str, Any]]: ...

    def write_week_box_scores(self, document: dict[str, Any]) -> str: ...

    def read_week_box_scores(
        self, league_id: str, season: int, week: int
    ) -> dict[str, Any] | None: ...

    def write_pro_schedule(self, document: dict[str, Any]) -> str: ...

    def read_pro_schedule(
        self, league_id: str, season: int
    ) -> dict[str, Any] | None: ...


class FileStore:
    """Snapshots as JSON files under ``root``."""

    def __init__(self, root: Path | str = DEFAULT_STORE_DIR) -> None:
        self.root = Path(root)

    def write(self, snapshot: dict[str, Any]) -> str:
        payload = _stamp(snapshot)
        league_id = payload["league_id"]
        season = int(payload["season"])
        _refuse_espn_overwrite_of_golf(self.read(league_id, season), payload)
        parts = split_snapshot(payload)
        directory = self.root / season_dir_rel(league_id, season)
        directory.mkdir(parents=True, exist_ok=True)

        # Concern files first; manifest last so a concurrent reader never sees
        # a half-written season.
        for name in CONCERN_FILES:
            (directory / name).write_text(_dump(parts[name]), encoding="utf-8")
        manifest_path = directory / MANIFEST_NAME
        manifest_path.write_text(_dump(parts[MANIFEST_NAME]), encoding="utf-8")

        # Drop a leftover v1 monolith for this season if one exists.
        legacy = season_path(self.root, league_id, season)
        if legacy.exists():
            legacy.unlink()

        # Incremental index update (roadmap 2.3) — do not re-read every season.
        entry = _index_entry(parts[MANIFEST_NAME], manifest_rel(league_id, season))
        self._upsert_index(entry)
        return str(manifest_path)

    def write_week_box_scores(self, document: dict[str, Any]) -> str:
        """Write ``weeks/{N}.json`` without touching ``index.json`` (roadmap 8.1)."""
        league_id = str(document["league_id"])
        season = int(document["season"])
        week = int(document["week"])
        rel = week_box_score_rel(league_id, season, week)
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_dump(document), encoding="utf-8")
        return str(path)

    def read_week_box_scores(
        self, league_id: str, season: int, week: int
    ) -> dict[str, Any] | None:
        path = self.root / week_box_score_rel(league_id, season, week)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def write_pro_schedule(self, document: dict[str, Any]) -> str:
        """Write ``pro_schedule.json`` without touching ``index.json`` (roadmap 8.2)."""
        league_id = str(document["league_id"])
        season = int(document["season"])
        path = self.root / pro_schedule_rel(league_id, season)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_dump(document), encoding="utf-8")
        return str(path)

    def read_pro_schedule(
        self, league_id: str, season: int
    ) -> dict[str, Any] | None:
        path = self.root / pro_schedule_rel(league_id, season)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def read(self, league_id: str, season: int) -> dict[str, Any] | None:
        assembled = self._read_v2(league_id, season)
        if assembled is not None:
            return assembled
        path = season_path(self.root, league_id, season)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def list(self) -> list[dict[str, Any]]:
        index_path = self.root / INDEX_NAME
        if not index_path.exists():
            return []
        return json.loads(index_path.read_text(encoding="utf-8")).get("leagues", [])

    def _read_v2(self, league_id: str, season: int) -> dict[str, Any] | None:
        manifest_path = season_manifest_path(self.root, league_id, season)
        if not manifest_path.exists():
            return None
        directory = manifest_path.parent
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        files = manifest.get("files") or {}
        parts: dict[str, dict[str, Any]] = {"manifest": manifest}
        for concern, filename in files.items():
            path = directory / filename
            if not path.exists():
                return None
            parts[concern] = json.loads(path.read_text(encoding="utf-8"))
        return assemble_snapshot(parts)

    def _upsert_index(self, entry: dict[str, Any]) -> None:
        """Patch ``index.json`` for one league-season.

        Falls back to a full rebuild when the index is missing or unreadable so
        a wiped index still rediscovers seasons already on disk.
        """
        index_path = self.root / INDEX_NAME
        if not index_path.exists():
            self._rewrite_index()
            return
        try:
            current = json.loads(index_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            self._rewrite_index()
            return
        leagues = _upsert_league_entry(_index_leagues(current), entry)
        index_path.write_text(_dump(_index_document(leagues)), encoding="utf-8")

    def _rewrite_index(self) -> None:
        """Full rebuild from manifests + legacy monoliths (recovery / tests)."""
        leagues: list[dict[str, Any]] = []
        seen: set[tuple[Any, Any]] = set()

        for path in sorted(self.root.glob(f"*/*/{MANIFEST_NAME}")):
            data = json.loads(path.read_text(encoding="utf-8"))
            key = (data.get("league_id"), data.get("season"))
            leagues.append(_index_entry(data, str(path.relative_to(self.root))))
            seen.add(key)

        for path in sorted(self.root.glob("*/*.json")):
            if path.name == INDEX_NAME:
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            key = (data.get("league_id"), data.get("season"))
            if key in seen:
                continue
            leagues.append(_index_entry(data, str(path.relative_to(self.root))))

        leagues.sort(key=lambda item: (item["league_id"], -(item["season"] or 0)))
        (self.root / INDEX_NAME).write_text(_dump(_index_document(leagues)), encoding="utf-8")


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
        league_id = payload["league_id"]
        season = int(payload["season"])
        _refuse_espn_overwrite_of_golf(self.read(league_id, season), payload)
        parts = split_snapshot(payload)
        bucket = self._get_bucket()
        directory = season_dir_rel(league_id, season)

        for name in CONCERN_FILES:
            blob = bucket.blob(self._key(directory, name))
            blob.cache_control = "no-cache"
            blob.upload_from_string(_dump(parts[name]), content_type="application/json")

        manifest_key = self._key(directory, MANIFEST_NAME)
        manifest_blob = bucket.blob(manifest_key)
        manifest_blob.cache_control = "no-cache"
        manifest_blob.upload_from_string(
            _dump(parts[MANIFEST_NAME]), content_type="application/json"
        )

        legacy = bucket.blob(self._key(monolith_rel(league_id, season)))
        if legacy.exists():
            legacy.delete()

        entry = _index_entry(parts[MANIFEST_NAME], manifest_rel(league_id, season))
        self._upsert_index(entry)
        return f"gs://{self.bucket_name}/{manifest_key}"

    def write_week_box_scores(self, document: dict[str, Any]) -> str:
        """Write ``weeks/{N}.json`` without touching ``index.json`` (roadmap 8.1)."""
        league_id = str(document["league_id"])
        season = int(document["season"])
        week = int(document["week"])
        key = self._key(week_box_score_rel(league_id, season, week))
        blob = self._get_bucket().blob(key)
        blob.cache_control = "no-cache"
        blob.upload_from_string(_dump(document), content_type="application/json")
        return f"gs://{self.bucket_name}/{key}"

    def read_week_box_scores(
        self, league_id: str, season: int, week: int
    ) -> dict[str, Any] | None:
        blob = self._get_bucket().blob(
            self._key(week_box_score_rel(league_id, season, week))
        )
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text())

    def write_pro_schedule(self, document: dict[str, Any]) -> str:
        """Write ``pro_schedule.json`` without touching ``index.json`` (roadmap 8.2)."""
        league_id = str(document["league_id"])
        season = int(document["season"])
        key = self._key(pro_schedule_rel(league_id, season))
        blob = self._get_bucket().blob(key)
        blob.cache_control = "no-cache"
        blob.upload_from_string(_dump(document), content_type="application/json")
        return f"gs://{self.bucket_name}/{key}"

    def read_pro_schedule(
        self, league_id: str, season: int
    ) -> dict[str, Any] | None:
        blob = self._get_bucket().blob(self._key(pro_schedule_rel(league_id, season)))
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text())

    def read(self, league_id: str, season: int) -> dict[str, Any] | None:
        assembled = self._read_v2(league_id, season)
        if assembled is not None:
            return assembled
        blob = self._get_bucket().blob(self._key(monolith_rel(league_id, season)))
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text())

    def list(self) -> list[dict[str, Any]]:
        blob = self._get_bucket().blob(self._key(INDEX_NAME))
        if not blob.exists():
            return []
        return json.loads(blob.download_as_text()).get("leagues", [])

    def _read_v2(self, league_id: str, season: int) -> dict[str, Any] | None:
        directory = season_dir_rel(league_id, season)
        manifest_blob = self._get_bucket().blob(self._key(directory, MANIFEST_NAME))
        if not manifest_blob.exists():
            return None
        manifest = json.loads(manifest_blob.download_as_text())
        files = manifest.get("files") or {}
        parts: dict[str, dict[str, Any]] = {"manifest": manifest}
        for concern, filename in files.items():
            blob = self._get_bucket().blob(self._key(directory, filename))
            if not blob.exists():
                return None
            parts[concern] = json.loads(blob.download_as_text())
        return assemble_snapshot(parts)

    def _upsert_index(self, entry: dict[str, Any]) -> None:
        """Patch ``index.json`` for one league-season without listing the bucket."""
        index_blob = self._get_bucket().blob(self._key(INDEX_NAME))
        if not index_blob.exists():
            self._rewrite_index()
            return
        try:
            current = json.loads(index_blob.download_as_text())
        except json.JSONDecodeError:
            self._rewrite_index()
            return
        leagues = _upsert_league_entry(_index_leagues(current), entry)
        index_blob.cache_control = "no-cache"
        index_blob.upload_from_string(
            _dump(_index_document(leagues)), content_type="application/json"
        )

    def _rewrite_index(self) -> None:
        """Full rebuild from manifests + legacy monoliths (recovery / tests)."""
        bucket = self._get_bucket()
        base = f"{self.prefix}/" if self.prefix else ""
        leagues: list[dict[str, Any]] = []
        seen: set[tuple[Any, Any]] = set()

        for blob in bucket.list_blobs(prefix=base or None):
            rel = blob.name[len(base) :] if base else blob.name
            if _is_manifest_rel(rel):
                data = json.loads(blob.download_as_text())
                key = (data.get("league_id"), data.get("season"))
                leagues.append(_index_entry(data, rel))
                seen.add(key)

        for blob in bucket.list_blobs(prefix=base or None):
            rel = blob.name[len(base) :] if base else blob.name
            if not _is_v1_monolith_rel(rel):
                continue
            data = json.loads(blob.download_as_text())
            key = (data.get("league_id"), data.get("season"))
            if key in seen:
                continue
            leagues.append(_index_entry(data, rel))

        leagues.sort(key=lambda item: (item["league_id"], -(item["season"] or 0)))
        index_blob = bucket.blob(self._key(INDEX_NAME))
        index_blob.cache_control = "no-cache"
        index_blob.upload_from_string(
            _dump(_index_document(leagues)), content_type="application/json"
        )


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


def write_week_box_scores(
    document: dict[str, Any],
    store_dir: Path | str | None = None,
) -> str:
    """Persist one football week box-score file (no index upsert)."""
    return resolve_store(store_dir).write_week_box_scores(document)


def read_week_box_scores(
    league_id: str,
    season: int,
    week: int,
    store_dir: Path | str | None = None,
) -> dict[str, Any] | None:
    """Read ``weeks/{N}.json`` from the active store (no fixture fallback)."""
    return resolve_store(store_dir).read_week_box_scores(league_id, season, week)


def write_pro_schedule(
    document: dict[str, Any],
    store_dir: Path | str | None = None,
) -> str:
    """Persist ``pro_schedule.json`` (no index upsert)."""
    return resolve_store(store_dir).write_pro_schedule(document)


def read_pro_schedule(
    league_id: str,
    season: int,
    store_dir: Path | str | None = None,
) -> dict[str, Any] | None:
    """Read ``pro_schedule.json`` from the active store (no fixture fallback)."""
    return resolve_store(store_dir).read_pro_schedule(league_id, season)


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
