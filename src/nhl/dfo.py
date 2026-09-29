"""Daily Faceoff lineups + starting goalies (HOCKEY-PORT.md H4).

Ported from Rinkside ``dfo.py``. Sync-time only: the hub never calls Daily
Faceoff from a request. Pages are Next.js, so each embeds its data as
``__NEXT_DATA__`` JSON, which is parsed first:

* ``/teams/{slug}/line-combinations`` → ``combinations.players``, each with a
  ``groupIdentifier`` (``f1``–``f4`` lines, ``d1``–``d3`` pairs, ``pp1``/``pp2``,
  ``pk1``/``pk2``, ``g``, ``ir``), an ``injuryStatus`` (``out`` / ``dtd`` / …),
  and the page's ``updatedAt``.
* ``/starting-goalies/{date}`` → ``data`` rows with home/away goalie names and
  a news strength (``Confirmed`` / ``Likely`` / none = Unconfirmed).

If the embedded JSON ever disappears, a light fallback reads the visible
section headings. robots.txt allows these pages (it disallows ``/api/`` and
``/cms/``). Be polite: an honest User-Agent, a pause between pages
(``SJ_DFO_THROTTLE``, default 2s), 32 team pages at most every few hours, and
one goalie page per date.
"""

from __future__ import annotations

import json
import os
import re
import time
import unicodedata
import urllib.request
from collections.abc import Callable
from typing import Any

from nhl.teams import NHL_NAMES, nhl_abbrev

BASE = "https://www.dailyfaceoff.com"
TEAM_URL = BASE + "/teams/{slug}/line-combinations"
GOALIE_URL = BASE + "/starting-goalies/{date}"
USER_AGENT = "sj-nhl-sync/1 (Strictly Jayers hub; a few lineup reads a day)"
DEFAULT_THROTTLE_SECONDS = 2.0
DEFAULT_TIMEOUT_SECONDS = 25.0
# A lineup only proves a scratch when it is full (Rinkside rule).
FULL_LINEUP_MIN_MATCHED = 15

FetchHtml = Callable[[str], str]

_NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.DOTALL)
_INJURY_WORDS = {
    "out": "out", "ir": "ir", "ltir": "ltir", "dtd": "dtd", "day-to-day": "dtd",
    "gtd": "gtd", "game-time decision": "gtd", "suspended": "suspended",
}
GOALIE_STATUSES = ("Confirmed", "Likely", "Unconfirmed")


