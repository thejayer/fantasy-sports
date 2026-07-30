"""Serialize espn-api league objects into plain JSON-friendly dicts."""

from __future__ import annotations

from datetime import datetime, timezone
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

# ESPN ``statSplitTypeId`` → hub trailing window key (roadmap 8.2 follow-up).
_TRAILING_SPLIT_IDS = {1: "7", 2: "15", 3: "30"}

_PITCHER_SLOTS = {"P", "SP", "RP"}
_PITCHER_POSITIONS = {"P", "SP", "RP"}


def _baseball_stats_map() -> dict[int, str]:
    try:
        from espn_api.baseball.constant import STATS_MAP

        return {int(k): str(v) for k, v in STATS_MAP.items()}
    except ImportError:
        return {}


def _baseball_pro_team_map() -> dict[int, str]:
    try:
        from espn_api.baseball.constant import PRO_TEAM_MAP

        return {int(k): str(v) for k, v in PRO_TEAM_MAP.items()}
    except ImportError:
        return {}


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


def extract_baseball_stat_breakdown(breakdown: Any) -> dict[str, float]:
    """Named counting stats + derived IP from one ESPN stats breakdown dict."""
    if not isinstance(breakdown, dict):
        return {}
    out: dict[str, float] = {}
    for key in _BASEBALL_STAT_KEYS:
        if key in breakdown and breakdown[key] is not None:
            num = _num(breakdown[key])
            if num is not None:
                out[key] = num
    outs = out.get("OUTS")
    if outs is not None:
        out["IP"] = round(outs / 3.0, 1)
    return out


def extract_baseball_season_stats(player: Any) -> dict[str, float]:
    """Pull named season counting stats + derived IP from a baseball Player."""
    bucket = _season_stat_bucket(player)
    return extract_baseball_stat_breakdown(bucket.get("breakdown") or {})


def extract_baseball_trailing_stats(player: Any) -> dict[str, dict[str, float]]:
    """PR7 / PR15 / PR30 windows when present on the player.

    Prefer an attached ``trailing_stats`` map (sample stubs + post-sync
    enricher). espn-api's ``Player`` constructor drops ``statSplitTypeId`` 1/2/3,
    so live sync must attach windows before serialize (or enrich the snapshot).
    """
    attached = getattr(player, "trailing_stats", None)
    if isinstance(attached, dict) and attached:
        out: dict[str, dict[str, float]] = {}
        for key in ("7", "15", "30"):
            raw = attached.get(key) or attached.get(int(key))
            if isinstance(raw, dict):
                # Already extracted (hub shape) or a raw breakdown.
                if any(k in raw for k in _BASEBALL_STAT_KEYS):
                    stats = extract_baseball_stat_breakdown(raw)
                else:
                    stats = extract_baseball_stat_breakdown(raw.get("breakdown") or raw)
                if stats:
                    out[key] = stats
        return out
    return {}


def _player_role(position: str | None, slot: str | None) -> str:
    pos = (position or "").upper()
    sl = (slot or "").upper()
    if sl in _PITCHER_SLOTS or pos in _PITCHER_POSITIONS:
        return "pitcher"
    if sl in {"BE", "IL", "BENCH"} and pos in _PITCHER_POSITIONS:
        return "pitcher"
    return "batter"


def serialize_box_player(player: Any) -> dict[str, Any]:
    """Serialize one espn-api ``BoxPlayer`` (league-applied fantasy points).

    Roadmap 8.1: persist ESPN ``appliedTotal`` as ``points`` — never treat raw
    yards/TDs as the primary score column (Sleeper lesson / golf ``sg.score``).
    """
    return {
        "id": _player_id(player),
        "name": getattr(player, "name", None),
        "position": getattr(player, "position", None),
        "slot": getattr(player, "slot_position", None)
        or getattr(player, "lineupSlot", None),
        "pro_team": getattr(player, "proTeam", None)
        or getattr(player, "pro_team", None),
        "pro_opponent": getattr(player, "pro_opponent", None),
        "on_bye_week": bool(getattr(player, "on_bye_week", False)),
        "points": _num(getattr(player, "points", None)),
        "projected_points": _num(getattr(player, "projected_points", None)),
        "injury_status": getattr(player, "injuryStatus", None)
        or getattr(player, "injury_status", None),
        "game_played": _num(getattr(player, "game_played", None)),
    }


