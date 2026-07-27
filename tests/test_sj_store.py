import json
from pathlib import Path

import pytest

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
        "team_count": 1,
        "teams": [],
        "players": [],
    }


def test_fixtures_readable():
    snap = read_snapshot("football-main", 2025, store_dir=ROOT / "fixtures" / "sj")
    assert snap["espn_league_id"] == 39790
    assert len(snap["teams"]) >= 1


def test_write_and_list_snapshots(tmp_path: Path):
    location = write_snapshot(snapshot(), store_dir=tmp_path)
    assert Path(location).exists()
    items = list_snapshots(tmp_path)
    assert len(items) == 1
    assert items[0]["league_id"] == "football-main"
    assert items[0]["synced_at"]


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
    assert location == "gs://sj-data/snapshots/football-main/2025.json"
    store.write(snapshot(2024))

    assert store.read("football-main", 2025)["season"] == 2025
    assert store.read("football-main", 1999) is None

    index = json.loads(bucket.objects["snapshots/index.json"])
    seasons = [item["season"] for item in index["leagues"]]
    assert seasons == [2025, 2024]
    assert store.list()[0]["path"] == "football-main/2025.json"
