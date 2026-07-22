from pathlib import Path

from sj.store import list_snapshots, read_snapshot, write_snapshot

ROOT = Path(__file__).resolve().parents[1]


def test_fixtures_readable():
    snap = read_snapshot("football-main", 2025, store_dir=ROOT / "fixtures" / "sj")
    assert snap["espn_league_id"] == 39790
    assert len(snap["teams"]) >= 1


def test_write_and_list_snapshots(tmp_path: Path):
    snapshot = {
        "league_id": "football-main",
        "espn_league_id": 39790,
        "sport": "football",
        "format": "redraft",
        "season": 2025,
        "name": "Strictly Jayers Football",
        "team_count": 1,
        "teams": [],
        "players": [],
    }
    path = write_snapshot(snapshot, store_dir=tmp_path)
    assert path.exists()
    items = list_snapshots(tmp_path)
    assert len(items) == 1
    assert items[0]["league_id"] == "football-main"