def serialize_box_score(box: Any, *, week: int) -> dict[str, Any]:
    """Serialize one espn-api football ``BoxScore`` into a JSON-friendly dict."""
    home_lineup = [
        serialize_box_player(p) for p in (getattr(box, "home_lineup", None) or [])
    ]
    away_lineup = [
        serialize_box_player(p) for p in (getattr(box, "away_lineup", None) or [])
    ]
    return {
        "home_team_id": _team_id(getattr(box, "home_team", None)),
        "away_team_id": _team_id(getattr(box, "away_team", None)),
        "home_score": _num(getattr(box, "home_score", None)),
        "away_score": _num(getattr(box, "away_score", None)),
        "home_projected": _num(getattr(box, "home_projected", None)),
        "away_projected": _num(getattr(box, "away_projected", None)),
        "is_playoff": bool(getattr(box, "is_playoff", False)),
        "matchup_type": getattr(box, "matchup_type", None) or "NONE",
        "week": int(week),
        "home_lineup": home_lineup,
        "away_lineup": away_lineup,
    }


def build_week_box_scores_document(
    *,
    league_id: str,
    season: int,
    week: int,
    box_scores: list[Any],
    synced_at: str | None = None,
    period_label: str = "week",
) -> dict[str, Any]:
    """Assemble ``weeks/{N}.json`` payload (side concern — not in manifest.files)."""
    when = synced_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "schema_version": 1,
        "league_id": league_id,
        "season": int(season),
        "week": int(week),
        "sport": "football",
        "period_label": period_label,
        "synced_at": when,
        "matchups": [serialize_box_score(box, week=week) for box in box_scores],
    }


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
        trailing = extract_baseball_trailing_stats(player)
        if trailing:
            payload["trailing_stats"] = trailing
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


def serialize_settings(league: Any) -> dict[str, Any]:
    """Persist league settings already loaded via ``mSettings`` (roadmap 2.4).

    No extra ESPN request. Football exposes roster slots / scoring format;
    baseball ``BaseSettings`` omits those — leave them out rather than inventing.
    """
    settings = getattr(league, "settings", None)
    if settings is None:
        return {}

    payload: dict[str, Any] = {
        "scoring_type": getattr(settings, "scoring_type", None),
        "reg_season_count": _int(getattr(settings, "reg_season_count", None)),
        "playoff_team_count": _int(getattr(settings, "playoff_team_count", None)),
        "playoff_matchup_period_length": _int(
            getattr(settings, "playoff_matchup_period_length", None)
        ),
        "playoff_seed_tie_rule": getattr(settings, "playoff_seed_tie_rule", None),
        "playoff_tie_rule": getattr(settings, "playoff_tie_rule", None),
        "tie_rule": getattr(settings, "tie_rule", None),
        "keeper_count": _int(getattr(settings, "keeper_count", None)) or 0,
        "faab": bool(getattr(settings, "faab", False)),
        "acquisition_budget": _int(getattr(settings, "acquisition_budget", None)),
        "veto_votes_required": _int(getattr(settings, "veto_votes_required", None)),
        "trade_deadline": _int(getattr(settings, "trade_deadline", None)),
        "team_count": _int(getattr(settings, "team_count", None)),
        "median_scoring": bool(getattr(settings, "median_scoring", False)),
    }
    division_map = getattr(settings, "division_map", None)
    if isinstance(division_map, dict) and division_map:
        payload["division_map"] = {str(k): v for k, v in division_map.items()}
    slot_counts = getattr(settings, "position_slot_counts", None)
    if isinstance(slot_counts, dict) and slot_counts:
        payload["position_slot_counts"] = {
            str(k): _int(v) for k, v in slot_counts.items() if _int(v) is not None
        }
    scoring_format = getattr(settings, "scoring_format", None)
    if scoring_format:
        payload["scoring_format"] = _serialize_scoring_format(scoring_format)
    categories = extract_baseball_scoring_categories(settings)
    if categories:
        payload["categories"] = categories
    matchup_periods = getattr(settings, "matchup_periods", None)
    if isinstance(matchup_periods, dict) and matchup_periods:
        payload["matchup_periods"] = {
            str(k): list(v) if isinstance(v, (list, tuple)) else v
            for k, v in matchup_periods.items()
        }
    return payload


