"""Baseball follow-up enrichers for roadmap 8.2 (trailing splits + pro schedule).

espn-api's ``Player`` drops ``statSplitTypeId`` 1/2/3, so Hot Streaks need a
``get_player_card`` pass. Pro schedules come from ``proTeamSchedules_wl``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sj.serialize import (
    _TRAILING_SPLIT_IDS,
    _baseball_pro_team_map,
    _baseball_stats_map,
    build_pro_schedule_document,
    build_week_category_document,
    extract_baseball_stat_breakdown,
)
from sj.store import write_pro_schedule, write_week_box_scores

_PLAYER_CARD_BATCH = 40
_BOX_SCORE_MIN_SEASON = 2019


def _iso_from_ms(ms: Any) -> str | None:
    try:
        value = int(ms)
    except (TypeError, ValueError):
        return None
    if value > 10_000_000_000:  # ms
        value = value / 1000.0
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()


def _breakdown_from_raw_stats(stats_entry: dict[str, Any]) -> dict[str, float]:
    stats_map = _baseball_stats_map()
    raw = stats_entry.get("stats") or stats_entry.get("appliedStats") or {}
    named: dict[str, Any] = {}
    if isinstance(raw, dict):
        for key, value in raw.items():
            try:
                sid = int(key)
            except (TypeError, ValueError):
                named[str(key)] = value
                continue
            named[stats_map.get(sid, str(sid))] = value
    return extract_baseball_stat_breakdown(named)


def parse_trailing_from_player_card(players_payload: list[Any]) -> dict[int, dict[str, dict[str, float]]]:
    """Map espn player id → ``{"7": stats, "15": …, "30": …}``."""
    out: dict[int, dict[str, dict[str, float]]] = {}
    for row in players_payload:
        if not isinstance(row, dict):
            continue
        player = row.get("player") or row.get("playerPoolEntry", {}).get("player") or row
        if not isinstance(player, dict):
            continue
        try:
            pid = int(player.get("id"))
        except (TypeError, ValueError):
            continue
        windows: dict[str, dict[str, float]] = {}
        for stats in player.get("stats") or []:
            if not isinstance(stats, dict):
                continue
            split = stats.get("statSplitTypeId")
            key = _TRAILING_SPLIT_IDS.get(split)
            if not key:
                continue
            extracted = _breakdown_from_raw_stats(stats)
            if extracted:
                windows[key] = extracted
        if windows:
            out[pid] = windows
    return out


def fetch_trailing_stats_for_ids(
    league: Any, player_ids: list[int]
) -> dict[int, dict[str, dict[str, float]]]:
    """Batch ``get_player_card`` with L7/L15/L30 filters."""
    request = getattr(league, "espn_request", None)
    if request is None or not callable(getattr(request, "get_player_card", None)):
        return {}
    year = int(getattr(league, "year", 0) or 0)
    if not year:
        return {}
    max_period = int(
        getattr(league, "finalScoringPeriod", None)
        or getattr(league, "current_week", None)
        or 200
    )
    filters = [f"01{year}", f"02{year}", f"03{year}"]
    merged: dict[int, dict[str, dict[str, float]]] = {}
    for start in range(0, len(player_ids), _PLAYER_CARD_BATCH):
        batch = player_ids[start : start + _PLAYER_CARD_BATCH]
        if not batch:
            continue

        def _call(ids: list[int] = batch) -> Any:
            return request.get_player_card(
                ids, max_period, additional_filters=filters
            )

        try:
            from sj.sync import espn_call

            data = espn_call(_call, label=f"player_card:{len(batch)}")
        except Exception:  # noqa: BLE001,S112 — card filters vary by season; skip batch
            continue
        players = []
        if isinstance(data, dict):
            players = data.get("players") or []
        elif isinstance(data, list):
            players = data
        merged.update(parse_trailing_from_player_card(list(players)))
    return merged


def apply_trailing_stats_to_snapshot(
    snapshot: dict[str, Any],
    trailing_by_id: dict[int, dict[str, dict[str, float]]],
) -> int:
    """Mutate roster / players / FA rows in place. Returns rows updated."""
    if not trailing_by_id:
        return 0
    updated = 0

    def _touch(row: dict[str, Any]) -> None:
        nonlocal updated
        try:
            pid = int(row.get("id"))
        except (TypeError, ValueError):
            return
        windows = trailing_by_id.get(pid)
        if not windows:
            return
        row["trailing_stats"] = windows
        updated += 1

    for team in snapshot.get("teams") or []:
        for player in team.get("roster") or []:
            if isinstance(player, dict):
                _touch(player)
    for player in snapshot.get("players") or []:
        if isinstance(player, dict):
            _touch(player)
    for player in snapshot.get("free_agents") or []:
        if isinstance(player, dict):
            _touch(player)
    return updated


def enrich_baseball_trailing_stats(league: Any, snapshot: dict[str, Any]) -> int:
    ids: list[int] = []
    seen: set[int] = set()
    for team in snapshot.get("teams") or []:
        for player in team.get("roster") or []:
            try:
                pid = int(player.get("id"))
            except (TypeError, ValueError, AttributeError):
                continue
            if pid not in seen:
                seen.add(pid)
                ids.append(pid)
    for player in snapshot.get("free_agents") or []:
        try:
            pid = int(player.get("id"))
        except (TypeError, ValueError, AttributeError):
            continue
        if pid not in seen:
            seen.add(pid)
            ids.append(pid)
    trailing = fetch_trailing_stats_for_ids(league, ids)
    return apply_trailing_stats_to_snapshot(snapshot, trailing)


def build_pro_schedule_from_league(
    league: Any,
    *,
    league_id: str,
    season: int,
    synced_at: str | None = None,
) -> dict[str, Any] | None:
    """Flatten ``proGamesByScoringPeriod`` into a hub-friendly game list."""
    if not callable(getattr(league, "_get_all_pro_schedule", None)):
        return None
    try:
        from sj.sync import espn_call

        raw = espn_call(
            lambda: league._get_all_pro_schedule(),
            label="pro_schedule",
        )
    except Exception:  # noqa: BLE001 — schedule view optional on old seasons
        return None
    if not isinstance(raw, dict):
        return None
    team_map = _baseball_pro_team_map()
    games: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for team_id, periods in raw.items():
        if not isinstance(periods, dict):
            continue
        try:
            pro_id = int(team_id)
        except (TypeError, ValueError):
            continue
        if pro_id == 0:
            continue
        for period_key, period_games in periods.items():
            try:
                scoring_period = int(period_key)
            except (TypeError, ValueError):
                continue
            if not isinstance(period_games, list):
                continue
            for game in period_games:
                if not isinstance(game, dict):
                    continue
                home_id = game.get("homeProTeamId")
                away_id = game.get("awayProTeamId")
                date_ms = game.get("date")
                key = (scoring_period, home_id, away_id, date_ms)
                if key in seen:
                    continue
                seen.add(key)
                home = team_map.get(int(home_id), str(home_id)) if home_id is not None else None
                away = team_map.get(int(away_id), str(away_id)) if away_id is not None else None
                games.append(
                    {
                        "scoring_period_id": scoring_period,
                        "home_pro_team": home,
                        "away_pro_team": away,
                        "home_pro_team_id": home_id,
                        "away_pro_team_id": away_id,
                        "start_time": _iso_from_ms(date_ms),
                    }
                )
    games.sort(
        key=lambda g: (
            g.get("scoring_period_id") or 0,
            g.get("start_time") or "",
            g.get("home_pro_team") or "",
        )
    )
    settings = getattr(league, "settings", None)
    matchup_periods = getattr(settings, "matchup_periods", None) if settings else None
    return build_pro_schedule_document(
        league_id=league_id,
        season=season,
        sport="baseball",
        games=games,
        matchup_periods=matchup_periods if isinstance(matchup_periods, dict) else {},
        synced_at=synced_at,
    )


def sync_baseball_pro_schedule(
    league: Any,
    spec: Any,
    season: int,
    snapshot: dict[str, Any],
    store_dir: Any = None,
) -> bool:
    if getattr(spec, "sport", None) != "baseball":
        return False
    doc = build_pro_schedule_from_league(
        league,
        league_id=spec.id,
        season=season,
        synced_at=snapshot.get("synced_at")
        if isinstance(snapshot.get("synced_at"), str)
        else None,
    )
    if not doc or not doc.get("games"):
        return False
    write_pro_schedule(doc, store_dir=store_dir)
    return True


def sync_baseball_category_boxes(
    league: Any,
    spec: Any,
    season: int,
    snapshot: dict[str, Any],
    store_dir: Any = None,
) -> int:
    """Write baseball ``weeks/{N}.json`` category matrices (no lineups)."""
    if getattr(spec, "sport", None) != "baseball":
        return 0
    if season < _BOX_SCORE_MIN_SEASON:
        return 0
    if not callable(getattr(league, "box_scores", None)):
        return 0
    current = int(snapshot.get("current_week") or 0)
    if current < 1:
        return 0
    from sj.sync import box_score_max_weeks, espn_call

    last = min(current, box_score_max_weeks())
    written = 0
    synced_at = snapshot.get("synced_at")
    for week in range(1, last + 1):
        try:

            def _call(period: int = week) -> Any:
                return league.box_scores(matchup_period=period, scoring_period=period)

            boxes = list(espn_call(_call, label=f"bb_box_scores:p{week}") or [])
        except Exception as exc:  # noqa: BLE001 — skip missing periods
            msg = str(exc).lower()
            if "before 2019" in msg or "cant retrieve" in msg:
                break
            continue
        if not boxes:
            continue
        # Only persist when at least one box exposes category stats.
        if not any(hasattr(b, "home_stats") for b in boxes):
            continue
        doc = build_week_category_document(
            league_id=spec.id,
            season=season,
            week=week,
            box_scores=boxes,
            synced_at=synced_at if isinstance(synced_at, str) else None,
            period_label=str(snapshot.get("period_label") or "period"),
        )
        write_week_box_scores(doc, store_dir=store_dir)
        written += 1
    return written
