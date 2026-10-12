"""College Football Data API client (roadmap 7.16).

Reads completed FBS results and the AP poll from
https://api.collegefootballdata.com. Auth is a Bearer token
(``SJ_CFBD_API_KEY`` / ``CFBD_API_KEY``). The sync image stays stdlib-only
(``urllib``), matching ``nhl.nhl_api``.

A missing key is not an error — callers degrade and the hub shows why.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

CFBD_BASE = "https://api.collegefootballdata.com"
USER_AGENT = "sj-ai-rankings/1 (Strictly Jayers hub; collegefootballdata.com)"
DEFAULT_TIMEOUT_SECONDS = 20.0

Fetch = Callable[[str, dict[str, Any] | None], Any]


def cfbd_api_key(env: dict[str, str] | None = None) -> str:
    source = env if env is not None else os.environ
    return (source.get("SJ_CFBD_API_KEY") or source.get("CFBD_API_KEY") or "").strip()


def default_cfb_season(today: date | None = None) -> int:
    """Fall year: Aug–Dec is this year; bowl season (Jan) and offseason use last fall."""
    when = today or datetime.now(timezone.utc).date()
    if when.month >= 8:
        return when.year
    return when.year - 1


def week_label(season: int, week: int) -> str:
    if week <= 0:
        return f"{int(season)}-off"
    return f"{int(season)}-w{int(week):02d}"


def parse_week_label(label: str) -> tuple[int, int] | None:
    raw = str(label).strip().lower()
    if "-off" in raw:
        year = raw.split("-off", 1)[0]
        return (int(year), 0) if year.isdigit() else None
    if "-w" not in raw:
        return None
    year, _, week = raw.partition("-w")
    if not year.isdigit() or not week.isdigit():
        return None
    return int(year), int(week)


def _pick(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in row and row[name] is not None:
            return row[name]
    return None


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes"}
    return bool(value)


@dataclass
class CfbdGame:
    season: int
    week: int
    season_type: str
    completed: bool
    neutral_site: bool
    venue: str
    home_team: str
    away_team: str
    home_conference: str
    away_conference: str
    home_classification: str
    away_classification: str
    home_points: int | None
    away_points: int | None

    @property
    def both_fbs(self) -> bool:
        return self.home_classification == "fbs" and self.away_classification == "fbs"

    @property
    def any_fbs(self) -> bool:
        return self.home_classification == "fbs" or self.away_classification == "fbs"


@dataclass
class TeamSeason:
    name: str
    conference: str
    wins: int = 0
    losses: int = 0
    ties: int = 0
    points_for: int = 0
    points_against: int = 0
    results: list[str] = field(default_factory=list)

    @property
    def record(self) -> str:
        if self.ties:
            return f"{self.wins}-{self.losses}-{self.ties}"
        return f"{self.wins}-{self.losses}"


def parse_game(row: dict[str, Any]) -> CfbdGame | None:
    home = _text(_pick(row, "homeTeam", "home_team"))
    away = _text(_pick(row, "awayTeam", "away_team"))
    if not home or not away:
        return None
    season = _int(_pick(row, "season", "year")) or 0
    week = _int(_pick(row, "week")) or 0
    return CfbdGame(
        season=season,
        week=week,
        season_type=_text(_pick(row, "seasonType", "season_type")) or "regular",
        completed=_bool(_pick(row, "completed")),
        neutral_site=_bool(_pick(row, "neutralSite", "neutral_site")),
        venue=_text(_pick(row, "venue", "venueName", "venue_name")),
        home_team=home,
        away_team=away,
        home_conference=_text(_pick(row, "homeConference", "home_conference")),
        away_conference=_text(_pick(row, "awayConference", "away_conference")),
        home_classification=_text(
            _pick(row, "homeClassification", "home_classification")
        ).lower()
        or "fbs",
        away_classification=_text(
            _pick(row, "awayClassification", "away_classification")
        ).lower()
        or "fbs",
        home_points=_int(_pick(row, "homePoints", "home_points")),
        away_points=_int(_pick(row, "awayPoints", "away_points")),
    )


def parse_games(rows: Any) -> list[CfbdGame]:
    if not isinstance(rows, list):
        return []
    games = [parse_game(row) for row in rows if isinstance(row, dict)]
    return [game for game in games if game is not None]


def parse_ap_poll(payload: Any, week: int | None = None) -> list[dict[str, Any]]:
    """Flatten CFBD ``/rankings`` to ``[{rank, name, conference, first_place_votes}]``."""
    if not isinstance(payload, list):
        return []
    chosen: dict[str, Any] | None = None
    for block in payload:
        if not isinstance(block, dict):
            continue
        block_week = _int(block.get("week"))
        if week is not None and block_week not in (week, None):
            continue
        chosen = block
        if week is not None and block_week == week:
            break
    if chosen is None and payload:
        last = payload[-1]
        chosen = last if isinstance(last, dict) else None
    if not chosen:
        return []
    polls = chosen.get("polls") or []
    ap = None
    for poll in polls:
        if not isinstance(poll, dict):
            continue
        label = _text(poll.get("poll")).lower()
        if "ap" in label:
            ap = poll
            break
    if ap is None:
        return []
    ranks: list[dict[str, Any]] = []
    for row in ap.get("ranks") or []:
        if not isinstance(row, dict):
            continue
        name = _text(_pick(row, "school", "team", "name"))
        rank = _int(row.get("rank"))
        if not name or rank is None:
            continue
        ranks.append(
            {
                "rank": rank,
                "name": name,
                "conference": _text(row.get("conference")),
                "first_place_votes": _int(
                    _pick(row, "firstPlaceVotes", "first_place_votes")
                ),
            }
        )
    ranks.sort(key=lambda item: item["rank"])
    return ranks


def result_line(game: CfbdGame, team: str) -> str | None:
    if game.home_points is None or game.away_points is None:
        return None
    if team == game.home_team:
        opp, scored, allowed = game.away_team, game.home_points, game.away_points
        loc = "vs" if not game.neutral_site else "n"
    elif team == game.away_team:
        opp, scored, allowed = game.home_team, game.away_points, game.home_points
        loc = "at" if not game.neutral_site else "n"
    else:
        return None
    if scored > allowed:
        mark = "W"
    elif scored < allowed:
        mark = "L"
    else:
        mark = "T"
    place = "neutral" if game.neutral_site or loc == "n" else ("home" if loc == "vs" else "away")
    venue = f" ({game.venue})" if game.venue else ""
    return f"{mark} {scored}-{allowed} {loc} {opp} [{place}]{venue}"


def accumulate_records(games: list[CfbdGame]) -> dict[str, TeamSeason]:
    teams: dict[str, TeamSeason] = {}

    def bucket(name: str, conference: str) -> TeamSeason:
        row = teams.get(name)
        if row is None:
            row = TeamSeason(name=name, conference=conference)
            teams[name] = row
        elif conference and not row.conference:
            row.conference = conference
        return row

    for game in games:
        if not game.completed or game.home_points is None or game.away_points is None:
            continue
        if not game.any_fbs:
            continue
        home = bucket(game.home_team, game.home_conference)
        away = bucket(game.away_team, game.away_conference)
        home.points_for += game.home_points
        home.points_against += game.away_points
        away.points_for += game.away_points
        away.points_against += game.home_points
        if game.home_points > game.away_points:
            home.wins += 1
            away.losses += 1
        elif game.home_points < game.away_points:
            away.wins += 1
            home.losses += 1
        else:
            home.ties += 1
            away.ties += 1
        home_line = result_line(game, game.home_team)
        away_line = result_line(game, game.away_team)
        if home_line:
            home.results.append(home_line)
        if away_line:
            away.results.append(away_line)
    return teams


def fbs_teams(records: dict[str, TeamSeason], games: list[CfbdGame]) -> list[TeamSeason]:
    fbs_names: set[str] = set()
    for game in games:
        if game.home_classification == "fbs":
            fbs_names.add(game.home_team)
        if game.away_classification == "fbs":
            fbs_names.add(game.away_team)
    rows = [records[name] for name in fbs_names if name in records]
    rows.sort(key=lambda row: (-row.wins, row.losses, -row.points_for, row.name))
    return rows


def latest_completed_week(games: list[CfbdGame]) -> int:
    weeks = [
        game.week
        for game in games
        if game.completed and game.week > 0 and game.home_points is not None
    ]
    return max(weeks) if weeks else 1


def compact_team_facts(teams: list[TeamSeason], last_n: int = 3) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    for team in teams:
        facts.append(
            {
                "name": team.name,
                "conference": team.conference,
                "record": team.record,
                "wins": team.wins,
                "losses": team.losses,
                "ties": team.ties,
                "points_for": team.points_for,
                "points_against": team.points_against,
                "last": team.results[-last_n:],
            }
        )
    return facts


def compact_week_results(games: list[CfbdGame], week: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for game in games:
        if game.week != week or not game.completed:
            continue
        if game.home_points is None or game.away_points is None:
            continue
        if not game.any_fbs:
            continue
        rows.append(
            {
                "home": game.home_team,
                "away": game.away_team,
                "score": f"{game.home_points}-{game.away_points}",
                "home_points": game.home_points,
                "away_points": game.away_points,
                "venue": game.venue,
                "neutral": game.neutral_site,
                "conference_game": game.home_conference == game.away_conference
                and bool(game.home_conference),
            }
        )
    rows.sort(key=lambda item: item["home"])
    return rows


class CfbdClient:
    """Thin CFBD HTTP wrapper. Inject ``fetch`` in tests."""

    def __init__(
        self,
        api_key: str = "",
        fetch: Fetch | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self.api_key = api_key.strip()
        self.timeout = timeout
        self._fetch = fetch or self._http_fetch

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    def _http_fetch(self, path: str, params: dict[str, Any] | None) -> Any:
        if not self.api_key:
            raise RuntimeError("CFBD API key is not configured")
        query = urllib.parse.urlencode(
            {key: value for key, value in (params or {}).items() if value is not None}
        )
        url = f"{CFBD_BASE}{path}"
        if query:
            url = f"{url}?{query}"
        request = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:180]
            raise RuntimeError(f"CFBD {exc.code} {path}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"CFBD network error {path}: {exc.reason}") from exc

    def games(self, season: int, season_type: str = "regular") -> list[CfbdGame]:
        payload = self._fetch(
            "/games",
            {"year": season, "seasonType": season_type, "division": "fbs"},
        )
        return parse_games(payload)

    def rankings(self, season: int, week: int | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"year": season, "seasonType": "regular"}
        if week:
            params["week"] = week
        return parse_ap_poll(self._fetch("/rankings", params), week=week)
