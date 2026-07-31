"""Golf roadmap 8.3 — through-round projection, start caps, auto-pick."""

from __future__ import annotations

from sg.lineup import segment_start_counts, validate_week_lineup
from sg.rounds import fixture_event_rounds
from sg.score import score_team_week
from sg.settings import GolfSettings
from sg.snapshot import build_golf_snapshot


def test_through_round_projects_remaining():
    settings = GolfSettings()
    lineup = {
        "starters": [1, 2, 3, 4, 5],
        "captain": 1,
        "alt1": 6,
        "alt2": None,
    }
    rounds = fixture_event_rounds("e", list(range(1, 10)))
    partial = score_team_week(
        lineup, rounds, settings, multiplier=1.0, through_round=2
    )
    full = score_team_week(
        lineup, rounds, settings, multiplier=1.0, through_round=4
    )
    assert partial["status"] == "in_progress"
    assert partial["through_round"] == 2
    assert set(partial["by_round"]) == {"1", "2"}
    # Remaining rounds = avg × 2 → projected doubles the through total.
    assert abs(partial["week_projected"] - partial["week_total"] * 2) < 1e-9
    assert full["status"] == "final"
    assert full["week_projected"] == full["week_total"]
    assert abs(full["week_total"] - full["week_raw"]) < 1e-9


def test_drop_worst_golfer_raises_week_total():
    settings = GolfSettings.model_validate(
        {"scoring": {"drop_worst_golfer": True}}
    )
    lineup = {
        "starters": [1, 2, 3, 4, 5],
        "captain": 1,
        "alt1": None,
        "alt2": None,
    }
    rounds = fixture_event_rounds("e", list(range(1, 8)))
    base = score_team_week(lineup, rounds, GolfSettings(), multiplier=1.0)
    dropped = score_team_week(lineup, rounds, settings, multiplier=1.0)
    assert dropped["dropped_worst_player_id"] is not None
    # Dropping the lowest (often negative) starter raises week_raw.
    assert dropped["week_raw"] > base["week_raw"]


def test_segment_start_cap_validation():
    settings = GolfSettings.model_validate(
        {"starts": {"max_per_segment": 1}}
    )
    events = [
        {"event_id": "a", "segment_id": "early"},
        {"event_id": "b", "segment_id": "early"},
    ]
    team_lineups = {
        "a": {"starters": [1, 2, 3, 4, 5], "captain": 1},
    }
    errors = validate_week_lineup(
        {"starters": [1, 6, 7, 8, 9], "captain": 1, "alt1": None, "alt2": None},
        roster_ids={1, 2, 3, 4, 5, 6, 7, 8, 9},
        settings=settings,
        events=events,
        team_lineups=team_lineups,
        event_id="b",
    )
    assert any("exceeds segment start cap" in e for e in errors)
    counts = segment_start_counts(
        team_lineups=team_lineups,
        events=events,
        segment_id="early",
        exclude_event_id="b",
    )
    assert counts[1] == 1


def test_auto_pick_scores_missing_lineup():
    from sg.score import build_scoreboard_payload

    snap = build_golf_snapshot(
        league_id="golf-ap",
        name="AP",
        season=2026,
        format="h2h",
        team_count=6,
        synced_at="2026-07-27T00:00:00+00:00",
        run_draft=True,
    )
    # Clear one team's event lineup.
    tid = str(snap["teams"][0]["team_id"])
    eid = snap["lineups"]["events"][0]["event_id"]
    del snap["lineups"]["teams"][tid][eid]
    board = build_scoreboard_payload(snap, scored_at="2026-07-27T00:00:00+00:00")
    assert tid in board["events"][0]["teams"]


def test_settings_defaults_include_83_knobs():
    settings = GolfSettings()
    assert settings.starts.max_per_segment == 3
    assert settings.missed_deadline.auto_pick is True
    assert settings.scoring.drop_worst_golfer is False
