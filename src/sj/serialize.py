"""Serialize espn-api league objects into plain JSON-friendly dicts."""

from __future__ import annotations

from typing import Any

# Core counting stats we surface for baseball dynasty views.
_BASEBALL_STAT_KEYS = (
    "AB",
    "H",
    "R",
    "HR",
    "RBI",
    "SB",
    "AVG",
    "OBP",
    "OPS",
    "W",
    "L",
    "SV",
    "HLD",
    "QS",
    "K",
    "ERA",
    "WHIP",
    "OUTS",
)

_PITCHER_SLOTS = {"P", "SP", "RP"}
_PITCHER_POSITIONS = {"P", "SP", "RP"}


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


def _season_stat_bucket(player: Any) -> dict[str, Any]:
    """Return the season (scoringPeriodId 0) stats dict from an espn-api Player."""
    stats = getattr(player, "stats", None) or {}
    bucket = stats.get(0) or stats.get("0") or {}
    return bucket if isinstance(bucket, dict) else {}


def extract_baseball_season_stats(player: Any) -> dict[str, float]:
    """Pull named season counting stats + derived IP from a baseball Player."""
    bucket = _season_stat_bucket(player)
    breakdown = bucket.get("breakdown") or {}
    out: dict[str, float] = {}
    for key in _BASEBALL_STAT_KEYS:
        if key in breakdown and breakdown[key] is not None:
            num = _num(breakdown[key])
            if num is not None:
                out[key] = num
    outs = out.get("OUTS")
    if outs is not None:
        # ESPN stores outs; fantasy UIs usually show innings pitched.
        out["IP"] = round(outs / 3.0, 1)
    return out


def _player_role(position: str | None, slot: str | None) -> str:
    pos = (position or "").upper()
    sl = (slot or "").upper()
    if sl in _PITCHER_SLOTS or pos in _PITCHER_POSITIONS:
        return "pitcher"
    if sl in {"BE", "IL", "BENCH"} and pos in _PITCHER_POSITIONS:
        return "pitcher"
    return "batter"


def serialize_player(player: Any, *, sport: str | None = None) -> dict[str, Any]:
    position = getattr(player, "position", None)
    slot = getattr(player, "lineupSlot", None) or getattr(player, "slot_position", None)
    payload: dict[str, Any] = {
        "id": getattr(player, "playerId", None) or getattr(player, "player_id", None),
        "name": getattr(player, "name", None),
        "position": position,
        "slot": slot,
        "pro_team": getattr(player, "proTeam", None) or getattr(player, "pro_team", None),
        "injury_status": getattr(player, "injuryStatus", None)
        or getattr(player, "injury_status", None),
        "status": getattr(player, "status", None),
        "injured": bool(getattr(player, "injured", False)),
        "eligible_slots": list(getattr(player, "eligibleSlots", None) or []),
        "acquisition_type": getattr(player, "acquisitionType", None),
        "percent_owned": _num(getattr(player, "percent_owned", None)),
        "total_points": _num(getattr(player, "total_points", None)),
        "projected_total_points": _num(
            getattr(player, "projected_total_points", None)
            or getattr(player, "projected_points", None)
        ),
        "avg_points": _num(getattr(player, "avg_points", None)),
    }
    if sport == "baseball":
        season_stats = extract_baseball_season_stats(player)
        payload["season_stats"] = season_stats
        payload["role"] = _player_role(position, slot)
    return payload


def serialize_draft_pick(pick: Any) -> dict[str, Any]:
    """Serialize one espn-api ``BasePick`` (or stub) into a JSON-friendly dict."""
    bid = _num(getattr(pick, "bid_amount", None))
    return {
        "round": _int(getattr(pick, "round_num", None)),
        "round_pick": _int(getattr(pick, "round_pick", None)),
        "team_id": _team_id(getattr(pick, "team", None)),
        "player_id": _int(
            getattr(pick, "playerId", None) or getattr(pick, "player_id", None)
        ),
        "player_name": getattr(pick, "playerName", None)
        or getattr(pick, "player_name", None),
        "bid_amount": 0.0 if bid is None else bid,
        "keeper": bool(getattr(pick, "keeper_status", False)),
        "nominating_team_id": _team_id(getattr(pick, "nominatingTeam", None)),
    }


def serialize_draft(league: Any) -> list[dict[str, Any]]:
    """Persist ``league.draft`` — already fetched via ``mDraftDetail``, never kept."""
    return [serialize_draft_pick(pick) for pick in (getattr(league, "draft", None) or [])]