def team_slug(team_name: str) -> str:
    """``"Montréal Canadiens"`` → ``"montreal-canadiens"``; ``"St. Louis Blues"`` → ``"st-louis-blues"``."""
    text = unicodedata.normalize("NFKD", team_name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", text.replace(".", "")).strip("-")


def team_url(abbrev: str) -> str | None:
    name = NHL_NAMES.get(abbrev)
    return TEAM_URL.format(slug=team_slug(name)) if name else None


def throttle_seconds() -> float:
    try:
        return max(0.0, float(os.environ.get("SJ_DFO_THROTTLE", DEFAULT_THROTTLE_SECONDS)))
    except ValueError:
        return DEFAULT_THROTTLE_SECONDS


def dfo_sync_enabled() -> bool:
    """``SJ_DFO_SYNC=0`` skips Daily Faceoff (lines/goalies stay as last written)."""
    return os.environ.get("SJ_DFO_SYNC", "1").strip().lower() not in {"0", "false", "no", "off"}


def http_fetch_html(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=DEFAULT_TIMEOUT_SECONDS) as response:
        return response.read().decode("utf-8", errors="replace")


class DfoClient:
    """Page fetcher with the polite pause between requests. ``fetch`` is injectable."""

    def __init__(self, fetch: FetchHtml | None = None, *, throttle: float | None = None) -> None:
        self._fetch = fetch or http_fetch_html
        self.throttle = throttle_seconds() if throttle is None else throttle
        self.calls = 0

    def get(self, url: str) -> str:
        if self.calls and self.throttle:
            time.sleep(self.throttle)
        self.calls += 1
        return self._fetch(url)

    def team_page(self, abbrev: str) -> dict[str, Any]:
        url = team_url(abbrev)
        if url is None:
            raise KeyError(abbrev)
        parsed = parse_team_page(self.get(url))
        parsed["url"] = url
        return parsed

    def goalie_page(self, date_iso: str) -> list[dict[str, Any]]:
        return parse_goalie_page(self.get(GOALIE_URL.format(date=date_iso)))


# ---------------------------------------------------------------------------
# parsers (pure)
# ---------------------------------------------------------------------------
def _next_data(html: str) -> dict[str, Any] | None:
    m = _NEXT_DATA.search(html or "")
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except ValueError:
        return None
    props = (data.get("props") or {}).get("pageProps") if isinstance(data, dict) else None
    return props if isinstance(props, dict) else None


def _injury(status: Any) -> str | None:
    text = str(status or "").strip().lower()
    if not text or text in {"none", "null", "healthy", "active", "false"}:
        return None
    return _INJURY_WORDS.get(text, text)


def empty_lineup() -> dict[str, Any]:
    return {"lines": {}, "pairs": {}, "pp": {}, "pk": {}, "goalies": [], "ir": [],
            "injuries": {}, "gtd": [], "listed": [], "updated_at": None, "source": None}


def parse_team_page(html: str) -> dict[str, Any]:
    """One team's lineup: ``lines`` 1–4, ``pairs`` 1–3, ``pp``/``pk`` 1–2 (names)."""
    props = _next_data(html)
    combos = (props or {}).get("combinations") if props else None
    if isinstance(combos, dict) and isinstance(combos.get("players"), list):
        return _from_combinations(combos)
    return _from_sections(html)


def _add(bucket: dict[int, list[str]], n: int, name: str) -> None:
    names = bucket.setdefault(n, [])
    if name not in names:
        names.append(name)


def _from_combinations(combos: dict[str, Any]) -> dict[str, Any]:
    out = empty_lineup()
    out["updated_at"] = combos.get("updatedAt")
    out["source"] = combos.get("sourceName") or combos.get("source")
    for p in combos["players"]:
        if not isinstance(p, dict):
            continue
        name = p.get("name")
        group = str(p.get("groupIdentifier") or "").lower()
        if not isinstance(name, str) or not name.strip():
            continue
        name = name.strip()
        injury = _injury(p.get("injuryStatus"))
        if injury:
            out["injuries"][name] = injury
        if str(p.get("gameTimeDecision")).lower() == "true" and name not in out["gtd"]:
            out["gtd"].append(name)
        m = re.fullmatch(r"(f|d|pp|pk)(\d)", group)
        if m:
            kind, n = m.group(1), int(m.group(2))
            _add({"f": out["lines"], "d": out["pairs"], "pp": out["pp"], "pk": out["pk"]}[kind],
                 n, name)
        elif group == "g":
            if name not in out["goalies"]:
                out["goalies"].append(name)
        elif group == "ir":
            if name not in out["ir"]:
                out["ir"].append(name)
            out["injuries"].setdefault(name, "ir")
            continue
        else:
            continue
        if name not in out["listed"]:
            out["listed"].append(name)
    return out


_SECTIONS = (("lines", "Forwards"), ("pairs", "Defensive Pairings"), ("pp1", "1st Powerplay Unit"),
             ("pp2", "2nd Powerplay Unit"), ("goalies", "Goalies"))
_PLAYER_LINK = re.compile(
    r'href="(?:https://www\.dailyfaceoff\.com)?/players/news/[^"]+"[^>]*>\s*([^<>]{2,60}?)\s*</a>'
)


def _from_sections(html: str) -> dict[str, Any]:
    """Fallback when ``__NEXT_DATA__`` is missing: read visible section headings."""
    out = empty_lineup()
    marks = sorted((i, key) for key, label in _SECTIONS if (i := (html or "").find(label)) >= 0)
    for j, (i, key) in enumerate(marks):
        end = marks[j + 1][0] if j + 1 < len(marks) else len(html)
        names: list[str] = []
        for raw in _PLAYER_LINK.findall(html[i:end]):
            name = re.sub(r"\s+", " ", raw).strip()
            if name and name not in names:
                names.append(name)
        if key == "lines":
            for k, name in enumerate(names[:12]):
                _add(out["lines"], k // 3 + 1, name)
        elif key == "pairs":
            for k, name in enumerate(names[:6]):
                _add(out["pairs"], k // 2 + 1, name)
        elif key in ("pp1", "pp2"):
            out["pp"][int(key[-1])] = names[:5]
        elif key == "goalies":
            out["goalies"] = names[:3]
        for name in names:
            if name not in out["listed"]:
                out["listed"].append(name)
    out["source"] = "page sections" if out["lines"] or out["pp"] else None
    return out


def _strength(value: Any) -> str:
    text = str(value or "").strip().title()
    if text == "Expected":
        return "Likely"
    return text if text in GOALIE_STATUSES else "Unconfirmed"


def parse_goalie_page(html: str) -> list[dict[str, Any]]:
    """Every game on a date: ``{date, time, home, away, home_goalie, away_goalie}``."""
    props = _next_data(html)
    rows = (props or {}).get("data") if props else None
    out: list[dict[str, Any]] = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        home, away = nhl_abbrev(r.get("homeTeamName")), nhl_abbrev(r.get("awayTeamName"))
        if not home or not away:
            continue
        game: dict[str, Any] = {"date": str(r.get("date") or "")[:10] or None,
                                "time": r.get("time"), "home": home, "away": away}
        for side in ("home", "away"):
            name = r.get(f"{side}GoalieName")
            game[f"{side}_goalie"] = {
                "name": name.strip() if isinstance(name, str) and name.strip() else None,
                "status": _strength(r.get(f"{side}NewsStrengthName")),
                "news": r.get(f"{side}NewsDetails") or None,
                "news_at": r.get(f"{side}NewsCreatedAt") or None,
            }
        out.append(game)
    return out
