"""Baseball follow-up enrichers for roadmap 8.2.

espn-api's ``Player`` drops ``statSplitTypeId`` 1/2/3, so Hot Streaks need a
``get_player_card`` pass. Pro schedules come from ``proTeamSchedules_wl``.
Two-start pitchers use the public ESPN site scoreboard ``probables`` feed.
Period pitcher IP is parsed from raw ``rosterForCurrentScoringPeriod`` when
present (H2HCategoryBoxScore ignores lineups). Season GS caps come from
``rosterSettings.lineupSlotStatLimits``.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
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
_SITE_SCOREBOARD = (
    "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard"
)
_SITE_UA = "sj-baseball-enrich/1"


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


def attach_baseball_roster_limits(league: Any) -> bool:
    """Stash ``_raw_roster_settings`` on league.settings for GS / slot caps."""
    settings = getattr(league, "settings", None)
    if settings is None:
        return False
    if getattr(settings, "_raw_roster_settings", None):
        return True
    request = getattr(league, "espn_request", None)
    if request is None or not callable(getattr(request, "get_league", None)):
        return False
    try:
        from sj.sync import espn_call

        data = espn_call(lambda: request.get_league(), label="roster_settings")
    except Exception:  # noqa: BLE001 — optional caps
        return False
    if not isinstance(data, dict):
        return False
    roster = (data.get("settings") or {}).get("rosterSettings") or {}
    if not isinstance(roster, dict):
        return False
    settings._raw_roster_settings = roster
    return True


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


def _yyyymmdd(iso: str) -> str | None:
    try:
        day = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return day.strftime("%Y%m%d")


def _probable_athlete(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    athlete = raw.get("athlete") if isinstance(raw.get("athlete"), dict) else raw
    if not isinstance(athlete, dict):
        return None
    pid = athlete.get("id")
    name = athlete.get("displayName") or athlete.get("fullName") or athlete.get("name")
    if pid is None or not name:
        return None
    try:
        return {"id": int(pid), "name": str(name)}
    except (TypeError, ValueError):
        return {"id": str(pid), "name": str(name)}


def parse_site_scoreboard_probables(
    payload: dict[str, Any],
) -> dict[tuple[str, str, str], dict[str, dict[str, Any] | None]]:
    """Map ``(away, home, YYYY-MM-DD)`` → probable sides from site scoreboard."""
    out: dict[tuple[str, str, str], dict[str, dict[str, Any] | None]] = {}
    for event in payload.get("events") or []:
        if not isinstance(event, dict):
            continue
        competitions = event.get("competitions") or []
        if not competitions or not isinstance(competitions[0], dict):
            continue
        comp = competitions[0]
        date_raw = comp.get("date") or event.get("date")
        if not isinstance(date_raw, str) or len(date_raw) < 10:
            continue
        day = date_raw[:10]
        home: dict[str, Any] | None = None
        away: dict[str, Any] | None = None
        home_abbr = away_abbr = None
        for competitor in comp.get("competitors") or []:
            if not isinstance(competitor, dict):
                continue
            team = competitor.get("team") or {}
            abbr = str(team.get("abbreviation") or "").upper() or None
            probs = competitor.get("probables") or []
            athlete = _probable_athlete(probs[0]) if probs else None
            side = str(competitor.get("homeAway") or "").lower()
            if side == "home":
                home_abbr, home = abbr, athlete
            elif side == "away":
                away_abbr, away = abbr, athlete
        if home_abbr and away_abbr:
            out[(away_abbr, home_abbr, day)] = {
                "probable_away": away,
                "probable_home": home,
            }
    return out


def fetch_mlb_site_scoreboard(date_yyyymmdd: str, *, timeout: float = 15.0) -> dict[str, Any]:
    """Public ESPN site API — no fantasy cookies required."""
    url = f"{_SITE_SCOREBOARD}?dates={date_yyyymmdd}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": _SITE_UA, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def enrich_pro_schedule_with_probables(
    doc: dict[str, Any],
    *,
    fetch_day=None,
) -> int:
    """Attach ``probable_home`` / ``probable_away`` onto games. Returns games tagged."""
    games = doc.get("games") or []
    if not isinstance(games, list) or not games:
        return 0
    dates: list[str] = []
    seen_dates: set[str] = set()
    for game in games:
        if not isinstance(game, dict):
            continue
        start = game.get("start_time")
        if not isinstance(start, str):
            continue
        ymd = _yyyymmdd(start)
        if ymd and ymd not in seen_dates:
            seen_dates.add(ymd)
            dates.append(ymd)
    if not dates:
        return 0

    fetch = fetch_day or fetch_mlb_site_scoreboard
    by_matchup: dict[tuple[str, str, str], dict[str, dict[str, Any] | None]] = {}
    for ymd in dates:
        try:
            payload = fetch(ymd)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            continue
        if isinstance(payload, dict):
            by_matchup.update(parse_site_scoreboard_probables(payload))

    tagged = 0
    for game in games:
        if not isinstance(game, dict):
            continue
        start = game.get("start_time")
        if not isinstance(start, str):
            continue
        try:
            day = datetime.fromisoformat(start.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            continue
        away = str(game.get("away_pro_team") or "").upper()
        home = str(game.get("home_pro_team") or "").upper()
        hit = by_matchup.get((away, home, day))
        if not hit:
            continue
        if hit.get("probable_away"):
            game["probable_away"] = hit["probable_away"]
        if hit.get("probable_home"):
            game["probable_home"] = hit["probable_home"]
        if hit.get("probable_away") or hit.get("probable_home"):
            tagged += 1
    return tagged


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
    enrich_pro_schedule_with_probables(doc)
    write_pro_schedule(doc, store_dir=store_dir)
    return True


def parse_pitcher_ip_from_raw_schedule(
    schedule: list[Any],
    *,
    scoring_period: int,
) -> list[dict[str, Any]]:
    """Period pitcher outs/IP from ``rosterForCurrentScoringPeriod`` entries."""
    stats_map = _baseball_stats_map()
    rows: list[dict[str, Any]] = []
    for matchup in schedule:
        if not isinstance(matchup, dict):
            continue
        for side in ("home", "away"):
            team_data = matchup.get(side)
            if not isinstance(team_data, dict):
                continue
            try:
                team_id = int(team_data.get("teamId"))
            except (TypeError, ValueError):
                continue
            entries = (
                team_data.get("rosterForCurrentScoringPeriod") or {}
            ).get("entries") or []
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                pool = entry.get("playerPoolEntry") or {}
                player = pool.get("player") if isinstance(pool, dict) else None
                if not isinstance(player, dict):
                    player = entry.get("player") if isinstance(entry.get("player"), dict) else None
                if not isinstance(player, dict):
                    continue
                try:
                    pid = int(player.get("id"))
                except (TypeError, ValueError):
                    continue
                name = (
                    player.get("fullName")
                    or player.get("name")
                    or f"Player {pid}"
                )
                breakdown: dict[str, Any] = {}
                for stats in player.get("stats") or []:
                    if not isinstance(stats, dict):
                        continue
                    if stats.get("scoringPeriodId") != scoring_period:
                        continue
                    # Prefer actual (statSourceId 0) over projected.
                    if stats.get("statSourceId") not in (None, 0):
                        continue
                    raw = stats.get("stats") or stats.get("appliedStats") or {}
                    if isinstance(raw, dict):
                        for key, value in raw.items():
                            try:
                                sid = int(key)
                            except (TypeError, ValueError):
                                breakdown[str(key)] = value
                            else:
                                breakdown[stats_map.get(sid, str(sid))] = value
                extracted = extract_baseball_stat_breakdown(breakdown)
                outs = extracted.get("OUTS")
                ip = extracted.get("IP")
                if outs is None and ip is None:
                    continue
                if outs is None and ip is not None:
                    outs = ip * 3
                if ip is None and outs is not None:
                    ip = round(outs / 3.0, 1)
                rows.append(
                    {
                        "player_id": pid,
                        "name": str(name),
                        "team_id": team_id,
                        "outs": outs,
                        "ip": ip,
                    }
                )
    rows.sort(key=lambda r: (-(r.get("ip") or 0), r.get("name") or ""))
    return rows


def sync_baseball_category_boxes(
    league: Any,
    spec: Any,
    season: int,
    snapshot: dict[str, Any],
    store_dir: Any = None,
) -> int:
    """Write baseball ``weeks/{N}.json`` category matrices (+ period IP when present)."""
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
    request = getattr(league, "espn_request", None)
    for week in range(1, last + 1):
        boxes: list[Any] = []
        pitcher_ip: list[dict[str, Any]] = []
        try:

            def _call(period: int = week) -> Any:
                return league.box_scores(matchup_period=period, scoring_period=period)

            boxes = list(espn_call(_call, label=f"bb_box_scores:p{week}") or [])
        except Exception as exc:  # noqa: BLE001 — skip missing periods
            msg = str(exc).lower()
            if "before 2019" in msg or "cant retrieve" in msg:
                break
            continue

        # Raw schedule still carries rosterForCurrentScoringPeriod for IP.
        if request is not None and callable(getattr(request, "league_get", None)):
            try:
                import json as _json

                params = {
                    "view": ["mMatchupScore", "mScoreboard"],
                    "scoringPeriodId": week,
                }
                filters = {"schedule": {"filterMatchupPeriodIds": {"value": [week]}}}
                headers = {"x-fantasy-filter": _json.dumps(filters)}

                def _raw(
                    p: dict[str, Any] = params,
                    h: dict[str, str] = headers,
                ) -> Any:
                    return request.league_get(params=p, headers=h)

                raw = espn_call(_raw, label=f"bb_period_roster:p{week}")
                schedule = raw.get("schedule") if isinstance(raw, dict) else None
                if isinstance(schedule, list):
                    pitcher_ip = parse_pitcher_ip_from_raw_schedule(
                        schedule, scoring_period=week
                    )
            except Exception:  # noqa: BLE001 — period IP optional
                pitcher_ip = []

        if not boxes and not pitcher_ip:
            continue
        # Only persist when at least one box exposes category stats or IP lines.
        if (
            boxes
            and not any(hasattr(b, "home_stats") for b in boxes)
            and not pitcher_ip
        ):
            continue
        doc = build_week_category_document(
            league_id=spec.id,
            season=season,
            week=week,
            box_scores=boxes,
            synced_at=synced_at if isinstance(synced_at, str) else None,
            period_label=str(snapshot.get("period_label") or "period"),
            pitcher_ip=pitcher_ip or None,
        )
        write_week_box_scores(doc, store_dir=store_dir)
        written += 1
    return written
