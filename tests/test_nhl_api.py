"""NHL API parsers (HOCKEY-PORT.md H1) over canned responses — fully offline."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from nhl.nhl_api import (
    SEARCH,
    STATS,
    WEB,
    NHLClient,
    age_on,
    parse_club_schedule,
    parse_goalie_lines,
    parse_roster,
    parse_skater_lines,
    parse_team_summary,
    parse_toi_rows,
    prior_season_ids,
    season_id,
    summarize_landing,
)
from nhl.teams import NHL_ABBREVS, last_team, nhl_abbrev

FIXTURES = Path(__file__).parent / "fixtures" / "nhl"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_season_ids_use_hub_end_year():
    assert season_id(2027) == "20262027"
    assert prior_season_ids(2027) == ["20252026", "20242025", "20232024"]


def test_parse_roster_unwraps_localized_names_and_keeps_missing_bio_null():
    players = parse_roster(load("roster_TOR.json"), "TOR")
    by_id = {p["id"]: p for p in players}
    assert len(players) == 5
    assert by_id[9000002]["first"] == "Jean-Luc"
    assert by_id[9000002]["last"] == "Tëstard"
    assert by_id[9000002]["team"] == "TOR"
    assert by_id[9000003]["pos"] == "D"
    # Goalie with no height/weight in the payload: null, never 0.
    assert by_id[9000004]["height"] is None
    assert by_id[9000004]["weight"] is None


def test_parse_roster_ignores_non_dict_payload():
    assert parse_roster(None, "TOR") == []
    assert parse_roster({"forwards": [{"firstName": "no id"}]}, "TOR") == []


def test_parse_toi_rows_minutes_and_skips_zero_gp():
    rows = parse_toi_rows(load("skater_timeonice.json")["data"])
    assert set(rows) == {9000001, 9000003}
    assert rows[9000001] == {
        "gp": 80, "toi": 19.0, "ev": 15.0, "pp": 3.0, "sh": 1.0, "teams": "BOS",
    }


def test_parse_skater_lines_splits_pp_and_sh_assists():
    lines = parse_skater_lines(
        load("skater_summary.json")["data"], load("skater_realtime.json")["data"]
    )
    line = lines[9000001]
    assert (line["G"], line["A"], line["PPG"], line["PPA"]) == (30, 40, 10, 15)
    assert (line["SHG"], line["SHA"], line["SHP"]) == (1, 2, 3)
    assert (line["HIT"], line["BLK"], line["SOG"], line["GWG"]) == (45, 20, 240, 6)
    # Hat tricks are not in the NHL season tables: absent, not zero.
    assert "HAT" not in line
    # realtime rows for unknown players do not create lines
    assert 9999999 not in lines


def test_parse_goalie_lines():
    lines = parse_goalie_lines(load("goalie_summary.json")["data"])
    assert lines[9000004] == {
        "GP": 55, "GS": 52, "W": 30, "L": 15, "GA": 140, "SV": 1400, "SO": 4, "teams": "TOR",
    }


def test_parse_team_summary_maps_names_and_drops_defunct_clubs():
    teams = parse_team_summary(load("team_summary.json")["data"])
    assert set(teams) == {"TOR", "MTL"}
    assert teams["TOR"]["gf"] == 3.4
    assert teams["MTL"]["pp"] is None  # null stays null


def test_parse_club_schedule_regular_season_only_with_back_to_backs():
    games = parse_club_schedule(load("club_schedule_TOR.json"), "TOR")
    assert [g["date"] for g in games] == ["2026-10-07", "2026-10-09", "2026-10-10"]
    assert games[0] == {
        "date": "2026-10-07", "opp": "BOS", "home": True,
        "start": "2026-10-07T23:00:00Z", "b2b": False,
    }
    assert games[1]["opp"] == "MTL" and games[1]["home"] is False
    assert games[1]["b2b"] is True and games[2]["b2b"] is True


def test_summarize_landing_rookie():
    summary = summarize_landing(load("landing_rookie.json"), "20262027")
    assert summary["prior_nhl_gp"] == 4
    assert summary["draft"] == {
        "year": 2024, "round": 1, "pick_in_round": 7, "overall": 7, "team": "TOR",
    }
    # Two most recent non-NHL regular seasons with 10+ GP (AHL 8 GP and playoffs skipped).
    assert [(m["season"], m["league"], m["gp"]) for m in summary["minors"]] == [
        ("20242025", "OHL", 58),
        ("20232024", "OHL", 64),
    ]


def test_age_on_birthday_boundaries():
    assert age_on("2000-10-01", dt.date(2026, 9, 30)) == 25
    assert age_on("2000-10-01", dt.date(2026, 10, 1)) == 26
    assert age_on(None, dt.date(2026, 10, 1)) is None
    assert age_on("not a date", dt.date(2026, 10, 1)) is None


def test_client_routes_and_throttle_counter():
    calls: list[tuple[str, dict | None]] = []

    def fetch(url, params=None):
        calls.append((url, params))
        if url == f"{WEB}/roster/TOR/current":
            return load("roster_TOR.json")
        if url == f"{STATS}/skater/summary":
            return load("skater_summary.json")
        if url == SEARCH:
            # Active search finds nothing; inactive search returns the hits.
            return [] if params.get("active") == "true" else load("search_hits.json")
        raise AssertionError(url)

    client = NHLClient(fetch=fetch, throttle=0.0)
    assert len(client.roster("TOR")) == 5
    rows = client.season_report("skater", "summary", "20252026")
    assert len(rows) == 2
    assert "seasonId=20252026 and gameTypeId=2" in calls[1][1]["cayenneExp"]
    hits = client.search_player("Casey Unsigned")
    assert len(hits) == 2
    assert [c[1].get("active") for c in calls[2:]] == ["true", None]
    assert client.calls == 4


@pytest.mark.parametrize(
    ("espn", "nhl"),
    [
        ("Los Angeles Kings", "LAK"),
        ("LA", "LAK"),
        ("Montréal Canadiens", "MTL"),
        ("Utah Hockey Club", "UTA"),
        ("St. Louis Blues", "STL"),
        ("TB", "TBL"),
        ("NJ", "NJD"),
        ("SJ", "SJS"),
        ("VGK", "VGK"),
        ("Arizona Coyotes", None),
        ("Unknown Team", None),
        (None, None),
        ("", None),
    ],
)
def test_espn_team_to_nhl_abbrev(espn, nhl):
    assert nhl_abbrev(espn) == nhl


def test_every_espn_pro_team_name_maps():
    """espn-api hockey PRO_TEAM_MAP (full names) must resolve, except Arizona."""
    from espn_api.hockey.constant import PRO_TEAM_MAP

    unmapped = {name for name in PRO_TEAM_MAP.values() if nhl_abbrev(name) is None}
    assert unmapped == {"Arizona Coyotes"}
    assert len(NHL_ABBREVS) == 32


def test_last_team():
    assert last_team("TOR,DAL") == "DAL"
    assert last_team("TOR, DAL") == "DAL"
    assert last_team("") is None
    assert last_team(None) is None
