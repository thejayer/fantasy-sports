"""NHL public API (no key) — ported from Rinkside ``nhl.py``.

* ``api-web.nhle.com/v1`` — rosters, club schedules, player landing pages
* ``api.nhle.com/stats/rest/en`` — bulk skater / goalie / team season tables
* ``search.d3.nhle.com`` — player search (fallback for the ESPN → NHL map)

Fetching and parsing are split: :class:`NHLClient` takes a ``fetch`` callable
(``fetch(url, params) -> JSON``) so tests and fixtures feed canned responses
through the same parsers the live sync uses. Stdlib only (``urllib``) so the
slim sync image needs no extra dependency. Sync-time only — never called from
the hub.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

WEB = "https://api-web.nhle.com/v1"
STATS = "https://api.nhle.com/stats/rest/en"
SEARCH = "https://search.d3.nhle.com/api/v1/search/player"

USER_AGENT = "sj-nhl-sync/1 (Strictly Jayers hub)"
DEFAULT_TIMEOUT_SECONDS = 20.0
DEFAULT_THROTTLE_SECONDS = 0.05
DEFAULT_MAX_ATTEMPTS = 3

Fetch = Callable[[str, dict[str, Any] | None], Any]


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def season_id(hub_season: int) -> str:
    """Hub season is the end year: ``2027`` → ``'20262027'``."""
    return f"{int(hub_season) - 1}{int(hub_season)}"


def prior_season_ids(hub_season: int, count: int = 3) -> list[str]:
    """The ``count`` NHL seasons before ``hub_season``, newest first."""
    return [season_id(int(hub_season) - offset) for offset in range(1, count + 1)]


def txt(value: Any) -> Any:
    """NHL web API wraps localized strings as ``{'default': 'Name', ...}``."""
    return value.get("default") if isinstance(value, dict) else value


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    num = _num(value)
    return int(num) if num is not None else None


def _env_float(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def age_on(birth: Any, when: dt.date) -> int | None:
    try:
        born = dt.date.fromisoformat(str(birth)[:10])
    except (TypeError, ValueError):
        return None
    return when.year - born.year - ((when.month, when.day) < (born.month, born.day))


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def http_fetch(
    url: str,
    params: dict[str, Any] | None = None,
    *,
    timeout: float | None = None,
    attempts: int = DEFAULT_MAX_ATTEMPTS,
) -> Any:
    """GET JSON with a polite UA and small retry on 5xx / network errors."""
    full = f"{url}?{urllib.parse.urlencode(params)}" if params else url
    request = urllib.request.Request(
        full, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )
    wait = timeout if timeout is not None else _env_float(
        "SJ_NHL_TIMEOUT", DEFAULT_TIMEOUT_SECONDS
    )
    last: Exception | None = None
    for attempt in range(max(1, attempts)):
        try:
            with urllib.request.urlopen(request, timeout=wait) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                raise
            last = exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last = exc
        time.sleep(0.5 * (attempt + 1))
    assert last is not None
    raise last


class NHLClient:
    """Thin wrapper over the three NHL hosts. Parsed rows, never raw payloads."""

    def __init__(self, fetch: Fetch | None = None, *, throttle: float | None = None) -> None:
        self._fetch = fetch or http_fetch
        self.throttle = (
            _env_float("SJ_NHL_THROTTLE", DEFAULT_THROTTLE_SECONDS)
            if throttle is None
            else throttle
        )
        self.calls = 0

    def get(self, url: str, params: dict[str, Any] | None = None) -> Any:
        if self.calls and self.throttle:
            time.sleep(self.throttle)
        self.calls += 1
        return self._fetch(url, params)

    def _report(self, kind: str, report: str, cayenne: str, sort_prop: str) -> list[dict]:
        params = {
            "isAggregate": "false",
            "isGame": "false",
            "start": 0,
            "limit": -1,
            "cayenneExp": cayenne,
            "sort": json.dumps([{"property": sort_prop, "direction": "ASC"}]),
        }
        doc = self.get(f"{STATS}/{kind}/{report}", params)
        rows = doc.get("data") if isinstance(doc, dict) else None
        return [r for r in rows or [] if isinstance(r, dict)]

    def season_report(self, kind: str, report: str, nhl_season: str) -> list[dict]:
        """Regular-season table (``gameTypeId=2``) for one NHL season id."""
        sort_prop = "teamId" if kind == "team" else "playerId"
        return self._report(
            kind, report, f"seasonId={nhl_season} and gameTypeId=2", sort_prop
        )

    def toi_window(self, start: dt.date, end: dt.date) -> dict[int, dict[str, Any]]:
        """Per-game skater ice time between two dates (e.g. the last 14 days)."""
        params = {
            "isAggregate": "true",
            "isGame": "true",
            "start": 0,
            "limit": -1,
            "cayenneExp": (
                f'gameDate<="{end.isoformat()} 23:59:59" and '
                f'gameDate>="{start.isoformat()}" and gameTypeId=2'
            ),
            "sort": json.dumps([{"property": "playerId", "direction": "ASC"}]),
        }
        doc = self.get(f"{STATS}/skater/timeonice", params)
        rows = doc.get("data") if isinstance(doc, dict) else None
        return parse_toi_rows([r for r in rows or [] if isinstance(r, dict)])

    def roster(self, team: str) -> list[dict[str, Any]]:
        return parse_roster(self.get(f"{WEB}/roster/{team}/current"), team)

    def club_schedule(self, team: str, nhl_season: str) -> list[dict[str, Any]]:
        return parse_club_schedule(
            self.get(f"{WEB}/club-schedule-season/{team}/{nhl_season}"), team
        )

    def player_landing(self, nhl_id: int) -> dict[str, Any]:
        doc = self.get(f"{WEB}/player/{int(nhl_id)}/landing")
        return doc if isinstance(doc, dict) else {}

    def search_player(self, name: str) -> list[dict[str, Any]]:
        """Active players first; inactive only when no active name matches."""
        from nhl.match import norm

        hits: list[dict[str, Any]] = []
        for active in (True, False):
            params: dict[str, Any] = {"culture": "en-us", "limit": 10, "q": name}
            if active:
                params["active"] = "true"
            doc = self.get(SEARCH, params)
            hits = [h for h in doc if isinstance(h, dict)] if isinstance(doc, list) else []
            if any(norm(str(h.get("name", ""))) == norm(name) for h in hits):
                return hits
        return hits


# ---------------------------------------------------------------------------
# parsers (pure)
# ---------------------------------------------------------------------------
def parse_roster(doc: Any, team: str) -> list[dict[str, Any]]:
    """``/roster/{team}/current`` → ``[{id, first, last, pos, birth, team, height, weight}]``."""
    if not isinstance(doc, dict):
        return []
    out: list[dict[str, Any]] = []
    for section in ("forwards", "defensemen", "goalies"):
        for p in doc.get(section) or []:
            if not isinstance(p, dict) or p.get("id") is None:
                continue
            out.append(
                {
                    "id": int(p["id"]),
                    "first": txt(p.get("firstName")),
                    "last": txt(p.get("lastName")),
                    "pos": p.get("positionCode"),
                    "birth": p.get("birthDate"),
                    "team": team,
                    "height": _int(p.get("heightInInches")),
                    "weight": _int(p.get("weightInPounds")),
                }
            )
    return out


def parse_toi_rows(rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Skater ``timeonice`` → per-game minutes ``{id: {gp, toi, ev, pp, sh, teams}}``."""
    def minutes(row: dict[str, Any], key: str) -> float | None:
        seconds = _num(row.get(key))
        return round(seconds / 60, 2) if seconds is not None else None

    out: dict[int, dict[str, Any]] = {}
    for r in rows:
        gp = _int(r.get("gamesPlayed")) or 0
        if not gp or r.get("playerId") is None:
            continue
        out[int(r["playerId"])] = {
            "gp": gp,
            "toi": minutes(r, "timeOnIcePerGame"),
            "ev": minutes(r, "evTimeOnIcePerGame"),
            "pp": minutes(r, "ppTimeOnIcePerGame"),
            "sh": minutes(r, "shTimeOnIcePerGame"),
            "teams": r.get("teamAbbrevs"),
        }
    return out


