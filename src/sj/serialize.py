"""Serialize espn-api league objects into plain JSON-friendly dicts."""

from __future__ import annotations

from typing import Any


def _owner_names(team: Any) -> list[str]:
    owners = getattr(team, "owners", None) or []
    names: list[str] = []
    for owner in owners:
        if isinstance(owner, dict):
            first = owner.get("firstName") or owner.get("displayName") or ""
            last = owner.get("lastName") or ""
            label = f"{first} {last}".strip() or owner.get("id") or "Owner"
            names.append(str(label))
        else:
            names.append(str(owner))
    return names


def serialize_player(player: Any) -> dict[str, Any]:
    return {
        "id": getattr(player, "playerId", None) or getattr(player, "player_id", None),
        "name": getattr(player, "name", None),
        "position": getattr(player, "position", None),
        "slot": getattr(player, "lineupSlot", None) or getattr(player, "slot_position", None),
        "pro_team": getattr(player, "proTeam", None) or getattr(player, "pro_team", None),
        "injury_status": getattr(player, "injuryStatus", None)
        or getattr(player, "injury_status", None),
        "total_points": _num(getattr(player, "total_points", None)),
        "projected_total_points": _num(
            getattr(player, "projected_total_points", None)
            or getattr(player, "projected_points", None)
        ),
        "avg_points": _num(getattr(player, "avg_points", None)),
    }


def serialize_team(team: Any) -> dict[str, Any]:
    roster = [serialize_player(p) for p in (getattr(team, "roster", None) or [])]
    return {
        "team_id": getattr(team, "team_id", None),
        "name": getattr(team, "team_name", None),
        "abbrev": getattr(team, "team_abbrev", None),
        "owners": _owner_names(team),
        "wins": _int(getattr(team, "wins", 0)),
        "losses": _int(getattr(team, "losses", 0)),
        "ties": _int(getattr(team, "ties", 0)),
        "points_for": _num(getattr(team, "points_for", None)),
        "points_against": _num(getattr(team, "points_against", None)),
        "standing": _int(getattr(team, "standing", None) or getattr(team, "final_standing", None)),
        "division": getattr(team, "division_name", None) or "",
        "roster": roster,
    }


def serialize_league(
    league: Any,
    *,
    league_id: str,
    sport: str,
    format: str,
    season: int,
    espn_league_id: int,
) -> dict[str, Any]:
    settings = getattr(league, "settings", None)
    teams = [serialize_team(t) for t in (getattr(league, "teams", None) or [])]
    teams.sort(key=lambda t: (t["standing"] is None, t["standing"] or 999, -(t["points_for"] or 0)))
    return {
        "league_id": league_id,
        "espn_league_id": espn_league_id,
        "sport": sport,
        "format": format,
        "season": season,
        "name": getattr(settings, "name", None) or league_id,
        "team_count": len(teams),
        "current_week": getattr(league, "current_week", None),
        "teams": teams,
        "players": _unique_players(teams),
    }


def _unique_players(teams: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[Any, dict[str, Any]] = {}
    for team in teams:
        for player in team["roster"]:
            key = player["id"] or player["name"]
            if key not in by_id:
                by_id[key] = {**player, "fantasy_team": team["name"]}
    players = list(by_id.values())
    players.sort(key=lambda p: (-(p.get("total_points") or 0), p.get("name") or ""))
    return players


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