def extract_baseball_scoring_categories(settings: Any) -> list[dict[str, Any]]:
    """Official H2H-cat list from ESPN ``scoringItems`` (or sample stubs)."""
    if settings is None:
        return []
    raw = getattr(settings, "_raw_scoring_settings", None) or {}
    items = raw.get("scoringItems") if isinstance(raw, dict) else None
    stats_map = _baseball_stats_map()
    rows: list[dict[str, Any]] = []
    if isinstance(items, list) and items:
        for item in items:
            if not isinstance(item, dict):
                continue
            sid = _int(item.get("statId"))
            if sid is None:
                continue
            abbr = stats_map.get(sid) or str(item.get("statCode") or sid)
            known_rates = {"AVG", "ERA", "WHIP", "OBP", "OPS"}
            # Skip obscure ids unless named in our whitelist or STATS_MAP.
            if (
                abbr not in _BASEBALL_STAT_KEYS
                and abbr not in known_rates
                and sid not in stats_map
            ):
                continue
            rows.append(
                {
                    "id": sid,
                    "abbr": abbr,
                    "label": str(item.get("statName") or abbr),
                    "points": _num(item.get("points")),
                }
            )
    if rows:
        return rows
    # Sample / football-shaped stubs may already set scoring_format categories.
    scoring_format = getattr(settings, "scoring_format", None)
    if scoring_format and getattr(settings, "scoring_type", None) == "H2H_CATEGORY":
        return _serialize_scoring_format(scoring_format)
    return []


def serialize_activity(activity: Any) -> dict[str, Any]:
    """Normalize football (4-tuple) and baseball (3-tuple) activity actions."""
    actions: list[dict[str, Any]] = []
    for item in getattr(activity, "actions", None) or []:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        team = item[0] if len(item) > 0 else None
        action = item[1] if len(item) > 1 else "UNKNOWN"
        player = item[2] if len(item) > 2 else None
        bid = item[3] if len(item) > 3 else 0
        actions.append(
            {
                "team_id": _team_id(team) if team not in ("", None) else None,
                "action": str(action or "UNKNOWN"),
                "player_id": _player_id(player),
                "player_name": _player_name(player),
                "bid_amount": _num(bid) or 0.0,
            }
        )
    return {
        "date": getattr(activity, "date", None),
        "actions": actions,
    }


def serialize_transactions(activities: list[Any] | None) -> list[dict[str, Any]]:
    return [serialize_activity(activity) for activity in (activities or [])]


def serialize_free_agent(player: Any, *, sport: str | None = None) -> dict[str, Any]:
    """Compact FA row — skip season_stats bloat; keep trailing windows for 8.2."""
    payload = serialize_player(player, sport=None)
    if sport == "baseball":
        trailing = extract_baseball_trailing_stats(player)
        if trailing:
            payload["trailing_stats"] = trailing
            payload["role"] = _player_role(
                payload.get("position"), payload.get("slot")
            )
    return payload


def serialize_free_agents(
    players: list[Any] | None, *, sport: str | None = None
) -> list[dict[str, Any]]:
    rows = [
        serialize_free_agent(player, sport=sport) for player in (players or [])
    ]
    rows.sort(
        key=lambda row: (
            -(row.get("percent_owned") or 0.0),
            row.get("name") or "",
        )
    )
    return rows


