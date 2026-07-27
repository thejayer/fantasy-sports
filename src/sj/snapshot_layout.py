"""Split / assemble league-season snapshots (roadmap 2.2).

Writers still build one in-memory monolith via :func:`sj.serialize.serialize_league`.
The store persists that as per-concern files under ``{league}/{season}/`` with a
manifest. Readers reassemble the monolith so sync/seed/CLI and the web app keep
a stable façade during rollout. Schema version 1 is the legacy
``{league}/{season}.json`` monolith (committed fixtures); version 2 is the split.
"""

from __future__ import annotations

from typing import Any

SCHEMA_VERSION = 2
MANIFEST_NAME = "manifest.json"

# Team fields that belong in standings.json (not roster / matchup arrays).
_STANDINGS_TEAM_KEYS = (
    "team_id",
    "name",
    "abbrev",
    "owners",
    "logo_url",
    "wins",
    "losses",
    "ties",
    "win_pct",
    "points_for",
    "points_against",
    "standing",
    "division",
)

CONCERN_FILES = (
    "standings.json",
    "rosters.json",
    "matchups.json",
    "draft.json",
    "settings.json",
    "transactions.json",
)


def season_dir_rel(league_id: str, season: int) -> str:
    return f"{league_id}/{season}"


def manifest_rel(league_id: str, season: int) -> str:
    return f"{season_dir_rel(league_id, season)}/{MANIFEST_NAME}"


def monolith_rel(league_id: str, season: int) -> str:
    """Legacy schema_version 1 path."""
    return f"{league_id}/{season}.json"


def split_snapshot(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Split a monolith into ``{filename: payload}``, manifest included."""
    teams = snapshot.get("teams") or []
    standings_teams: list[dict[str, Any]] = []
    roster_by_id: dict[str, list[Any]] = {}
    matchup_by_id: dict[str, dict[str, Any]] = {}

    for team in teams:
        team_id = team.get("team_id")
        key = str(team_id)
        standings_teams.append({k: team.get(k) for k in _STANDINGS_TEAM_KEYS})
        roster_by_id[key] = list(team.get("roster") or [])
        matchup_by_id[key] = {
            "schedule": list(team.get("schedule") or []),
            "scores": list(team.get("scores") or []),
            "outcomes": list(team.get("outcomes") or []),
        }

    files = {
        "standings": "standings.json",
        "rosters": "rosters.json",
        "matchups": "matchups.json",
        "draft": "draft.json",
        "settings": "settings.json",
        "transactions": "transactions.json",
    }
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "league_id": snapshot["league_id"],
        "espn_league_id": snapshot.get("espn_league_id"),
        "sport": snapshot.get("sport"),
        "format": snapshot.get("format"),
        "season": snapshot["season"],
        "name": snapshot.get("name"),
        "short_name": snapshot.get("short_name"),
        "team_count": snapshot.get("team_count"),
        "synced_at": snapshot.get("synced_at"),
        "files": files,
    }
    settings = snapshot.get("settings")
    if not isinstance(settings, dict):
        settings = {}
    return {
        MANIFEST_NAME: manifest,
        "standings.json": {
            "scoring_type": snapshot.get("scoring_type"),
            "current_week": snapshot.get("current_week"),
            "period_label": snapshot.get("period_label"),
            "teams": standings_teams,
        },
        "rosters.json": {
            "teams": roster_by_id,
            # Denormalized for the Players tab — same list serialize_league built.
            "players": list(snapshot.get("players") or []),
        },
        "matchups.json": {
            "period_label": snapshot.get("period_label"),
            "current_week": snapshot.get("current_week"),
            "teams": matchup_by_id,
        },
        "draft.json": {"draft": list(snapshot.get("draft") or [])},
        "settings.json": {"settings": settings},
        "transactions.json": {"transactions": list(snapshot.get("transactions") or [])},
    }


def assemble_snapshot(parts: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Reassemble a monolith from named concern payloads.

    ``parts`` keys are concern names (``manifest``, ``standings``, …) or the
    corresponding filenames; both are accepted. ``settings`` / ``transactions``
    are optional so seasons written before roadmap 2.4 still assemble.
    """
    manifest = _part(parts, "manifest", MANIFEST_NAME)
    standings = _part(parts, "standings", "standings.json")
    rosters = _part(parts, "rosters", "rosters.json")
    matchups = _part(parts, "matchups", "matchups.json")
    draft = _part(parts, "draft", "draft.json") or {}
    settings_part = _optional_part(parts, "settings", "settings.json") or {}
    transactions_part = _optional_part(parts, "transactions", "transactions.json") or {}

    roster_by_id = rosters.get("teams") or {}
    matchup_by_id = matchups.get("teams") or {}
    teams: list[dict[str, Any]] = []
    for team in standings.get("teams") or []:
        key = str(team.get("team_id"))
        m = matchup_by_id.get(key) or {}
        teams.append(
            {
                **team,
                "schedule": list(m.get("schedule") or []),
                "scores": list(m.get("scores") or []),
                "outcomes": list(m.get("outcomes") or []),
                "roster": list(roster_by_id.get(key) or []),
            }
        )

    settings = settings_part.get("settings")
    if not isinstance(settings, dict):
        settings = {}

    return {
        "league_id": manifest["league_id"],
        "espn_league_id": manifest.get("espn_league_id"),
        "sport": manifest.get("sport"),
        "format": manifest.get("format"),
        "season": manifest["season"],
        "name": manifest.get("name"),
        "short_name": manifest.get("short_name"),
        "scoring_type": standings.get("scoring_type"),
        "team_count": manifest.get("team_count"),
        "current_week": standings.get("current_week"),
        "period_label": standings.get("period_label"),
        "synced_at": manifest.get("synced_at"),
        "schema_version": manifest.get("schema_version", SCHEMA_VERSION),
        "settings": settings,
        "draft": list(draft.get("draft") or []),
        "transactions": list(transactions_part.get("transactions") or []),
        "teams": teams,
        "players": list(rosters.get("players") or []),
    }


def _part(
    parts: dict[str, dict[str, Any]], name: str, filename: str
) -> dict[str, Any]:
    if name in parts:
        return parts[name]
    if filename in parts:
        return parts[filename]
    raise KeyError(f"missing snapshot part {name!r} ({filename})")


def _optional_part(
    parts: dict[str, dict[str, Any]], name: str, filename: str
) -> dict[str, Any] | None:
    if name in parts:
        return parts[name]
    if filename in parts:
        return parts[filename]
    return None
