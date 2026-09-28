"""H2 player values + H3 durability (HOCKEY-PORT.md) on synthetic players."""

from __future__ import annotations

import datetime as dt
from dataclasses import replace

import pytest

from nhl.aging import age_project, season_age, yearly_change
from nhl.durability import goalie_rate, skater_rate
from nhl.prospects import draft_prior, prospect_fpg
from nhl.roles import skater_roles
from nhl.value import (
    DEFAULT_CONFIG,
    adjust,
    blend,
    build_values,
    data_source,
    part_weight,
    player_value,
    remaining_games,
    value_parts,
)

SJ = {
    "G": 2, "A": 1, "PPG": 1, "PPA": 0.5, "SHG": 1, "SHA": 0.5, "SHP": 0.5, "GWG": 1,
    "HAT": 2, "SOG": 0.5, "HIT": 0.1, "BLK": 0.5,
    "W": 4, "L": -2, "GA": -2, "SV": 0.35, "SO": 3,
}
CUR = "20262027"
AS_OF = dt.date(2026, 10, 20)


def line(gp, g=0, a=0, sog=0):
    """Skater line worth 2g + a + 0.5 sog."""
    return {"GP": gp, "G": g, "A": a, "SOG": sog}


def skater(**row):
    return {"id": 1, "name": "Test Skater", "position": "C", "pro_team": "TOR", **row}


def ctx(**extra):
    return {"nhl_id": 9, "group": "F", "position": "C", "team": "TOR",
            "birth_date": "1998-06-01", "age": 28, "history": [], **extra}


def kinds(parts):
    return [p["kind"] for p in parts]


# --- weights ------------------------------------------------------------------
def test_part_weights_match_the_plan_table_at_recent_half():
    assert part_weight("trailing", 0.15, 1.0, 0.5) == pytest.approx(0.075)
    assert part_weight("season", 0.35, 0.4, 0.5) == pytest.approx(0.14)
    assert part_weight("projection", 0.0, 1.0, 0.5) == pytest.approx(0.30)
    assert part_weight("history", 0.0, 0.5, 0.5) == pytest.approx(0.15)
    assert part_weight("prospect", 0.15, 1.0, 0.5) == pytest.approx(0.15)
    # Recent form 0 ignores trailing windows; 1 halves projection/history weight.
    assert part_weight("trailing", 0.10, 1.0, 0.0) == 0
    assert part_weight("projection", 0.0, 1.0, 1.0) == pytest.approx(0.15)


def test_blend_is_weighted_and_reblends_with_recent_form():
    parts = [
        {"kind": "trailing", "fpg": 4.0, "base": 0.15, "games_factor": 1.0},
        {"kind": "projection", "fpg": 2.0, "base": 0.0, "games_factor": 1.0},
    ]
    assert blend(parts, 0.5) == pytest.approx((4 * 0.075 + 2 * 0.30) / 0.375, abs=1e-3)
    assert blend(parts, 1.0) > blend(parts, 0.5) > blend(parts, 0.0)
    assert blend(parts, 0.0) == pytest.approx(2.0)
    # Every weight zero (trailing only at recent 0): plain mean, not a crash.
    assert blend(parts[:1], 0.0) == 4.0
    assert blend([], 0.5) is None


# --- inputs and zero rules ---------------------------------------------------------
def test_espn_inputs_trailing_season_projection():
    row = skater(
        trailing_stats={"7": line(3, g=2, a=1), "15": line(0)},
        season_stats=line(10, g=5, a=5, sog=30),  # 30 FP / 10 GP
        projected_stats=line(78, g=30, a=40, sog=200),  # 200 FP / 78 GP
    )
    parts, facts = value_parts(row, None, SJ, cur_nhl_season=CUR)
    assert kinds(parts) == ["trailing", "season", "projection"]
    trailing, season, proj = parts
    assert trailing["fpg"] == pytest.approx(5 / 3, abs=1e-3)
    assert trailing["games_factor"] == 1.0  # 3 GP fills the last-7 window
    assert season["fpg"] == 3.0 and season["games_factor"] == 0.25  # 10 / 40 GP (H2b)
    assert trailing["base"] == 0.05  # 0.10 × H2b trailing_scale 0.5
    assert proj["fpg"] == pytest.approx(200 / 78, abs=1e-3)
    assert facts["espn_proj"] == {"total": 200.0, "gp": 78.0, "per_game": pytest.approx(2.564, abs=1e-3)}
    assert facts["cur_gp"] == 10


