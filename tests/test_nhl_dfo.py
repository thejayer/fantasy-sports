"""Daily Faceoff lineups + starting goalies (HOCKEY-PORT.md H4) — offline, synthetic pages."""

from __future__ import annotations

import datetime as dt
import json

import pytest

from nhl.dfo import (
    DfoClient,
    dfo_sync_enabled,
    parse_goalie_page,
    parse_team_page,
    team_slug,
    team_url,
)
from nhl.lineups import (
    build_lines,
    build_starting_goalies,
    goalie_starts_index,
    team_lineup,
)


def page(props: dict) -> str:
    return ('<html><script id="__NEXT_DATA__" type="application/json">'
            + json.dumps({"props": {"pageProps": props}}) + "</script></html>")


def player(name, group, injury=None, gtd=False):
    return {"name": name, "groupIdentifier": group, "injuryStatus": injury,
            "gameTimeDecision": gtd}


FORWARDS = [f"Fwd {c}" for c in "ABCDEFGHIJKL"]
DEFENSE = [f"Dman {c}" for c in "MNOPQR"]
GOALIES = ["Goalie One", "Goalie Two"]


def full_team_page(extra=()):
    rows = [player(n, f"f{i // 3 + 1}") for i, n in enumerate(FORWARDS)]
    rows += [player(n, f"d{i // 2 + 1}") for i, n in enumerate(DEFENSE)]
    rows += [player(n, "g") for n in GOALIES]
    rows += [player(n, "pp1") for n in FORWARDS[:4] + DEFENSE[:1]]
    rows += [player(n, "pp2") for n in FORWARDS[4:8] + DEFENSE[1:2]]
    rows += [player(n, "pk1") for n in FORWARDS[8:10] + DEFENSE[2:4]]
    rows += [player("Hurt Guy", "ir", "out")]
    rows[2]["injuryStatus"] = "dtd"
    rows[5]["gameTimeDecision"] = "True"
    rows += list(extra)
    return page({"combinations": {"teamAbbreviation": "TOR", "sourceName": "DFO Projections",
                                  "updatedAt": "2026-10-06T18:00:00.000Z", "players": rows}})


def roster():
    out, pid = [], 100
    for n in FORWARDS + ["Extra Forward"]:
        first, last = n.split(" ")
        out.append({"id": pid, "first": first, "last": last, "pos": "C", "team": "TOR"})
        pid += 1
    for n in DEFENSE:
        first, last = n.split(" ")
        out.append({"id": pid, "first": first, "last": last, "pos": "D", "team": "TOR"})
        pid += 1
    for n in GOALIES + ["Hurt Guy"]:
        first, last = n.split(" ")
        out.append({"id": pid, "first": first, "last": last,
                    "pos": "G" if n in GOALIES else "C", "team": "TOR"})
        pid += 1
    return out


# --- slugs ---------------------------------------------------------------------
@pytest.mark.parametrize(("name", "slug"), [
    ("Montréal Canadiens", "montreal-canadiens"),
    ("St. Louis Blues", "st-louis-blues"),
    ("Toronto Maple Leafs", "toronto-maple-leafs"),
])
def test_team_slug(name, slug):
    assert team_slug(name) == slug


def test_team_url():
    assert team_url("TOR").endswith("/teams/toronto-maple-leafs/line-combinations")
    assert team_url("XYZ") is None


# --- team page -----------------------------------------------------------------
def test_parse_team_page_next_data():
    t = parse_team_page(full_team_page())
    assert t["lines"][1] == FORWARDS[:3] and t["lines"][4] == FORWARDS[9:12]
    assert t["pairs"][3] == DEFENSE[4:6]
    assert t["pp"][1] == FORWARDS[:4] + DEFENSE[:1]
    assert t["pk"][1] == FORWARDS[8:10] + DEFENSE[2:4]
    assert t["goalies"] == GOALIES
    assert t["ir"] == ["Hurt Guy"]
    assert t["injuries"] == {"Fwd C": "dtd", "Hurt Guy": "out"}
    assert t["gtd"] == ["Fwd F"]
    assert len(t["listed"]) == 20
    assert t["updated_at"] == "2026-10-06T18:00:00.000Z"
    assert t["source"] == "DFO Projections"


def test_parse_team_page_section_fallback():
    link = '<a href="/players/news/{s}/1">{n}</a>'
    html = ("<h1>Line Combinations</h1><h2>Forwards</h2>"
            + "".join(link.format(s=n.lower().replace(" ", "-"), n=n) for n in FORWARDS[:6])
            + "<h2>Defensive Pairings</h2>"
            + "".join(link.format(s=n.lower().replace(" ", "-"), n=n) for n in DEFENSE[:2])
            + "<h2>1st Powerplay Unit</h2>"
            + "".join(link.format(s=n.lower().replace(" ", "-"), n=n) for n in FORWARDS[:5]))
    t = parse_team_page(html)
    assert t["lines"] == {1: FORWARDS[:3], 2: FORWARDS[3:6]}
    assert t["pairs"] == {1: DEFENSE[:2]}
    assert t["pp"][1] == FORWARDS[:5]
    assert t["source"] == "page sections"


def test_parse_team_page_nothing():
    t = parse_team_page("<html>no lineup here</html>")
    assert t["listed"] == [] and t["source"] is None


