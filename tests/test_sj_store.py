import json
from pathlib import Path

import pytest

from sj.snapshot_layout import MANIFEST_NAME, SCHEMA_VERSION
from sj.store import (
    FileStore,
    GcsStore,
    describe_store,
    list_snapshots,
    read_snapshot,
    resolve_store,
    write_snapshot,
)

ROOT = Path(__file__).resolve().parents[1]


def snapshot(season: int = 2025) -> dict:
    return {
        "league_id": "football-main",
        "espn_league_id": 39790,
        "sport": "football",
        "format": "redraft",
        "season": season,
        "name": "Strictly Jayers Football",
        "short_name": "Football",
        "scoring_type": "H2H_POINTS",
        "team_count": 1,
        "current_week": 1,
        "period_label": "week",
        "draft": [],
        "teams": [
            {
                "team_id": 1,
                "name": "Solo",
                "abbrev": "SOL",
                "owners": ["A"],
                "logo_url": None,
                "wins": 0,
                "losses": 0,
                "ties": 0,
                "win_pct": None,
                "points_for": 0.0,
                "points_against": 0.0,
                "standing": 1,
                "division": "",
                "schedule": [],
                "scores": [],
                "outcomes": [],
                "roster": [],
            }
        ],
        "players": [],
    }


def test_fixtures_readable_as_v1_monolith():
    """Committed fixtures stay on schema_version 1; dual-read must still load them."""
    snap = read_snapshot("football-main", 2026, store_dir=ROOT / "fixtures" / "sj")
    assert snap["espn_league_id"] == 39790
    assert snap["season"] == 2026
    assert len(snap["teams"]) >= 1
    assert "settings" in snap and "draft" in snap
    assert (ROOT / "fixtures" / "sj" / "football-main" / "2026.json").exists()


def test_write_emits_v2_layout_and_lists(tmp_path: Path):
    location = write_snapshot(snapshot(), store_dir=tmp_path)
    manifest = Path(location)
    assert manifest.name == MANIFEST_NAME
    assert manifest.exists()
    season_dir = manifest.parent
    assert (season_dir / "standings.json").exists()
    assert (season_dir / "rosters.json").exists()
    assert (season_dir / "matchups.json").exists()
    assert (season_dir / "draft.json").exists()
    assert (season_dir / "settings.json").exists()
    assert (season_dir / "transactions.json").exists()
    assert (season_dir / "free_agents.json").exists()
    # Writers must not leave a v1 monolith behind.
    assert not (tmp_path / "football-main" / "2025.json").exists()

    items = list_snapshots(tmp_path)
    assert len(items) == 1
    assert items[0]["league_id"] == "football-main"
    assert items[0]["synced_at"]
    assert items[0]["path"] == f"football-main/2025/{MANIFEST_NAME}"

    loaded = read_snapshot("football-main", 2025, store_dir=tmp_path)
    assert loaded["schema_version"] == SCHEMA_VERSION
    assert loaded["teams"][0]["name"] == "Solo"
    assert loaded["draft"] == []


def test_write_replaces_legacy_monolith(tmp_path: Path):
    legacy = tmp_path / "football-main" / "2025.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text(json.dumps(snapshot()), encoding="utf-8")

    write_snapshot(snapshot(), store_dir=tmp_path)
    assert not legacy.exists()
    assert (tmp_path / "football-main" / "2025" / MANIFEST_NAME).exists()


def test_index_prefers_v2_when_both_layouts_present(tmp_path: Path):
    """A leftover v1 file for another season still indexes; v2 wins on collision."""
    store = FileStore(tmp_path)
    store.write(snapshot(2025))

    # Plant a v1 monolith for 2024 without going through write().
    v1 = snapshot(2024)
    v1_path = tmp_path / "football-main" / "2024.json"
    v1_path.parent.mkdir(parents=True, exist_ok=True)
    v1_path.write_text(json.dumps(v1), encoding="utf-8")
    store._rewrite_index()

    items = {item["season"]: item for item in store.list()}
    assert items[2025]["path"] == f"football-main/2025/{MANIFEST_NAME}"
    assert items[2024]["path"] == "football-main/2024.json"