def serialize_team(team: Any, *, sport: str | None = None) -> dict[str, Any]:
    roster = [serialize_player(p, sport=sport) for p in (getattr(team, "roster", None) or [])]
    wins = _int(getattr(team, "wins", 0)) or 0
    losses = _int(getattr(team, "losses", 0)) or 0
    ties = _int(getattr(team, "ties", 0)) or 0
    games = wins + losses + ties
    win_pct = round((wins + 0.5 * ties) / games, 3) if games else None
    points_for = _num(getattr(team, "points_for", None))
    # Baseball H2H often has no points_for on the Team object — fall back to roster totals.
    if points_for is None and roster:
        roster_points = [p.get("total_points") for p in roster if p.get("total_points") is not None]
        if roster_points:
            points_for = round(sum(roster_points), 1)
    schedule, scores, outcomes = _team_matchup_arrays(team)
    return {
        "team_id": getattr(team, "team_id", None),
        "name": getattr(team, "team_name", None),
        "abbrev": getattr(team, "team_abbrev", None),
        "owners": _owner_names(team),
        "logo_url": getattr(team, "logo_url", None) or None,
        "wins": wins,
        "losses": losses,
        "ties": ties,
        "win_pct": win_pct,
        "points_for": points_for,
        "points_against": _num(getattr(team, "points_against", None)),
        "standing": _int(getattr(team, "standing", None) or getattr(team, "final_standing", None)),
        "division": getattr(team, "division_name", None) or "",
        # Parallel arrays already populated by espn-api's mMatchup fetch
        # (football) or normalized from Matchup objects (baseball). Index i is
        # period i+1. schedule[i] is the opponent team_id (bye → self).
        "schedule": schedule,
        "scores": scores,
        "outcomes": outcomes,
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
    teams = [serialize_team(t, sport=sport) for t in (getattr(league, "teams", None) or [])]
    teams.sort(
        key=lambda t: (
            t["standing"] is None,
            t["standing"] or 999,
            -(t["win_pct"] or 0),
            -(t["points_for"] or 0),
        )
    )
    scoring_type = getattr(settings, "scoring_type", None) or getattr(
        league, "scoring_type", None
    )
    return {
        "league_id": league_id,
        "espn_league_id": espn_league_id,
        "sport": sport,
        "format": format,
        "season": season,
        "name": getattr(settings, "name", None) or league_id,
        "scoring_type": scoring_type,
        "team_count": len(teams),
        "current_week": getattr(league, "current_week", None)
        or getattr(league, "scoringPeriodId", None)
        or getattr(league, "current_matchday", None),
        "period_label": "period" if sport == "baseball" else "week",
        "draft": serialize_draft(league),
        "teams": teams,
        "players": _unique_players(teams),
    }


def _team_id(value: Any) -> int | None:
    """Resolve a team id from an int, Team object, or None."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    tid = getattr(value, "team_id", None)
    if tid is not None:
        return _int(tid)
    return _int(value)


def _team_matchup_arrays(
    team: Any,
) -> tuple[list[int | None], list[float | None], list[str]]:
    """Return (schedule, scores, outcomes) for one team.

    Football teams already carry parallel lists (opponent ids / Team objects,
    fantasy points, ``W|L|T|U``). Baseball teams carry ``Matchup`` objects;
    those are normalized into the same parallel shape so the hub can share UI.
    Seed stubs use the football-shaped lists for both sports.
    """
    schedule_raw = list(getattr(team, "schedule", None) or [])
    if schedule_raw and _looks_like_matchup(schedule_raw[0]):
        return _matchup_objects_to_arrays(team)

    schedule = [_team_id(item) for item in schedule_raw]
    scores = [_num(item) for item in (getattr(team, "scores", None) or [])]
    outcomes = [
        _normalize_outcome(item) for item in (getattr(team, "outcomes", None) or [])
    ]
    return schedule, scores, outcomes


def _looks_like_matchup(item: Any) -> bool:
    return hasattr(item, "home_final_score") or (
        hasattr(item, "home_team") and hasattr(item, "away_team") and hasattr(item, "winner")
    )


def _matchup_objects_to_arrays(
    team: Any,
) -> tuple[list[int | None], list[float | None], list[str]]:
    self_id = _team_id(getattr(team, "team_id", None))
    schedule: list[int | None] = []
    scores: list[float | None] = []
    outcomes: list[str] = []
    for match in getattr(team, "schedule", None) or []:
        home_id = _team_id(getattr(match, "home_team", None))
        away_id = _team_id(getattr(match, "away_team", None))
        home_score = _num(getattr(match, "home_final_score", None))
        away_score = _num(getattr(match, "away_final_score", None))
        # Category leagues expose category-win totals on the live-score fields.
        home_live = _num(getattr(match, "home_team_live_score", None))
        away_live = _num(getattr(match, "away_team_live_score", None))
        if home_live is not None and away_live is not None:
            home_score, away_score = home_live, away_live
        winner = getattr(match, "winner", None)

        if self_id is not None and self_id == home_id:
            schedule.append(away_id)
            scores.append(home_score)
            outcomes.append(_outcome_from_winner(winner, is_home=True))
        elif self_id is not None and self_id == away_id:
            schedule.append(home_id)
            scores.append(away_score)
            outcomes.append(_outcome_from_winner(winner, is_home=False))
    return schedule, scores, outcomes


def _outcome_from_winner(winner: Any, *, is_home: bool) -> str:
    label = str(winner or "").upper()
    if label in {"TIE", "T"}:
        return "T"
    if label in {"UNDECIDED", "U", ""}:
        return "U"
    if label == "HOME":
        return "W" if is_home else "L"
    if label == "AWAY":
        return "L" if is_home else "W"
    return _normalize_outcome(label)


def _normalize_outcome(value: Any) -> str:
    label = str(value or "U").upper()
    if label in {"W", "L", "T", "U"}:
        return label
    return "U"


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