# --- lineup matching --------------------------------------------------------------
def test_team_lineup_roles_linemates_and_scratches():
    team, players = team_lineup("TOR", parse_team_page(full_team_page()), roster())
    by_name = {p["first"] + " " + p["last"]: p["id"] for p in roster()}
    a = players[by_name["Fwd A"]]
    assert (a["line"], a["pp"], a["pk"]) == ("Line 1", "PP1", None)
    assert a["linemates"] == ["Fwd B", "Fwd C"]
    assert players[by_name["Fwd I"]]["pk"] == "PK1"
    assert players[by_name["Fwd L"]]["pp"] == "No PP"  # full lineup, no unit
    assert players[by_name["Dman M"]]["line"] == "Pair 1"
    assert players[by_name["Dman M"]]["pp"] == "PP1"
    assert players[by_name["Goalie Two"]]["goalie_depth"] == 2
    assert players[by_name["Fwd C"]]["injury"] == "dtd"
    assert players[by_name["Fwd F"]]["gtd"] is True
    assert team["full_lineup"] is True and team["matched"] == 20
    # On the roster, not listed, not injured → possible scratch next game.
    assert team["possible_scratches"] == [by_name["Extra Forward"]]
    assert players[by_name["Extra Forward"]]["possible_scratch"] is True
    assert players[by_name["Hurt Guy"]]["possible_scratch"] is False


def test_partial_lineup_never_flags_scratches():
    rows = [player(n, f"f{i // 3 + 1}") for i, n in enumerate(FORWARDS[:6])]
    html = page({"combinations": {"players": rows}})
    team, players = team_lineup("TOR", parse_team_page(html), roster())
    assert team["full_lineup"] is False and team["possible_scratches"] == []
    assert all(p["pp"] is None for p in players.values())  # no "No PP" guess either


def test_build_lines_records_failures():
    def fetch(url):
        if "toronto" in url:
            return full_team_page()
        if "boston" in url:
            raise RuntimeError("503")
        return "<html></html>"

    errors: list[str] = []
    teams, players = build_lines({"TOR": roster()}, DfoClient(fetch=fetch, throttle=0.0),
                                 errors=errors)
    assert list(teams) == ["TOR"]
    assert "dfo BOS: 503" in errors
    assert any(e.startswith("dfo MTL: no lineup") for e in errors)
    assert all(p["team_url"].endswith("toronto-maple-leafs/line-combinations")
               for p in players.values())


# --- starting goalies ---------------------------------------------------------------
def goalie_page(rows):
    return page({"data": rows, "date": "2026-10-07"})


def test_parse_goalie_page_statuses():
    games = parse_goalie_page(goalie_page([
        {"date": "2026-10-07", "time": "19:00", "homeTeamName": "Toronto Maple Leafs",
         "awayTeamName": "Montréal Canadiens", "homeGoalieName": "Goalie One",
         "homeNewsStrengthName": "Confirmed", "awayGoalieName": "Other Guy",
         "awayNewsStrengthName": None},
        {"date": "2026-10-07", "homeTeamName": "Nowhere FC", "awayTeamName": "Boston Bruins"},
    ]))
    assert len(games) == 1  # unknown clubs skipped
    g = games[0]
    assert (g["home"], g["away"]) == ("TOR", "MTL")
    assert g["home_goalie"]["status"] == "Confirmed"
    assert g["away_goalie"] == {"name": "Other Guy", "status": "Unconfirmed", "news": None,
                                "news_at": None}
    assert parse_goalie_page(goalie_page([])) == []


def test_starting_goalies_match_and_index():
    def fetch(url):
        day = url.rsplit("/", 1)[1]
        if day == "2026-10-08":
            raise RuntimeError("timeout")
        return goalie_page([{"date": day, "homeTeamName": "Toronto Maple Leafs",
                             "awayTeamName": "Boston Bruins", "homeGoalieName": "Goalie Two",
                             "homeNewsStrengthName": "Likely", "awayGoalieName": None}])

    goalies = {"TOR": [p for p in roster() if p["pos"] == "G"]}
    errors: list[str] = []
    by_date = build_starting_goalies(DfoClient(fetch=fetch, throttle=0.0), goalies,
                                     dt.date(2026, 10, 7), errors=errors)
    assert sorted(by_date) == ["2026-10-07", "2026-10-09"]
    assert errors == ["dfo goalies 2026-10-08: timeout"]
    starter = by_date["2026-10-07"][0]["home_goalie"]
    two = next(p["id"] for p in roster() if p["last"] == "Two")
    assert starter["nhl_id"] == two and starter["status"] == "Likely"
    assert by_date["2026-10-07"][0]["away_goalie"]["nhl_id"] is None
    index = goalie_starts_index(by_date)
    assert index[str(two)]["2026-10-09"] == {"status": "Likely", "opp": "BOS", "home": True}


def test_client_pauses_between_pages(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr("nhl.dfo.time.sleep", sleeps.append)
    client = DfoClient(fetch=lambda url: "x", throttle=1.5)
    client.get("a")
    client.get("b")
    client.get("c")
    assert sleeps == [1.5, 1.5] and client.calls == 3


def test_dfo_sync_flag(monkeypatch):
    assert dfo_sync_enabled() is False  # conftest keeps pytest offline
    monkeypatch.setenv("SJ_DFO_SYNC", "1")
    assert dfo_sync_enabled() is True
