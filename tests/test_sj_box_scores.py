"""Football weekly box scores (roadmap 8.1)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from sj.serialize import (
    build_week_box_scores_document,
    serialize_box_player,
)
from sj.snapshot_layout import MANIFEST_NAME, split_snapshot, week_box_score_rel
from sj.store import FileStore
from sj.sync import (
    BOX_SCORE_MIN_SEASON,
    fetch_box_scores,
    sync_football_box_scores,
)


def _box_player(**overrides):
    base = {
        "playerId": 4242,
        "name": "Example Back",
        "position": "RB",
        "slot_position": "RB",
        "proTeam": "DAL",
        "pro_opponent": "PHI",
        "on_bye_week": False,
        "points": 18.4,
        "projected_points": 15.2,
        "injuryStatus": "ACTIVE",
        "game_played": 100,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _box_score(**overrides):
    base = {
        "home_team": 1,
        "away_team": 2,
        "home_score": 134.0,
        "away_score": 121.2,
        "home_projected": 128.5,
        "away_projected": 119.0,
        "is_playoff": False,
        "matchup_type": "NONE",
        "home_lineup": [_box_player()],
        "away_lineup": [_box_player(playerId=99, name="Other", points=12.0)],
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_serialize_box_player_uses_league_points():
    row = serialize_box_player(_box_player())
    assert row["id"] == 4242
    assert row["points"] == pytest.approx(18.4)
    assert row["projected_points"] == pytest.approx(15.2)
    assert row["slot"] == "RB"
    assert "breakdown" not in row


def test_build_week_document():
    doc = build_week_box_scores_document(
        league_id="football-main",
        season=2026,
        week=14,
        box_scores=[_box_score()],
        synced_at="2026-07-30T12:00:00Z",
    )
    assert doc["week"] == 14
    assert doc["sport"] == "football"
    assert len(doc["matchups"]) == 1
    assert doc["matchups"][0]["home_lineup"][0]["points"] == pytest.approx(18.4)


def test_write_week_does_not_upsert_index(tmp_path):
    store = FileStore(tmp_path)
    season_snap = {
        "league_id": "football-main",
        "espn_league_id": 1,
        "sport": "football",
        "format": "redraft",
        "season": 2026,
        "name": "Test",
        "team_count": 2,
        "current_week": 2,
        "period_label": "week",
        "settings": {},
        "draft": [],
        "transactions": [],
        "free_agents": [],
        "teams": [
            {
                "team_id": 1,
                "name": "A",
                "abbrev": "A",
                "owners": [],
                "wins": 1,
                "losses": 0,
                "ties": 0,
                "win_pct": 1.0,
                "points_for": 100,
                "points_against": 90,
                "standing": 1,
                "division": "",
                "schedule": [2],
                "scores": [100],
                "outcomes": ["W"],
                "roster": [],
            },
            {
                "team_id": 2,
                "name": "B",
                "abbrev": "B",
                "owners": [],
                "wins": 0,
                "losses": 1,
                "ties": 0,
                "win_pct": 0.0,
                "points_for": 90,
                "points_against": 100,
                "standing": 2,
                "division": "",
                "schedule": [1],
                "scores": [90],
                "outcomes": ["L"],
                "roster": [],
            },
        ],
        "players": [],
    }
    store.write(season_snap)
    index_before = (tmp_path / "index.json").read_text(encoding="utf-8")

    # Boom if week writes try to rewrite the full index.
    store._rewrite_index = lambda: (_ for _ in ()).throw(RuntimeError("rewrite"))  # type: ignore[method-assign]

    for week in range(1, 6):
        doc = build_week_box_scores_document(
            league_id="football-main",
            season=2026,
            week=week,
            box_scores=[_box_score()],
        )
        store.write_week_box_scores(doc)

    assert (tmp_path / "index.json").read_text(encoding="utf-8") == index_before
    assert store.read_week_box_scores("football-main", 2026, 3)["week"] == 3
    # Season assemble still works and does not require weeks.
    assembled = store.read("football-main", 2026)
    assert assembled is not None
    assert assembled["team_count"] == 2
    assert "weeks" not in (assembled.get("settings") or {})


def test_weeks_not_in_manifest_files():
    snap = {
        "league_id": "x",
        "espn_league_id": 1,
        "sport": "football",
        "format": "redraft",
        "season": 2026,
        "name": "X",
        "team_count": 0,
        "current_week": 1,
        "period_label": "week",
        "settings": {},
        "draft": [],
        "transactions": [],
        "free_agents": [],
        "teams": [],
        "players": [],
    }
    parts = split_snapshot(snap)
    files = parts[MANIFEST_NAME]["files"]
    assert "weeks" not in files
    assert all(not str(v).startswith("weeks/") for v in files.values())


def test_week_box_score_rel():
    assert week_box_score_rel("football-main", 2026, 14) == (
        "football-main/2026/weeks/14.json"
    )


def test_fetch_box_scores_skips_pre_2019():
    league = SimpleNamespace(year=BOX_SCORE_MIN_SEASON - 1, box_scores=lambda **_: [_box_score()])
    assert fetch_box_scores(league, 1) == []


def test_sync_football_box_scores_writes_weeks(tmp_path):
    calls: list[int] = []

    def box_scores(*, week, player_team_cache=None):
        calls.append(week)
        return [_box_score()]

    league = SimpleNamespace(year=2026, box_scores=box_scores)
    spec = SimpleNamespace(id="football-main", sport="football")
    snapshot = {
        "current_week": 3,
        "period_label": "week",
        "synced_at": "2026-07-30T12:00:00Z",
    }
    written = sync_football_box_scores(
        league, spec, 2026, snapshot, store_dir=tmp_path
    )
    assert written == 3
    assert calls == [1, 2, 3]
    path = tmp_path / "football-main" / "2026" / "weeks" / "2.json"
    assert path.is_file()


def test_sync_football_box_scores_skips_baseball(tmp_path):
    league = SimpleNamespace(year=2026, box_scores=lambda **_: [_box_score()])
    spec = SimpleNamespace(id="baseball-main", sport="baseball")
    written = sync_football_box_scores(
        league, spec, 2026, {"current_week": 5}, store_dir=tmp_path
    )
    assert written == 0
    assert not (tmp_path / "baseball-main").exists()
