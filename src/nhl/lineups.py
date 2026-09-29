"""Build the H4 lineup artifacts from Daily Faceoff pages (HOCKEY-PORT.md H4).

* ``nhl/lines.json`` — per club: lines 1–4, pairs 1–3, PP1/PP2, PK units,
  goalies, IR, injuries (DFO words), the page's update time; per NHL player:
  role (``Line 1`` / ``Pair 2``), PP unit, linemates, injury, possible scratch.
* ``nhl/starting_goalies/{date}.json`` — every game's projected starters with
  Confirmed / Likely / Unconfirmed, today through +2 days.

Names are matched to NHL ids with the H1 :class:`nhl.match.Matcher`, scoped to
the club's current roster (goalie pages: the club's goalies). A player on the
NHL roster but absent from a *full* lineup (15+ matched players) is a
possible scratch for the next game only — Rinkside's rule.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from nhl.dfo import FULL_LINEUP_MIN_MATCHED, DfoClient, team_url
from nhl.match import Matcher, grp
from nhl.teams import NHL_ABBREVS

SCHEMA_VERSION = 1
GOALIE_DAYS = 3  # today, +1, +2


def _match(matcher: Matcher, name: str, group: str | None) -> int | None:
    groups = [group] if group else ["F", "D", "G"]
    for g in groups:
        hit, _ = matcher.match(name, g)
        if hit:
            return int(hit["id"])
    return None


def team_lineup(
    abbrev: str, page: dict[str, Any], roster: list[dict[str, Any]]
) -> tuple[dict[str, Any], dict[int, dict[str, Any]]]:
    """One club's lineup with NHL ids, plus per-player role entries."""
    matcher = Matcher({p["id"]: p for p in roster})
    ids: dict[str, int | None] = {}

    def nid(name: str, group: str | None) -> int | None:
        if name not in ids:
            ids[name] = _match(matcher, name, group)
        return ids[name]

    def unit(names: list[str], group: str | None) -> list[dict[str, Any]]:
        return [{"name": n, "nhl_id": nid(n, group)} for n in names]

    lines = {str(k): unit(v, "F") for k, v in sorted(page["lines"].items())}
    pairs = {str(k): unit(v, "D") for k, v in sorted(page["pairs"].items())}
    pp = {str(k): unit(v, None) for k, v in sorted(page["pp"].items())}
    pk = {str(k): unit(v, None) for k, v in sorted(page["pk"].items())}
    goalies = unit(page["goalies"], "G")
    injuries = {n: s for n, s in page["injuries"].items()}
    listed_ids = {i for n in page["listed"] if (i := nid(n, None)) is not None}
    injured_ids = {i for n in injuries if (i := nid(n, None)) is not None}
    full = len(listed_ids) >= FULL_LINEUP_MIN_MATCHED
    scratches = sorted(
        p["id"] for p in roster
        if full and p["id"] not in listed_ids and p["id"] not in injured_ids
    )

    players: dict[int, dict[str, Any]] = {}

    def entry(pid: int) -> dict[str, Any]:
        return players.setdefault(pid, {
            "team": abbrev, "line": None, "pp": None, "pk": None, "linemates": [],
            "goalie_depth": None, "injury": None, "gtd": False, "possible_scratch": False,
        })

    for n, members in lines.items():
        for m in members:
            if m["nhl_id"] is not None:
                e = entry(m["nhl_id"])
                e["line"] = f"Line {n}"
                e["linemates"] = [o["name"] for o in members if o is not m]
    for n, members in pairs.items():
        for m in members:
            if m["nhl_id"] is not None:
                e = entry(m["nhl_id"])
                e["line"] = f"Pair {n}"
                e["linemates"] = [o["name"] for o in members if o is not m]
    for n, members in pp.items():
        for m in members:
            if m["nhl_id"] is not None and entry(m["nhl_id"])["pp"] is None:
                entry(m["nhl_id"])["pp"] = f"PP{n}"
    for n, members in pk.items():
        for m in members:
            if m["nhl_id"] is not None and entry(m["nhl_id"])["pk"] is None:
                entry(m["nhl_id"])["pk"] = f"PK{n}"
    for depth, g in enumerate(goalies, start=1):
        if g["nhl_id"] is not None:
            entry(g["nhl_id"])["goalie_depth"] = depth
    for name, status in injuries.items():
        if (i := nid(name, None)) is not None:
            entry(i)["injury"] = status
    for name in page.get("gtd") or []:
        if (i := nid(name, None)) is not None:
            entry(i)["gtd"] = True
    # Listed skaters with a unit but no PP spot are explicitly "No PP".
    if full:
        for pid, e in players.items():
            if e["line"] and e["pp"] is None:
                e["pp"] = "No PP"
    for pid in scratches:
        entry(pid)["possible_scratch"] = True

    team = {
        "url": page.get("url") or team_url(abbrev),
        "updated_at": page.get("updated_at"),
        "source": page.get("source"),
        "lines": lines,
        "pairs": pairs,
        "pp": pp,
        "pk": pk,
        "goalies": goalies,
        "ir": unit(page.get("ir") or [], None),
        "injuries": injuries,
        "matched": len(listed_ids),
        "listed": len(page["listed"]),
        "full_lineup": full,
        "possible_scratches": scratches,
    }
    return team, players