def test_zero_projection_is_a_gap_but_current_season_zero_is_real():
    row = skater(
        season_stats=line(6),  # six real scoreless games
        projected_stats=line(78),  # ESPN placeholder
    )
    parts, facts = value_parts(row, None, SJ, cur_nhl_season=CUR)
    assert kinds(parts) == ["season"]
    assert parts[0]["fpg"] == 0.0
    assert facts["espn_proj"] == {"total": None, "gp": 78.0, "per_game": None}


def test_projection_without_gp_assumes_a_full_season():
    parts, _ = value_parts(skater(projected_stats={"G": 20, "A": 20}), None, SJ,
                           cur_nhl_season=CUR)
    assert parts[0]["gp"] == 78 and parts[0]["fpg"] == pytest.approx(60 / 78, abs=1e-3)


def test_goalie_negative_projection_is_usable_and_games_can_be_starts():
    row = {"id": 2, "name": "G", "position": "G",
           "projected_stats": {"GS": 50, "W": 10, "L": 35, "GA": 200, "SV": 1000}}
    parts, _ = value_parts(row, None, SJ, cur_nhl_season=CUR)
    # 40 - 70 - 400 + 350 = -80 over 50 starts
    assert parts[0]["kind"] == "projection" and parts[0]["fpg"] == pytest.approx(-1.6)


def test_nhl_current_season_fills_in_when_espn_has_none():
    c = ctx(history=[{"season": CUR, "GP": 8, "G": 4, "A": 4}])
    parts, facts = value_parts(skater(), c, SJ, cur_nhl_season=CUR)
    assert parts[0]["label"] == "this season (NHL)" and parts[0]["fpg"] == 1.5
    assert facts["cur_gp"] == 8


# --- NHL history -----------------------------------------------------------------
def test_history_decays_by_season_and_ignores_gaps():
    c = ctx(birth_date="1990-01-01", history=[
        {"season": "20252026", "GP": 80, "G": 40, "A": 40},  # 1.5 FP/G at 35
        {"season": "20242025", "GP": 40, "G": 10, "A": 20},  # 1.0 FP/G at 34
        {"season": "20232024", "GP": 60, "G": 0, "A": 0},  # zero past season = gap
        {"season": "20222023", "GP": 2, "G": 5},  # under 3 GP
    ])
    parts, facts = value_parts(skater(), c, SJ, cur_nhl_season=CUR)
    (hist,) = parts
    # Carried to age 36: 35→36 is −9%; 34→35→36 is −8% then −9%.
    # Season weights are GP × decay (H2b-tuned 1.0 / 0.5): 80 × 1.0 and 40 × 0.5.
    expected = (1.5 * 0.91 * 80 + 1.0 * 0.92 * 0.91 * 20) / (80 + 20)
    assert hist["fpg"] == pytest.approx(expected, abs=1e-3)
    assert hist["gp"] == 120 and hist["games_factor"] == 1.0
    assert "2 seasons" in hist["label"]
    assert facts["rookie"] is False


def test_aging_curves():
    assert yearly_change(21, "F") == 0.08 and yearly_change(40, "F") == -0.10
    assert yearly_change(15, "G") == 0.05
    assert age_project(1.0, 22, 24, "F") == pytest.approx(1.06 * 1.04)
    assert age_project(None, 22, 24, "F") is None
    assert age_project(1.0, None, 24, "F") == 1.0
    assert season_age("2000-10-02", 2026) == 25
    assert season_age("2000-10-01", 2026) == 26
    assert season_age(None, 2026) is None


# --- rookies / prospects -----------------------------------------------------------
def test_rookie_gets_prospect_estimate():
    c = ctx(birth_date="2006-02-01", prior_nhl_gp=0, draft={"overall": 5},
            minors=[{"season": "20252026", "league": "OHL", "gp": 60, "g": 40, "a": 50, "pts": 90}])
    parts, facts = value_parts(skater(), c, SJ, cur_nhl_season=CUR)
    assert facts["rookie"] is True
    assert kinds(parts) == ["prospect"] and "#5 overall pick" in parts[0]["label"]
    assert 0.5 < parts[0]["fpg"] < 3.0


def test_prospect_math_and_draft_prior():
    assert draft_prior(2, False) == (2.3, 0.8)
    assert draft_prior(8, False) == (1.7, 0.75)
    assert draft_prior(20, False) == (1.35, 0.7)
    assert draft_prior(None, True) == (1.2, 0.7)
    est, why = prospect_fpg([{"season": "20252026", "league": "AHL", "gp": 70, "g": 25,
                              "a": 35, "pts": 60}], birth="2003-01-01", position="C",
                            draft_pick=None, weights=SJ)
    assert est is not None and "AHL 60pts/70gp" in why
    assert prospect_fpg([], birth=None, position="C", draft_pick=None, weights=SJ) == (None, None)
    goalie, why = prospect_fpg([{"season": "20252026", "league": "AHL", "gp": 40,
                                 "sv_pct": 0.915}], birth=None, position="G",
                               draft_pick=None, weights=SJ)
    assert goalie == pytest.approx(0.7 * (4.3 + (0.907 - 0.900) * 28 * 2.35) + 0.3 * 4.3, abs=0.01)
    assert "sv% 0.915" in why


