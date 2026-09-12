"""Football weekly box scores (roadmap 8.1)."""

from __future__ import annotations

import inspect
import json
from types import SimpleNamespace

import pytest

from sj.serialize import (
    build_week_box_scores_document,
    extract_box_player_stats,
    serialize_box_player,
)
from sj.snapshot_layout import MANIFEST_NAME, split_snapshot, week_box_score_rel
from sj.store import FIXTURES_DIR, FileStore
from sj.sync import (
    BOX_SCORE_MIN_SEASON,
    fetch_box_scores,
    sync_football_box_scores,
    sync_hockey_week_boxes,
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
        "stats": {"RY": 84.0, "REC": 3.0, "REY": 22.0},
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


def test_extract_box_player_stats_maps_espn_ids():
    player = SimpleNamespace(points_breakdown={3: 2, 43: 6, 4: 240})
    stats = extract_box_player_stats(player)
    assert stats["PTD"] == pytest.approx(2)
    assert stats["REC"] == pytest.approx(6)
    assert stats["PY"] == pytest.approx(240)


def test_serialize_box_player_uses_league_points():
    row = serialize_box_player(_box_player())
    assert row["id"] == 4242
    assert row["points"] == pytest.approx(18.4)
    assert row["projected_points"] == pytest.approx(15.2)
    assert row["slot"] == "RB"
    assert row["stats"]["RY"] == pytest.approx(84.0)
    assert row["stats"]["REC"] == pytest.approx(3.0)
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


def test_espn_api_hockey_box_scores_rejects_week():
    """Lock the 0.46 hockey signature that crashed sj-sync."""
    from espn_api.hockey.league import League

    params = inspect.signature(League.box_scores).parameters
    assert "week" not in params
    assert "matchup_period" in params
    assert "scoring_period" in params
    with pytest.raises(TypeError, match="unexpected keyword argument 'week'"):
        League.box_scores(None, week=1)  # type: ignore[misc]


def test_fetch_box_scores_hockey_signature_never_passes_week():
    """espn-api 0.46 hockey League.box_scores has no week= kwarg."""
    calls: list[dict[str, object]] = []

    def box_scores(
        matchup_period=None, scoring_period=None, matchup_total=True
    ):
        calls.append(
            {
                "matchup_period": matchup_period,
                "scoring_period": scoring_period,
                "matchup_total": matchup_total,
            }
        )
        return [_box_score()]

    league = SimpleNamespace(year=2026, box_scores=box_scores)
    boxes = fetch_box_scores(league, 4)
    assert len(boxes) == 1
    assert calls == [
        {"matchup_period": 4, "scoring_period": 4, "matchup_total": True}
    ]


def test_fetch_box_scores_hockey_kwargs_mock_rejects_week():
    """Recovery path: **kwargs mock that raises on week= still writes via periods."""
    calls: list[dict[str, object]] = []

    def box_scores(**kwargs):
        if "week" in kwargs:
            raise TypeError(
                "League.box_scores() got an unexpected keyword argument 'week'"
            )
        if "matchup_period" not in kwargs and "scoring_period" not in kwargs:
            raise TypeError("box_scores() missing matchup_period/scoring_period")
        calls.append(kwargs)
        return [_box_score()]

    league = SimpleNamespace(year=2026, box_scores=box_scores)
    boxes = fetch_box_scores(league, 7)
    assert len(boxes) == 1
    assert calls == [{"matchup_period": 7, "scoring_period": 7}]


def test_fetch_box_scores_football_omits_unknown_player_team_cache():
    weeks: list[int] = []

    def box_scores(*, week):
        weeks.append(week)
        return [_box_score()]

    league = SimpleNamespace(year=2026, box_scores=box_scores)
    assert len(fetch_box_scores(league, 2, player_team_cache={})) == 1
    assert weeks == [2]


def test_fetch_box_scores_skips_unrecognized_kwargs():
    def box_scores(**kwargs):
        raise TypeError("got an unexpected keyword argument 'foo'")

    league = SimpleNamespace(year=2026, box_scores=box_scores)
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


def test_football_main_week_fixtures_carry_named_stats():
    """Roadmap 8.4: committed weeks 13/14 include starter stat lines."""
    for week in (13, 14):
        path = FIXTURES_DIR / "football-main" / "2026" / "weeks" / f"{week}.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        starters = [
            p
            for m in doc["matchups"]
            for p in (m.get("home_lineup") or []) + (m.get("away_lineup") or [])
            if (p.get("slot") or "").upper() not in {"BE", "BN", "BENCH"}
        ]
        assert starters
        assert all(p.get("stats") for p in starters)
        recs = sum(float((p.get("stats") or {}).get("REC") or 0) for p in starters)
        if week == 14:
            assert recs > 20