def build_lines(
    rosters: dict[str, list[dict[str, Any]]],
    client: DfoClient,
    *,
    errors: list[str],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Fetch and match every club. Failures are recorded, never raised."""
    teams: dict[str, dict[str, Any]] = {}
    players: dict[str, dict[str, Any]] = {}
    for abbrev in NHL_ABBREVS:
        try:
            page = client.team_page(abbrev)
        except Exception as exc:  # noqa: BLE001 - one club never sinks the rest
            errors.append(f"dfo {abbrev}: {exc}")
            continue
        if not page.get("listed"):
            errors.append(f"dfo {abbrev}: no lineup found on the page")
            continue
        team, entries = team_lineup(abbrev, page, rosters.get(abbrev) or [])
        teams[abbrev] = team
        players.update({str(pid): {**e, "team_url": team["url"]} for pid, e in entries.items()})
    return teams, players


def build_starting_goalies(
    client: DfoClient,
    goalies_by_team: dict[str, list[dict[str, Any]]],
    start: dt.date,
    *,
    days: int = GOALIE_DAYS,
    errors: list[str],
) -> dict[str, list[dict[str, Any]]]:
    """``{date: [game]}`` with each projected starter matched to an NHL id."""
    out: dict[str, list[dict[str, Any]]] = {}
    for offset in range(days):
        day = (start + dt.timedelta(days=offset)).isoformat()
        try:
            games = client.goalie_page(day)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"dfo goalies {day}: {exc}")
            continue
        for game in games:
            for side in ("home", "away"):
                g = game[f"{side}_goalie"]
                pool = goalies_by_team.get(game[side]) or []
                g["nhl_id"] = (
                    _match(Matcher({p["id"]: p for p in pool}), g["name"], "G")
                    if g["name"] else None
                )
        out[day] = games
    return out


def goalie_starts_index(by_date: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    """``{nhl_id: {date: {status, opp, home}}}`` for goalies named as starters."""
    out: dict[str, dict[str, Any]] = {}
    for day, games in sorted(by_date.items()):
        for game in games:
            for side, other in (("home", "away"), ("away", "home")):
                g = game[f"{side}_goalie"]
                if g.get("nhl_id") is None:
                    continue
                out.setdefault(str(g["nhl_id"]), {})[day] = {
                    "status": g["status"], "opp": game[other], "home": side == "home",
                }
    return out


def rosters_by_team(nhl_players: dict[int, dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for p in nhl_players.values():
        if p.get("team") and not p.get("_from_search"):
            out.setdefault(p["team"], []).append(p)
    return out


def goalies_by_team(rosters: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    return {t: [p for p in ps if grp(p.get("pos")) == "G"] for t, ps in rosters.items()}


def lines_document(header: dict[str, Any], teams: dict[str, Any], players: dict[str, Any],
                   starts: dict[str, Any], errors: list[str]) -> dict[str, Any]:
    return {
        **header,
        "schema_version": SCHEMA_VERSION,
        "source": "dailyfaceoff.com",
        "teams": teams,
        "players": players,
        "goalie_starts": starts,
        "errors": list(errors),
    }


def goalie_documents(header: dict[str, Any], by_date: dict[str, list[dict[str, Any]]],
                     errors: list[str]) -> dict[str, dict[str, Any]]:
    """``starting_goalies/{date}`` documents keyed by artifact name."""
    return {
        f"starting_goalies/{day}": {
            **header,
            "schema_version": SCHEMA_VERSION,
            "source": "dailyfaceoff.com",
            "date": day,
            "games": games,
            "errors": list(errors),
        }
        for day, games in by_date.items()
    }