def test_role_estimate_only_when_nothing_else_exists():
    # A veteran (200 prior NHL GP) whose seasons are all gaps: role estimate.
    c = ctx(prior_nhl_gp=200, role={"line": "Line 1", "pp": "PP1", "trend": []})
    parts, facts = value_parts(skater(), c, SJ, cur_nhl_season=CUR)
    assert kinds(parts) == ["role"] and parts[0]["fpg"] == pytest.approx(2.6)
    assert data_source(parts, facts) == "estimate"
    # With no NHL games at all he is treated as a rookie, still on a role estimate.
    parts, facts = value_parts(skater(), ctx(), SJ, cur_nhl_season=CUR)
    assert kinds(parts) == ["role"] and data_source(parts, facts) == "rookie"
    parts, _ = value_parts({"id": 3, "position": "G"}, None, SJ, cur_nhl_season=CUR)
    assert parts[0]["fpg"] == 3.5  # unknown goalie role


# --- role adjustment -------------------------------------------------------------
def test_role_adjustment_is_off_by_default_after_h2b():
    role = {"role": {"line": "Line 1", "pp": "PP1", "trend": []}}
    assert DEFAULT_CONFIG.role_adjust is False
    assert adjust("F", role) == (1.0, [])


def test_adjust_line_pp_trend_and_cap_when_enabled():
    on = replace(DEFAULT_CONFIG, role_adjust=True)
    mult, why = adjust("F", {"role": {"line": "Line 1", "pp": "PP1",
                                      "trend": ["PP time up 1.0 min"]}}, on)
    assert mult == pytest.approx(1.20) and why == ["+top line", "+PP1", "+PP time up 1.0 min"]
    mult, _ = adjust("F", {"role": {"line": "Line 4", "pp": "No PP", "trend": [
        "even-strength time down 2.0 min", "PP time down 1.0 min", "x down", "y down"]}}, on)
    assert mult == 0.75  # capped at −25%
    mult, why = adjust("G", {"goalie": {"role": "Backup"}, "prior_team": "BOS"}, on)
    assert mult == 0.75 and why == ["−backup", "new team (from BOS)"]
    assert adjust("D", None, on) == (1.0, [])


# --- H3 durability -----------------------------------------------------------------
def test_skater_durability():
    d = skater_rate(78, [(82, 1), (80, 2), (82, 3)])
    assert d.iron_man and d.rate >= 0.95
    d = skater_rate(None, [(40, 1), (50, 2)])
    rate_h = (40 / 82 * 1.0 + 50 / 82 * 0.6) / 1.6
    assert d.rate == pytest.approx(0.6 * rate_h + 0.4 * 0.9, abs=1e-3)
    # Injury-riddled: pulled toward 90%, lands just above the 50% floor.
    assert skater_rate(None, [(30, 1), (10, 2), (5, 3)]).rate == pytest.approx(0.502)
    assert skater_rate(20, [(5, 1), (4, 2), (3, 3)]).rate == 0.5  # clamped
    assert skater_rate(None, []).rate == 0.9  # rookies default
    assert skater_rate(10, []).rate == 0.9  # silly ESPN GP ignored
    # one season only counts when it was last season and 60+ GP
    assert skater_rate(None, [(70, 2)]).rate == 0.9


def test_goalie_durability_is_start_share():
    assert goalie_rate(0.62, "this season").rate == 0.62
    assert goalie_rate(None, None).rate == 0.9
    assert goalie_rate(1.2, "x").rate == 1.0


def test_remaining_games_and_ros():
    schedule = {"teams": {"TOR": [{"date": "2026-10-19"}, {"date": "2026-10-20"},
                                  {"date": "2026-10-22"}]}}
    assert remaining_games("TOR", schedule, AS_OF) == 2
    assert remaining_games("MTL", schedule, AS_OF) is None
    assert remaining_games(None, schedule, AS_OF) is None
    row = skater(season_stats=line(25, g=10, a=10, sog=20))  # 40 FP / 25 GP = 1.6
    out = player_value(row, ctx(history=[{"season": "20252026", "GP": 82, "G": 20, "A": 40,
                                          "SOG": 88}]), SJ,
                       cur_nhl_season=CUR, schedule=schedule, as_of=AS_OF)
    assert out["remaining_games"] == 2
    assert out["ros"] == pytest.approx(out["value"] * 2 * out["durability"]["rate"], abs=0.1)
    assert out["source"] == "current"