def serialize_league(
    league: Any,
    *,
    league_id: str,
    sport: str,
    format: str,
    season: int,
    espn_league_id: int,
    transactions: list[Any] | None = None,
    free_agents: list[Any] | None = None,
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
        "settings": serialize_settings(league),
        "draft": serialize_draft(league),
        "transactions": serialize_transactions(transactions),
        "free_agents": serialize_free_agents(free_agents, sport=sport),
        "teams": teams,
        "players": _unique_players(teams),
    }


def build_pro_schedule_document(
    *,
    league_id: str,
    season: int,
    sport: str,
    games: list[dict[str, Any]],
    matchup_periods: dict[str, Any] | None = None,
    synced_at: str | None = None,
) -> dict[str, Any]:
    """Side concern ``pro_schedule.json`` (roadmap 8.2) — not in manifest.files."""
    return {
        "schema_version": 1,
        "league_id": league_id,
        "season": season,
        "sport": sport,
        "synced_at": synced_at,
        "matchup_periods": matchup_periods or {},
        "games": games,
    }


def serialize_category_box_score(box: Any) -> dict[str, Any]:
    """Serialize baseball ``H2HCategoryBoxScore`` home/away cat matrices."""
    def _side_stats(raw: Any) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if not isinstance(raw, dict):
            return out
        for key, payload in raw.items():
            if not isinstance(payload, dict):
                continue
            out[str(key)] = {
                "value": _num(payload.get("value") or payload.get("score")),
                "result": payload.get("result"),
            }
        return out

    return {
        "home_team_id": _team_id(getattr(box, "home_team", None)),
        "away_team_id": _team_id(getattr(box, "away_team", None)),
        "home_wins": _int(getattr(box, "home_wins", None)),
        "home_losses": _int(getattr(box, "home_losses", None)),
        "home_ties": _int(getattr(box, "home_ties", None)),
        "away_wins": _int(getattr(box, "away_wins", None)),
        "away_losses": _int(getattr(box, "away_losses", None)),
        "away_ties": _int(getattr(box, "away_ties", None)),
        "home_stats": _side_stats(getattr(box, "home_stats", None)),
        "away_stats": _side_stats(getattr(box, "away_stats", None)),
    }


def build_week_category_document(
    *,
    league_id: str,
    season: int,
    week: int,
    box_scores: list[Any],
    synced_at: str | None = None,
    period_label: str = "period",
) -> dict[str, Any]:
    """Baseball period category boxes under ``weeks/{N}.json`` (sport=baseball)."""
    return {
        "schema_version": 1,
        "league_id": league_id,
        "season": season,
        "week": week,
        "sport": "baseball",
        "period_label": period_label,
        "synced_at": synced_at,
        "matchups": [serialize_category_box_score(box) for box in box_scores],
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


def _player_id(player: Any) -> int | None:
    if player is None or player == "":
        return None
    if isinstance(player, bool):
        return None
    if isinstance(player, int):
        return player
    pid = getattr(player, "playerId", None) or getattr(player, "player_id", None)
    if pid is not None:
        return _int(pid)
    return _int(player)


def _player_name(player: Any) -> str | None:
    if player is None or player == "":
        return None
    name = getattr(player, "name", None)
    if name:
        return str(name)
    if isinstance(player, str) and not player.isdigit():
        return player
    # Baseball activity often stores the display name in player_map as a str.
    if isinstance(player, str):
        return player
    return None


def _serialize_scoring_format(scoring_format: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in scoring_format:
        if isinstance(item, dict):
            rows.append(
                {
                    "id": item.get("id"),
                    "abbr": item.get("abbr") or item.get("statCode"),
                    "label": item.get("label") or item.get("statName"),
                    "points": _num(item.get("points") or item.get("pointsOverride")),
                }
            )
            continue
        rows.append(
            {
                "id": getattr(item, "id", None),
                "abbr": getattr(item, "abbr", None),
                "label": getattr(item, "label", None),
                "points": _num(getattr(item, "points", None)),
            }
        )
    return rows
