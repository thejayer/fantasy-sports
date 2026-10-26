"""OddsProvider + ESPN public scoreboard parser.

ESPN's site scoreboard is free and keyless. It publishes the *current*
spread / total / moneyline (usually ESPN BET) for today's slate — not a
historical open, not every CFB game, and almost never player props.
``OddsProvider`` is the seam for a paid feed later.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import date, datetime, timezone
from typing import Any, Protocol

from sj.bets import american_to_decimal

USER_AGENT = "sj-bot/1"
ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports"

SPORT_SPECS: dict[str, dict[str, str]] = {
    "NFL": {"path": "football/nfl"},
    "CFB": {"path": "football/college-football"},
    "NBA": {"path": "basketball/nba"},
}


class OddsProvider(Protocol):
    """Current lines + final scores. Implementations must be side-effect free
    except for HTTP (or a fixture clock)."""

    name: str

    def scoreboard(self, sport: str, day: date) -> dict[str, Any]: ...


def _as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def parse_record_summary(summary: Any) -> dict[str, int] | None:
    text = _as_text(summary)
    if not text or "-" not in text:
        return None
    left, _, right = text.partition("-")
    wins = _as_int(left)
    # "5-2-1" (NHL) or "5-2" — take the first two integers.
    rest = right.split("-", 1)[0]
    losses = _as_int(rest)
    if wins is None or losses is None:
        return None
    return {"wins": wins, "losses": losses}


def _competitor_record(comp: dict[str, Any]) -> dict[str, int] | None:
    for rec in comp.get("records") or []:
        if not isinstance(rec, dict):
            continue
        parsed = parse_record_summary(rec.get("summary"))
        if parsed:
            return parsed
    team = comp.get("team") if isinstance(comp.get("team"), dict) else {}
    record = team.get("record") if isinstance(team.get("record"), dict) else {}
    items = record.get("items") or []
    if items and isinstance(items[0], dict):
        parsed = parse_record_summary(items[0].get("summary"))
        if parsed:
            return parsed
    return None


def _american(value: Any) -> int | None:
    num = _as_float(value)
    if num is None:
        return None
    return round(num)


def _team_side(comp: dict[str, Any]) -> dict[str, Any]:
    team = comp.get("team") if isinstance(comp.get("team"), dict) else {}
    return {
        "id": _as_text(team.get("id") or comp.get("id")),
        "abbr": _as_text(team.get("abbreviation")).upper(),
        "name": _as_text(team.get("displayName") or team.get("name")),
        "record": _competitor_record(comp),
        "score": _as_int(comp.get("score")),
    }


def _status_block(comp: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    status = comp.get("status") if isinstance(comp.get("status"), dict) else {}
    if not status:
        status = event.get("status") if isinstance(event.get("status"), dict) else {}
    typ = status.get("type") if isinstance(status.get("type"), dict) else {}
    state = _as_text(typ.get("state") or status.get("state")).lower()
    completed = bool(typ.get("completed")) or state == "post"
    name = _as_text(typ.get("name") or typ.get("description"))
    if completed:
        bucket = "final"
    elif state == "in":
        bucket = "live"
    else:
        bucket = "pre"
    return {"state": bucket, "completed": completed, "name": name}


def _market_row(
    *,
    market: str,
    side: str,
    selection: str,
    line: float | None,
    american: int | None,
    book: str,
) -> dict[str, Any] | None:
    if american is None:
        return None
    return {
        "type": market,
        "side": side,
        "selection": selection,
        "line": line,
        "american": american,
        "decimal": american_to_decimal(american),
        "book": book,
    }


def parse_odds_block(
    odds: dict[str, Any],
    away: dict[str, Any],
    home: dict[str, Any],
) -> list[dict[str, Any]]:
    """Normalize one ESPN ``competitions[].odds[]`` row into markets."""
    provider = odds.get("provider") if isinstance(odds.get("provider"), dict) else {}
    book = _as_text(provider.get("name") or odds.get("provider")) or "ESPN BET"
    away_odds = odds.get("awayTeamOdds") if isinstance(odds.get("awayTeamOdds"), dict) else {}
    home_odds = odds.get("homeTeamOdds") if isinstance(odds.get("homeTeamOdds"), dict) else {}
    spread = _as_float(odds.get("spread") if odds.get("spread") is not None else odds.get("pointSpread"))
    total = _as_float(odds.get("overUnder"))
    details = _as_text(odds.get("details"))
    # ESPN ``spread`` is usually the home-side number (home favorite → negative).
    # ``details`` looks like "KC -3.5". Prefer details when we can parse them.
    away_line = None
    home_line = None
    if spread is not None:
        home_line = spread
        away_line = -spread
    parsed = _parse_details_spread(details, away, home)
    if parsed:
        away_line, home_line = parsed
    rows: list[dict[str, Any]] = []
    away_name = away.get("abbr") or away.get("name") or "AWAY"
    home_name = home.get("abbr") or home.get("name") or "HOME"
    away_spread_odds = _american(away_odds.get("spreadOdds") or odds.get("awayTeamSpreadOdds"))
    home_spread_odds = _american(home_odds.get("spreadOdds") or odds.get("homeTeamSpreadOdds"))
    if away_line is not None:
        label = f"{away_name} {away_line:+g}"
        rows.append(
            _market_row(
                market="spread",
                side="away",
                selection=label,
                line=away_line,
                american=away_spread_odds or -110,
                book=book,
            )
        )
    if home_line is not None:
        label = f"{home_name} {home_line:+g}"
        rows.append(
            _market_row(
                market="spread",
                side="home",
                selection=label,
                line=home_line,
                american=home_spread_odds or -110,
                book=book,
            )
        )
    over_odds = _american(
        odds.get("overOdds") or (odds.get("overUnderOdds") if isinstance(odds.get("overUnderOdds"), dict) else None)
    )
    if isinstance(odds.get("overUnderOdds"), dict):
        over_odds = over_odds or _american(odds["overUnderOdds"].get("over"))
        under_odds = _american(odds["overUnderOdds"].get("under"))
    else:
        under_odds = _american(odds.get("underOdds"))
    if total is not None:
        rows.append(
            _market_row(
                market="total",
                side="over",
                selection=f"Over {total:g}",
                line=total,
                american=over_odds or -110,
                book=book,
            )
        )
        rows.append(
            _market_row(
                market="total",
                side="under",
                selection=f"Under {total:g}",
                line=total,
                american=under_odds or -110,
                book=book,
            )
        )
    away_ml = _american(away_odds.get("moneyLine") or odds.get("awayTeamMoneyLine"))
    home_ml = _american(home_odds.get("moneyLine") or odds.get("homeTeamMoneyLine"))
    rows.append(
        _market_row(
            market="ml",
            side="away",
            selection=f"{away_name} ML",
            line=None,
            american=away_ml,
            book=book,
        )
    )
    rows.append(
        _market_row(
            market="ml",
            side="home",
            selection=f"{home_name} ML",
            line=None,
            american=home_ml,
            book=book,
        )
    )
    return [row for row in rows if row]


def _parse_details_spread(
    details: str, away: dict[str, Any], home: dict[str, Any]
) -> tuple[float, float] | None:
    if not details or details.upper() in {"EVEN", "PK", "PICK"}:
        if details.upper() in {"EVEN", "PK", "PICK"}:
            return 0.0, 0.0
        return None
    parts = details.replace("−", "-").split()
    if len(parts) < 2:
        return None
    team, raw_line = parts[0], parts[-1]
    line = _as_float(raw_line)
    if line is None:
        return None
    team_u = team.upper()
    away_abbr = _as_text(away.get("abbr")).upper()
    home_abbr = _as_text(home.get("abbr")).upper()
    if team_u == away_abbr or team_u in _as_text(away.get("name")).upper():
        return line, -line
    if team_u == home_abbr or team_u in _as_text(home.get("name")).upper():
        return -line, line
    return None


def parse_espn_event(event: dict[str, Any], sport: str) -> dict[str, Any] | None:
    if not isinstance(event, dict):
        return None
    comps = event.get("competitions") or []
    if not comps or not isinstance(comps[0], dict):
        return None
    comp = comps[0]
    away = home = None
    for row in comp.get("competitors") or []:
        if not isinstance(row, dict):
            continue
        side = _as_text(row.get("homeAway")).lower()
        parsed = _team_side(row)
        if side == "away":
            away = parsed
        elif side == "home":
            home = parsed
    if not away or not home:
        return None
    status = _status_block(comp, event)
    start = _as_text(comp.get("date") or event.get("date"))
    markets: list[dict[str, Any]] = []
    for odds in comp.get("odds") or []:
        if isinstance(odds, dict):
            markets = parse_odds_block(odds, away, home)
            if markets:
                break
    return {
        "id": _as_text(event.get("id") or comp.get("id")),
        "sport": sport,
        "start": start,
        "away": away,
        "home": home,
        "status": status,
        "markets": markets,
        "neutral": bool(comp.get("neutralSite")),
    }


def parse_espn_scoreboard(payload: dict[str, Any], sport: str) -> list[dict[str, Any]]:
    games: list[dict[str, Any]] = []
    events = payload.get("events") if isinstance(payload, dict) else None
    if not isinstance(events, list):
        return games
    for event in events:
        parsed = parse_espn_event(event, sport)
        if parsed:
            games.append(parsed)
    return games


def implied_prob(american: float) -> float | None:
    try:
        num = float(american)
    except (TypeError, ValueError):
        return None
    if num == 0:
        return None
    if num > 0:
        return 100.0 / (num + 100.0)
    return abs(num) / (abs(num) + 100.0)


class EspnOddsProvider:
    """Public ESPN site scoreboard. No API key."""

    name = "espn_scoreboard"

    def __init__(
        self,
        *,
        timeout: float | None = None,
        throttle: float | None = None,
        opener: Callable[..., Any] | None = None,
    ) -> None:
        self.timeout = timeout if timeout is not None else float(os.environ.get("SJ_BOT_TIMEOUT", "20"))
        self.throttle = throttle if throttle is not None else float(os.environ.get("SJ_BOT_THROTTLE", "0.05"))
        self._opener = opener or urllib.request.urlopen
        self._last_call = 0.0

    def scoreboard(self, sport: str, day: date) -> dict[str, Any]:
        spec = SPORT_SPECS.get(sport.upper())
        if not spec:
            raise ValueError(f"unsupported sport {sport!r}")
        ymd = day.strftime("%Y%m%d")
        params = {"dates": ymd, "limit": "100"}
        if sport.upper() == "CFB":
            params["groups"] = "80"  # FBS
        url = f"{ESPN_SITE}/{spec['path']}/scoreboard?{urllib.parse.urlencode(params)}"
        self._wait()
        request = urllib.request.Request(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        try:
            with self._opener(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"ESPN {sport} scoreboard HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise RuntimeError(f"ESPN {sport} scoreboard failed: {exc}") from exc
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"ESPN {sport} scoreboard was not JSON") from exc
        if not isinstance(payload, dict):
            raise TypeError(f"ESPN {sport} scoreboard had a non-object body")
        return payload

    def _wait(self) -> None:
        if self.throttle <= 0:
            return
        gap = time.monotonic() - self._last_call
        if gap < self.throttle:
            time.sleep(self.throttle - gap)
        self._last_call = time.monotonic()


class FixtureOddsProvider:
    """In-memory / callable provider for tests and the seeded backtest."""

    name = "fixture"

    def __init__(self, slates: dict[tuple[str, str], dict[str, Any]] | None = None) -> None:
        self.slates = slates or {}

    def scoreboard(self, sport: str, day: date) -> dict[str, Any]:
        key = (sport.upper(), day.isoformat())
        payload = self.slates.get(key)
        if payload is None:
            return {"events": []}
        return payload


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def stamp_for(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
