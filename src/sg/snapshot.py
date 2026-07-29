"""Build hub-compatible golf league snapshots (no ESPN, no live tour feed)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sg.draft import run_snake_draft
from sg.lineup import build_lineups_payload
from sg.schedule import FIXTURE_NOW
from sg.score import build_scoreboard_payload
from sg.settings import (
    DEFAULT_GOLF_SETTINGS,
    GolfSettings,
    validate_golf_format,
    validate_golf_settings,
    validate_team_count,
)
from sg.standings import (
    apply_matchups_from_scoreboard,
    apply_standings_from_scoreboard,
)
from sj.snapshot_layout import SCHEMA_VERSION

_GOLF_TEAM_NAMES = (
    "Fairway Phantoms",
    "Pin High Posse",
    "Sand Trap Syndicate",
    "Birdie Brigade",
    "Eagle Eyes",
    "Rough Riders",
    "Ace Alliance",
    "Bogey Bandits",
    "Cut Line Crew",
    "Green Jacket Gang",
    "Tee Box Titans",
    "Mulligan Mob",
    "Par Seekers",
    "Trophy Club",
)


def _team_names(count: int) -> list[str]:
    if count <= len(_GOLF_TEAM_NAMES):
        return list(_GOLF_TEAM_NAMES[:count])
    return [
        (
            _GOLF_TEAM_NAMES[i]
            if i < len(_GOLF_TEAM_NAMES)
            else f"{_GOLF_TEAM_NAMES[i % len(_GOLF_TEAM_NAMES)]} {i // len(_GOLF_TEAM_NAMES) + 1}"
        )
        for i in range(count)
    ]


def build_golf_snapshot(
    *,
    league_id: str,
    name: str,
    short_name: str | None = None,
    season: int,
    format: str,
    team_count: int,
    golf: GolfSettings | dict[str, Any] | None = None,
    synced_at: str | None = None,
    run_draft: bool = True,
    build_lineups: bool = True,
) -> dict[str, Any]:
    """Golf league snapshot with settings; snake-drafts OWGR pool by default (6.4b)."""
    fmt = validate_golf_format(format)
    teams_n = validate_team_count(team_count)
    settings = validate_golf_settings(golf)
    stamp = synced_at or datetime.now(timezone.utc).isoformat()
    names = _team_names(teams_n)
    teams: list[dict[str, Any]] = []
    for index, team_name in enumerate(names):
        teams.append(
            {
                "team_id": index + 1,
                "name": team_name,
                "abbrev": "".join(word[0] for word in team_name.split())[:4].upper(),
                "owners": [f"Owner {index + 1}"],
                "logo_url": None,
                "wins": 0,
                "losses": 0,
                "ties": 0,
                "win_pct": 0.0,
                "points_for": 0.0,
                "points_against": 0.0,
                "standing": index + 1,
                "division": "",
                "schedule": [],
                "scores": [],
                "outcomes": [],
                "roster": [],
            }
        )

    draft: list[dict[str, Any]] = []
    players: list[dict[str, Any]] = []
    free_agents: list[dict[str, Any]] = []
    if run_draft:
        draft, players, free_agents = run_snake_draft(teams, settings)

    lineups: dict[str, Any] | None = None
    scoreboard: dict[str, Any] | None = None
    current_week: int | None = None
    if build_lineups and run_draft:
        # Deterministic lock stamps when regenerating fixtures.
        now_iso = FIXTURE_NOW if synced_at == "2026-07-27T00:00:00+00:00" else stamp
        lineups = build_lineups_payload(
            teams,
            settings,
            season=season,
            saved_at=stamp,
            now_iso=now_iso,
        )
        current_week = 1
        # Score both fixture events offline (roadmap 6.4d).
        scoreboard = build_scoreboard_payload(
            {
                "settings": {"golf": settings.model_dump(mode="json")},
                "teams": teams,
                "lineups": lineups,
            },
            scored_at=stamp,
        )
        # Season standings + history matchup arrays from scored weeks.
        apply_standings_from_scoreboard(teams, scoreboard, fmt)
        apply_matchups_from_scoreboard(teams, scoreboard)

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "league_id": league_id,
        "espn_league_id": None,
        "sport": "golf",
        "format": fmt,
        "season": season,
        "name": name,
        "short_name": short_name or name,
        "scoring_type": "GOLF_COUNTING",
        "team_count": teams_n,
        "current_week": current_week,
        "period_label": "event",
        "synced_at": stamp,
        "settings": {
            "team_count": teams_n,
            "scoring_type": "GOLF_COUNTING",
            "golf": settings.model_dump(mode="json"),
        },
        "draft": draft,
        "transactions": [],
        "free_agents": free_agents,
        "teams": teams,
        "players": players,
    }
    if lineups is not None:
        payload["lineups"] = lineups
    if scoreboard is not None:
        payload["scoreboard"] = scoreboard
    return payload


def golf_settings_from_registry(spec: Any) -> GolfSettings:
    """Merge optional registry ``golf`` block onto defaults."""
    raw = getattr(spec, "golf", None)
    if raw is None:
        return DEFAULT_GOLF_SETTINGS.model_copy(deep=True)
    if hasattr(raw, "model_dump"):
        block = raw.model_dump(mode="json")
    elif isinstance(raw, dict):
        block = raw
    else:
        return DEFAULT_GOLF_SETTINGS.model_copy(deep=True)
    # Registry uses flat missed_cut_mode / draft_style; snapshot uses nested shape.
    return validate_golf_settings(
        {
            **DEFAULT_GOLF_SETTINGS.model_dump(mode="json"),
            "draft": {
                "style": block.get("draft_style", "snake"),
                "keepers": bool(block.get("keepers", False)),
            },
            "roster": {
                "starters": 5,
                "bench": int(block.get("bench", 10)),
            },
            "missed_cut": {"mode": block.get("missed_cut_mode", "alt1")},
            "multipliers": block.get("multipliers")
            or DEFAULT_GOLF_SETTINGS.multipliers.model_dump(mode="json"),
        }
    )