def test_sync_hockey_week_boxes_points_writes_weeks(tmp_path):
    """TOTAL_SEASON_POINTS hockey uses box_scores(matchup_period=, scoring_period=)."""
    calls: list[tuple[int | None, int | None]] = []

    def box_scores(
        matchup_period=None, scoring_period=None, matchup_total=True
    ):
        calls.append((matchup_period, scoring_period))
        return [_box_score()]

    league = SimpleNamespace(year=2026, box_scores=box_scores)
    spec = SimpleNamespace(id="hockey-main", sport="hockey")
    snapshot = {
        "current_week": 3,
        "period_label": "week",
        "synced_at": "2026-07-30T12:00:00Z",
        "scoring_type": "TOTAL_SEASON_POINTS",
    }
    written = sync_hockey_week_boxes(
        league, spec, 2026, snapshot, store_dir=tmp_path
    )
    assert written == 3
    assert calls == [(1, 1), (2, 2), (3, 3)]
    path = tmp_path / "hockey-main" / "2026" / "weeks" / "2.json"
    assert path.is_file()
    doc = json.loads(path.read_text(encoding="utf-8"))
    assert doc["sport"] == "hockey"
    assert doc["week"] == 2


def test_sync_hockey_week_boxes_rejects_week_kwarg(tmp_path):
    seen_week = False

    def box_scores(**kwargs):
        nonlocal seen_week
        if "week" in kwargs:
            seen_week = True
            raise TypeError(
                "League.box_scores() got an unexpected keyword argument 'week'"
            )
        return [_box_score()]

    league = SimpleNamespace(year=2026, box_scores=box_scores)
    spec = SimpleNamespace(id="hockey-main", sport="hockey")
    snapshot = {
        "current_week": 2,
        "period_label": "week",
        "scoring_type": "TOTAL_SEASON_POINTS",
    }
    written = sync_hockey_week_boxes(
        league, spec, 2026, snapshot, store_dir=tmp_path
    )
    assert written == 2
    # **kwargs mock has no named period params, so the TypeError fallback
    # probes week= then recovers with matchup_period/scoring_period.
    assert seen_week
    assert (tmp_path / "hockey-main" / "2026" / "weeks" / "1.json").is_file()


def test_sync_hockey_week_boxes_skips_football(tmp_path):
    league = SimpleNamespace(year=2026, box_scores=lambda **_: [_box_score()])
    spec = SimpleNamespace(id="football-main", sport="football")
    written = sync_hockey_week_boxes(
        league, spec, 2026, {"current_week": 5}, store_dir=tmp_path
    )
    assert written == 0
    assert not (tmp_path / "football-main").exists()


def test_sync_hockey_week_boxes_category_uses_scoreboard(tmp_path):
    def box_scores(**kwargs):
        raise AssertionError("category hockey must not call box_scores")

    def scoreboard(*, matchupPeriod):
        return [
            SimpleNamespace(
                home_team=1,
                away_team=2,
                home_team_cats={"G": 3},
                away_team_cats={"G": 1},
            )
        ]

    league = SimpleNamespace(year=2026, box_scores=box_scores, scoreboard=scoreboard)
    spec = SimpleNamespace(id="hockey-main", sport="hockey")
    snapshot = {
        "current_week": 1,
        "period_label": "week",
        "scoring_type": "H2H_MOST_CATEGORIES",
    }
    written = sync_hockey_week_boxes(
        league, spec, 2026, snapshot, store_dir=tmp_path
    )
    assert written == 1
    path = tmp_path / "hockey-main" / "2026" / "weeks" / "1.json"
    assert path.is_file()