def test_write_upserts_index_without_full_rewrite(tmp_path: Path, monkeypatch):
    """Roadmap 2.3: once an index exists, later writes must not rescan the store."""
    store = FileStore(tmp_path)
    store.write(snapshot(2024))

    def boom() -> None:
        raise AssertionError("full _rewrite_index should not run when index exists")

    monkeypatch.setattr(store, "_rewrite_index", boom)
    store.write(snapshot(2025))

    items = store.list()
    assert {item["season"] for item in items} == {2024, 2025}
    assert all(item["path"].endswith(f"/{MANIFEST_NAME}") for item in items)


def test_upsert_replaces_same_season_entry(tmp_path: Path):
    store = FileStore(tmp_path)
    store.write(snapshot(2025))
    first = store.list()[0]["synced_at"]

    store.write(snapshot(2025))
    items = store.list()
    assert len(items) == 1
    assert items[0]["season"] == 2025
    assert items[0]["synced_at"] != first


def test_missing_index_falls_back_to_full_rebuild(tmp_path: Path):
    store = FileStore(tmp_path)
    store.write(snapshot(2024))
    store.write(snapshot(2025))
    (tmp_path / "index.json").unlink()

    # Next write rebuilds from manifests on disk, then upserts.
    store.write(snapshot(2023))
    assert {item["season"] for item in store.list()} == {2023, 2024, 2025}


def test_missing_snapshot_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        read_snapshot("football-main", 1999, store_dir=tmp_path)


def test_explicit_store_dir_beats_gcs_env(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("SJ_GCS_BUCKET", "some-bucket")
    store = resolve_store(tmp_path)
    assert isinstance(store, FileStore)
    assert describe_store(tmp_path) == str(tmp_path)


def test_gcs_selected_from_env(monkeypatch):
    monkeypatch.setenv("SJ_GCS_BUCKET", "sj-data")
    monkeypatch.setenv("SJ_GCS_PREFIX", "snapshots")
    store = resolve_store()
    assert isinstance(store, GcsStore)
    assert store.bucket_name == "sj-data"
    assert describe_store() == "gs://sj-data/snapshots"


class FakeBlob:
    def __init__(self, bucket: "FakeBucket", name: str):
        self.bucket = bucket
        self.name = name
        self.cache_control = None

    def exists(self) -> bool:
        return self.name in self.bucket.objects

    def upload_from_string(self, data: str, content_type: str | None = None) -> None:
        self.bucket.objects[self.name] = data

    def download_as_text(self) -> str:
        return self.bucket.objects[self.name]

    def delete(self) -> None:
        self.bucket.objects.pop(self.name, None)


class FakeBucket:
    def __init__(self):
        self.objects: dict[str, str] = {}

    def blob(self, name: str) -> FakeBlob:
        return FakeBlob(self, name)

    def list_blobs(self, prefix=None):
        for name in sorted(self.objects):
            if prefix is None or name.startswith(prefix):
                yield FakeBlob(self, name)


def test_gcs_store_round_trip(monkeypatch):
    bucket = FakeBucket()
    store = GcsStore("sj-data", prefix="snapshots")
    monkeypatch.setattr(store, "_get_bucket", lambda: bucket)

    location = store.write(snapshot(2025))
    assert location == f"gs://sj-data/snapshots/football-main/2025/{MANIFEST_NAME}"
    store.write(snapshot(2024))

    assert store.read("football-main", 2025)["season"] == 2025
    assert store.read("football-main", 2025)["schema_version"] == SCHEMA_VERSION
    assert store.read("football-main", 1999) is None

    index = json.loads(bucket.objects["snapshots/index.json"])
    seasons = [item["season"] for item in index["leagues"]]
    assert seasons == [2025, 2024]
    assert store.list()[0]["path"] == f"football-main/2025/{MANIFEST_NAME}"
    # Concern objects landed too.
    assert "snapshots/football-main/2025/standings.json" in bucket.objects


def test_gcs_write_upserts_without_listing_bucket(monkeypatch):
    bucket = FakeBucket()
    store = GcsStore("sj-data", prefix="snapshots")
    monkeypatch.setattr(store, "_get_bucket", lambda: bucket)
    store.write(snapshot(2024))

    def boom() -> None:
        raise AssertionError("full _rewrite_index should not run when index exists")

    monkeypatch.setattr(store, "_rewrite_index", boom)
    # list_blobs is only used by the full rebuild — upsert must not need it.
    monkeypatch.setattr(
        bucket,
        "list_blobs",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("list_blobs")),
    )
    store.write(snapshot(2025))
    assert {item["season"] for item in store.list()} == {2024, 2025}