def test_data_source_labels():
    assert data_source([{"kind": "season"}], {"cur_gp": 5}) == "current"
    assert data_source([{"kind": "history"}], {"cur_gp": 2}) == "history"
    assert data_source([{"kind": "prospect"}], {"rookie": True}) == "rookie"
    assert data_source([{"kind": "season"}], {"rookie": True, "cur_gp": 3}) == "rookie_playing"


# --- whole document ---------------------------------------------------------------
def test_build_values_covers_rostered_free_agents_and_unmatched():
    snapshot = {
        "league_id": "hockey-main", "season": 2027,
        "teams": [{"team_id": 4, "roster": [
            skater(id=11, season_stats=line(20, g=5, a=10)),
            {"id": 12, "name": "Unmatched Guy", "position": "D", "pro_team": "LA",
             "projected_stats": line(70, g=5, a=25, sog=100)},
        ]}],
        "free_agents": [skater(id=13, name="Free Agent", season_stats=line(10, g=1))],
    }
    player_map = {"players": {"11": {"nhl_id": 9}, "13": {"nhl_id": 10}}}
    context = {"players": {"9": ctx(), "10": ctx(nhl_id=10, team="MTL")}}
    schedule = {"teams": {"TOR": [{"date": "2026-11-01"}], "LAK": [{"date": "2026-11-01"}] * 3}}
    doc = build_values(snapshot, player_map=player_map, context=context, schedule=schedule,
                       weights=SJ, scoring_source="espn", as_of=AS_OF, generated_at="x")
    assert set(doc["players"]) == {"11", "12", "13"}
    rostered, unmatched, fa = (doc["players"][k] for k in ("11", "12", "13"))
    assert rostered["fantasy_team_id"] == 4 and rostered["rostered"] is True
    assert unmatched["nhl_id"] is None and unmatched["nhl_team"] == "LAK"
    assert unmatched["remaining_games"] == 3 and unmatched["group"] == "D"
    assert fa["rostered"] is False and fa["nhl_team"] == "MTL" and fa["ros"] is None
    assert doc["recent_default"] == 0.25 and doc["scoring_source"] == "espn"
    assert doc["model"]["role_adjust"] is False


# --- roles from ice time -------------------------------------------------------------
def test_skater_roles_lines_pairs_and_power_play():
    players = {i: {"pos": "C", "team": "TOR"} for i in range(1, 8)}
    players[8] = {"pos": "D", "team": "TOR"}
    players[9] = {"pos": "D", "team": "TOR"}
    players[10] = {"pos": "G", "team": "TOR"}
    season = {i: {"gp": 10, "ev": 20 - i, "pp": (4.0 - 0.5 * i) if i <= 6 else 0.0,
                  "teams": "TOR"} for i in range(1, 8)}
    season[8] = {"gp": 10, "ev": 22, "pp": 3.5, "teams": "TOR"}
    season[9] = {"gp": 10, "ev": 18, "pp": 0.2, "teams": "TOR"}
    recent = {1: {"gp": 4, "ev": 21.0, "pp": 4.0, "teams": "TOR"},
              2: {"gp": 4, "ev": 16.0, "pp": 1.0, "teams": "TOR"}}
    roles = skater_roles(players, recent, season, {})
    assert [roles[i]["line"] for i in (1, 3, 4, 7)] == ["Line 1", "Line 1", "Line 2", "Line 3"]
    assert roles[8]["line"] == "Pair 1" and roles[9]["line"] == "Pair 1"
    assert roles[1]["pp"] == "PP1" and roles[8]["pp"] == "PP1"
    assert roles[6]["pp"] == "PP2" and roles[9]["pp"] == "No PP"
    assert roles[1]["basis"] == "last 14 days" and roles[3]["basis"] == "this season"
    assert roles[1]["trend"] == ["even-strength time up 2.0 min"]
    assert roles[2]["trend"] == ["even-strength time down 2.0 min", "PP time down 2.0 min"]
    assert 10 not in roles


def test_skater_roles_new_team_without_games():
    players = {1: {"pos": "C", "team": "TOR"}}
    roles = skater_roles(players, {}, {}, {1: {"gp": 60, "ev": 15, "pp": 2, "teams": "BOS"}})
    assert roles[1]["basis"] == "new team, no games yet" and roles[1]["line"] is None