def parse_skater_lines(
    summary: list[dict[str, Any]], realtime: list[dict[str, Any]] | None = None
) -> dict[int, dict[str, Any]]:
    """Skater ``summary`` (+ ``realtime`` hits/blocks) → league-scoring stat lines.

    ESPN splits power-play / short-handed *assists* out; the NHL reports
    points, so ``PPA = ppPoints - ppGoals``. ``HAT`` is not in these tables and
    stays absent (null), never 0.
    """
    out: dict[int, dict[str, Any]] = {}
    for r in summary:
        if r.get("playerId") is None:
            continue
        ppg, ppp = _int(r.get("ppGoals")) or 0, _int(r.get("ppPoints")) or 0
        shg, shp = _int(r.get("shGoals")) or 0, _int(r.get("shPoints")) or 0
        out[int(r["playerId"])] = {
            "GP": _int(r.get("gamesPlayed")) or 0,
            "G": _int(r.get("goals")) or 0,
            "A": _int(r.get("assists")) or 0,
            "PPG": ppg,
            "PPA": max(ppp - ppg, 0),
            "SHG": shg,
            "SHA": max(shp - shg, 0),
            "SHP": shp,
            "GWG": _int(r.get("gameWinningGoals")) or 0,
            "SOG": _int(r.get("shots")) or 0,
            "teams": r.get("teamAbbrevs"),
        }
    for r in realtime or []:
        line = out.get(_int(r.get("playerId")) or -1)
        if line is not None:
            hits, blocks = _int(r.get("hits")), _int(r.get("blockedShots"))
            if hits is not None:
                line["HIT"] = hits
            if blocks is not None:
                line["BLK"] = blocks
    return out


