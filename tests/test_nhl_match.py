"""ESPN → NHL matcher (HOCKEY-PORT.md H1) — ported Rinkside rules."""

from __future__ import annotations

import pytest

from nhl.match import Matcher, grp, norm, pick_search_hit


def player(pid, first, last, pos="C", team="TOR"):
    return {"id": pid, "first": first, "last": last, "pos": pos, "team": team}


POOL = {
    1: player(1, "J.T.", "Miller", "C", "VAN"),
    2: player(2, "Tim", "Stützle", "C", "OTT"),
    3: player(3, "Sebastian", "Aho", "C", "CAR"),
    4: player(4, "Sebastian", "Aho", "D", "NYI"),
    5: player(5, "Elias", "Pettersson", "C", "VAN"),
    6: player(6, "Elias", "Pettersson", "D", "VAN"),
    7: player(7, "Alex", "Wennberg", "C", "SJS"),
    8: player(8, "Alex", "Smith", "L", "DAL"),
    9: player(9, "Alex", "Smith", "L", "EDM"),
    10: player(10, "Mitchell", "Marner", "R", "VGK"),
    11: player(11, "Martin", "Necas", "C", "COL"),
    12: player(12, "Trevor", "Zegras", "C", "PHI"),
    13: player(13, "Matthew", "Tkachuk", "L", "FLA"),
    14: player(14, "Kirill", "Kaprizov", "L", "MIN"),
    15: player(15, "Pierre-Luc", "Dubois", "C", "WSH"),
    16: player(16, "Peter", "Rogers", "L", "CGY"),
    17: player(17, "Michael", "Matheson", "D", "MTL"),
    18: player(18, "Jordan", "Staal", "C", "CAR"),
}


@pytest.fixture(scope="module")
def matcher():
    return Matcher(POOL)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Tim Stützle", "tim stutzle"),
        ("J.T. Miller", "jt miller"),
        ("Pierre-Luc Dubois", "pierre luc dubois"),
        ("Ryan O'Reilly", "ryan oreilly"),
        ("Joe Veleno Jr.", "joe veleno"),
        (None, ""),
    ],
)
def test_norm(raw, expected):
    assert norm(raw) == expected


@pytest.mark.parametrize(
    ("pos", "group"),
    [("C", "F"), ("L", "F"), ("LW", "F"), ("F", "F"), ("Center", "F"), ("Left Wing", "F"),
     ("D", "D"), ("Defense", "D"), ("G", "G"), ("Goalie", "G"), (None, "F")],
)
def test_grp(pos, group):
    assert grp(pos) == group


def test_full_name_match(matcher):
    hit, method = matcher.match("Kirill Kaprizov", "F")
    assert hit["id"] == 14 and method == "name"


def test_accents_and_punctuation(matcher):
    assert matcher.match("Tim Stutzle", "F")[0]["id"] == 2
    assert matcher.match("JT Miller", "F")[0]["id"] == 1
    assert matcher.match("Pierre Luc Dubois", "F")[0]["id"] == 15


def test_position_group_breaks_same_name(matcher):
    # Two Sebastian Ahos: a forward (CAR) and a defenseman (NYI).
    assert matcher.match("Sebastian Aho", "F")[0]["id"] == 3
    assert matcher.match("Sebastian Aho", "D")[0]["id"] == 4
    # Two Elias Petterssons on the same team, different groups.
    assert matcher.match("Elias Pettersson", "D")[0]["id"] == 6


def test_team_breaks_same_name_and_group(matcher):
    # espn-api reports full team names; fixtures use ESPN short codes.
    assert matcher.match("Alex Smith", "F", "Edmonton Oilers")[0]["id"] == 9
    assert matcher.match("Alex Smith", "F", "DAL")[0]["id"] == 8


def test_ambiguous_without_team_is_unmatched(matcher):
    assert matcher.match("Alex Smith", "F") == (None, None)
    assert matcher.match("Alex Smith", "F", "Unknown Team") == (None, None)


def test_first_initial_last_name(matcher):
    hit, method = matcher.match("Mitch Marner", "F")
    assert hit["id"] == 10 and method == "initial_last"
    # Same last name, wrong initial → no match.
    assert matcher.match("Nick Necas", "F") == (None, None)


def test_same_initial_different_first_name_is_not_a_match(matcher):
    # The real Patrick Rogers is off every NHL roster; Peter Rogers is not him.
    assert matcher.match("Patrick Rogers", "F", "EDM") == (None, None)
    assert matcher.match("Patrick Rogers", "F") == (None, None)
    # Brothers: Jared Staal must not resolve to Jordan without a team agreeing.
    assert matcher.match("Jared Staal", "F") == (None, None)


def test_nickname_needs_the_espn_team_to_agree(matcher):
    hit, method = matcher.match("Mike Matheson", "D", "Montréal Canadiens")
    assert hit["id"] == 17 and method == "initial_last"
    assert matcher.match("Mike Matheson", "D") == (None, None)
    assert matcher.match("Mike Matheson", "D", "TOR") == (None, None)


def test_group_mismatch_falls_back_to_any_group_for_full_name(matcher):
    # ESPN lists a forward the NHL calls a defenseman: full-name still resolves.
    assert matcher.match("Trevor Zegras", "D")[0]["id"] == 12


def test_no_match(matcher):
    assert matcher.match("Nobody Atall", "F") == (None, None)
    assert matcher.match("", "F") == (None, None)


def test_pick_search_hit_exact_name_and_group():
    hits = [
        {"playerId": 1, "name": "Casey Unsigned", "positionCode": "C", "teamAbbrev": None,
         "lastTeamAbbrev": "VGK"},
        {"playerId": 2, "name": "Casey Unsigned", "positionCode": "D", "teamAbbrev": "SEA"},
        {"playerId": 3, "name": "Casey Unsignedson", "positionCode": "C"},
    ]
    assert pick_search_hit(hits, "Casey Unsigned", "F")["playerId"] == 1
    assert pick_search_hit(hits, "Casey Unsigned", "D")["playerId"] == 2
    assert pick_search_hit(hits, "Casey Unsigned", "G") is None


def test_pick_search_hit_team_breaks_ties_via_last_team():
    hits = [
        {"playerId": 1, "name": "Pat Twin", "positionCode": "C", "lastTeamAbbrev": "VGK"},
        {"playerId": 2, "name": "Pat Twin", "positionCode": "L", "teamAbbrev": "BOS"},
    ]
    assert pick_search_hit(hits, "Pat Twin", "F") is None
    assert pick_search_hit(hits, "Pat Twin", "F", "Vegas Golden Knights")["playerId"] == 1
    assert pick_search_hit(hits, "Pat Twin", "F", "BOS")["playerId"] == 2