def parse_goalie_lines(rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Goalie ``summary`` → ``{id: {GP, GS, W, L, GA, SV, SO, teams}}``."""
    out: dict[int, dict[str, Any]] = {}
    for r in rows:
        if r.get("playerId") is None:
            continue
        out[int(r["playerId"])] = {
            "GP": _int(r.get("gamesPlayed")) or 0,
            "GS": _int(r.get("gamesStarted")) or 0,
            "W": _int(r.get("wins")) or 0,
            "L": _int(r.get("losses")) or 0,
            "GA": _int(r.get("goalsAgainst")) or 0,
            "SV": _int(r.get("saves")) or 0,
            "SO": _int(r.get("shutouts")) or 0,
            "teams": r.get("teamAbbrevs"),
        }
    return out


def parse_team_summary(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Team ``summary`` → ``{NHL abbrev: {name, gp, gf, ga, sf, sa, pk, pp}}`` (per game)."""
    from nhl.teams import nhl_abbrev

    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        name = r.get("teamFullName")
        abbrev = nhl_abbrev(name)
        if abbrev is None:
            continue
        out[abbrev] = {
            "name": name,
            "gp": _int(r.get("gamesPlayed")) or 0,
            "gf": _num(r.get("goalsForPerGame")),
            "ga": _num(r.get("goalsAgainstPerGame")),
            "sf": _num(r.get("shotsForPerGame")),
            "sa": _num(r.get("shotsAgainstPerGame")),
            "pk": _num(r.get("penaltyKillPct")),
            "pp": _num(r.get("powerPlayPct")),
        }
    return out


def flag_back_to_backs(games: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sort by date and set ``b2b`` when the club also plays the day before/after."""
    games.sort(key=lambda g: g["date"])
    dates = {g["date"] for g in games}
    for g in games:
        day = dt.date.fromisoformat(g["date"])
        g["b2b"] = (day - dt.timedelta(days=1)).isoformat() in dates or (
            day + dt.timedelta(days=1)
        ).isoformat() in dates
    return games


def parse_club_schedule(doc: Any, team: str) -> list[dict[str, Any]]:
    """``/club-schedule-season/{team}/{season}`` → regular-season games + b2b."""
    if not isinstance(doc, dict):
        return []
    out: list[dict[str, Any]] = []
    for g in doc.get("games") or []:
        if not isinstance(g, dict) or g.get("gameType") != 2:
            continue
        home = txt((g.get("homeTeam") or {}).get("abbrev"))
        away = txt((g.get("awayTeam") or {}).get("abbrev"))
        date = str(g.get("gameDate") or "")[:10]
        if not date or not home or not away:
            continue
        out.append(
            {
                "date": date,
                "opp": away if home == team else home,
                "home": home == team,
                "start": g.get("startTimeUTC"),
            }
        )
    return flag_back_to_backs(out)


def summarize_landing(doc: dict[str, Any], current_nhl_season: str) -> dict[str, Any]:
    """Career context from ``/player/{id}/landing`` for rookies / prospects.

    Prior NHL regular-season GP, draft slot, and the two most recent non-NHL
    seasons with 10+ GP (league, games, goals, assists, save %). H2's prospect
    model (NHLe) consumes this; H1 only stores it.
    """
    cur = int(current_nhl_season)
    totals = [t for t in doc.get("seasonTotals") or [] if isinstance(t, dict)]
    prior_nhl_gp = sum(
        _int(t.get("gamesPlayed")) or 0
        for t in totals
        if t.get("leagueAbbrev") == "NHL"
        and t.get("gameTypeId") == 2
        and (_int(t.get("season")) or 0) < cur
    )
    minors = [
        t
        for t in totals
        if t.get("gameTypeId") == 2
        and t.get("leagueAbbrev") != "NHL"
        and (_int(t.get("season")) or 0) < cur
        and (_int(t.get("gamesPlayed")) or 0) >= 10
    ]
    minors.sort(key=lambda t: _int(t.get("season")) or 0, reverse=True)
    draft = doc.get("draftDetails") or {}
    return {
        "birth": doc.get("birthDate"),
        "height": _int(doc.get("heightInInches")),
        "weight": _int(doc.get("weightInPounds")),
        "team": doc.get("currentTeamAbbrev"),
        "prior_nhl_gp": prior_nhl_gp,
        "draft": (
            {
                "year": _int(draft.get("year")),
                "round": _int(draft.get("round")),
                "pick_in_round": _int(draft.get("pickInRound")),
                "overall": _int(draft.get("overallPick")),
                "team": draft.get("teamAbbrev"),
            }
            if draft
            else None
        ),
        "minors": [
            {
                "season": str(t.get("season")),
                "league": t.get("leagueAbbrev"),
                "team": txt(t.get("teamName")),
                "gp": _int(t.get("gamesPlayed")),
                "g": _int(t.get("goals")),
                "a": _int(t.get("assists")),
                "pts": _int(t.get("points")),
                "sv_pct": _num(t.get("savePctg") or t.get("savePct")),
            }
            for t in minors[:2]
        ],
    }
