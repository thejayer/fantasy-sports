"""H2b backtest (HOCKEY-PORT.md) on a tiny synthetic NHL — fully offline."""

from __future__ import annotations

import json
import re
from dataclasses import replace

import pytest

from nhl.backtest import (
    BacktestData,
    CachedFetch,
    Sample,
    build_season_samples,
    checkpoint_date,
    decide,
    evaluate,
    metrics,
    objective,
    prev_season,
    report_markdown,
    run_backtest,
    spearman,
    tune,
)
from nhl.nhl_api import STATS, NHLClient
from nhl.value import DEFAULT_CONFIG

SJ = {"G": 2, "A": 1, "SOG": 0.5, "W": 4, "L": -2, "GA": -2, "SV": 0.35, "SO": 3}
SEASONS = ["20192020", "20202021", "20212022", "20222023", "20232024"]


def skater_row(pid, gp, g, a, sog, team="TOR"):
    return {"playerId": pid, "gamesPlayed": gp, "goals": g, "assists": a, "ppGoals": 0,
            "ppPoints": 0, "shGoals": 0, "shPoints": 0, "gameWinningGoals": 0, "shots": sog,
            "teamAbbrevs": team}


def fake_nhl(url, params=None):
    """Three players: a steady forward, a rookie D (no history), a TOR starter."""
    params = params or {}
    if url == f"{STATS}/season":
        return {"data": [{"id": int(s), "numberOfGames": 56 if s == "20202021" else 82,
                          "startDate": f"{s[:4]}-10-10T00:00:00",
                          "regularSeasonEndDate": f"{s[4:]}-04-15T00:00:00"} for s in SEASONS]}
    if url.startswith(f"{STATS}/"):
        kind, report = url[len(STATS) + 1:].split("/")
        cay = params.get("cayenneExp", "")
        season = re.search(r"seasonId=(\d{8})", cay)
        sid = season.group(1) if season else None
        in_season = sid == "20232024" or sid is None  # date ranges all fall in 2023-24
        if report == "bios":
            if kind == "skater":
                return {"data": [
                    {"playerId": 1, "skaterFullName": "Steady Forward", "positionCode": "C",
                     "birthDate": "1997-01-01", "draftOverall": 20},
                    {"playerId": 2, "skaterFullName": "Rookie D", "positionCode": "D",
                     "birthDate": "2004-01-01", "draftOverall": 5},
                ]}
            return {"data": [{"playerId": 3, "goalieFullName": "Tor Starter",
                              "birthDate": "1995-01-01"}]}
        if kind == "skater" and report == "summary":
            rows = [skater_row(1, 30 if sid is None else 80, 10 if sid is None else 25,
                               10 if sid is None else 30, 60 if sid is None else 160)]
            if in_season:
                rows.append(skater_row(2, 30 if sid is None else 70, 3, 9, 40))
            return {"data": rows}
        if kind == "skater" and report == "realtime":
            return {"data": [{"playerId": 1, "hits": 20, "blockedShots": 10}]}
        if kind == "skater" and report == "timeonice":
            return {"data": [
                {"playerId": 1, "gamesPlayed": 30, "timeOnIcePerGame": 1100,
                 "evTimeOnIcePerGame": 900, "ppTimeOnIcePerGame": 150, "teamAbbrevs": "TOR"},
            ]}
        if kind == "goalie" and report == "summary":
            return {"data": [{"playerId": 3, "gamesPlayed": 30 if sid is None else 55,
                              "gamesStarted": 28 if sid is None else 52, "wins": 15, "losses": 10,
                              "goalsAgainst": 70, "saves": 800, "shutouts": 2,
                              "teamAbbrevs": "TOR"}]}
        return {"data": []}
    if url.endswith("/player/2/landing"):
        return {"birthDate": "2004-01-01", "position": "D",
                "draftDetails": {"year": 2022, "round": 1, "pickInRound": 5, "overallPick": 5},
                "seasonTotals": [{"season": 20222023, "gameTypeId": 2, "leagueAbbrev": "OHL",
                                  "teamName": {"default": "Juniors"}, "gamesPlayed": 60,
                                  "goals": 20, "assists": 40, "points": 60}]}
    raise AssertionError(url)


def test_prev_season_and_checkpoint_dates():
    assert prev_season("20232024") == "20222023"
    assert prev_season("20232024", 3) == "20202021"
    assert str(checkpoint_date("20232024", "dec1")) == "2023-12-01"
    assert str(checkpoint_date("20232024", "feb1")) == "2024-02-01"
    assert checkpoint_date("20232024", "preseason") is None


def test_samples_use_only_data_available_at_each_checkpoint():
    data = BacktestData(NHLClient(fetch=fake_nhl, throttle=0.0))
    out = build_season_samples(data, "20232024", SJ)
    by = {(s.checkpoint, s.nhl_id): s for s in out.values}
    pre = by[("preseason", 1)]
    assert "season_stats" not in pre.row and "trailing_stats" not in pre.row
    assert [h["season"] for h in pre.ctx["history"]] == ["20222023", "20212022", "20202021"]
    # Actual = the full 2023-24 line: (25*2 + 30 + 160*0.5) / 80 GP
    assert pre.actual_fpg == pytest.approx(160 / 80)
    dec = by[("dec1", 1)]
    assert dec.row["season_stats"]["GP"] == 30
    assert set(dec.row["trailing_stats"]) == {"7", "15", "30"}
    assert dec.ctx["role"]["line"] == "Line 1"
    rookie = by[("preseason", 2)]
    assert rookie.ctx["history"] == [] and rookie.ctx["draft"]["overall"] == 5
    assert rookie.ctx["minors"][0]["league"] == "OHL"
    goalie = by[("dec1", 3)]
    assert goalie.group == "G" and goalie.ctx["goalie"]["start_share"] == 1.0
    # Durability: the established forward and the goalie; never the rookie.
    assert sorted(d.nhl_id for d in out.durability) == [1, 3]
    fwd = next(d for d in out.durability if d.nhl_id == 1)
    assert fwd.history_games == {1: 82, 2: 82, 3: 56}  # COVID season length carried
    assert fwd.actual_share == pytest.approx(80 / 82)


def test_metrics_and_spearman():
    m = metrics([(2.0, 1.0, 10), (1.0, 1.0, 30)])
    assert m["n"] == 2 and m["mae"] == 0.25 and m["bias"] == 0.25
    assert m["rmse"] == pytest.approx(0.5)
    assert metrics([])["mae"] is None
    assert spearman([1, 2, 3, 4], [10, 20, 30, 40]) == 1.0
    assert spearman([1, 2, 3, 4], [40, 30, 20, 10]) == -1.0
    assert spearman([1, 1, 2], [1, 2, 3]) == pytest.approx(0.866, abs=1e-3)
    assert spearman([1, 2], [1, 2]) is None


def _synthetic(season: str, n: int = 12) -> list[Sample]:
    """History says 1.0/G, the season so far says 2.0/G, and 2.0/G is what happened."""
    out = []
    for i in range(n):
        row = {"position": "C", "season_stats": {"GP": 30, "G": 20 + i % 3, "A": 20}}
        ctx = {"group": "F", "position": "C", "birth_date": "1997-01-01",
               "history": [{"season": prev_season(season), "GP": 80, "G": 20, "A": 40}]}
        actual = (2 * (20 + i % 3) + 20) / 30
        out.append(Sample(season, "dec1", i, "F", row, ctx, actual_fpg=actual, actual_gp=40))
    return out


def test_tuning_moves_weight_toward_the_input_that_predicts():
    samples = _synthetic("20232024")
    default = objective(samples, SJ, DEFAULT_CONFIG)
    tuned, score = tune(samples, SJ, rounds=3)
    assert score < default
    assert tuned.season_base >= DEFAULT_CONFIG.season_base
    assert evaluate(samples, SJ, tuned)["overall"]["mae"] == pytest.approx(score)
    # role adjustment off leaves value unchanged when there is no role
    assert objective(samples, SJ, replace(DEFAULT_CONFIG, role_adjust=False)) == default


def test_decide_requires_held_out_gain_in_most_seasons():
    good = [{"default_mae": 1.0, "tuned_mae": 0.95}] * 4
    assert decide(good)["adopt"] is True
    tiny = [{"default_mae": 1.0, "tuned_mae": 0.99}] * 4
    assert decide(tiny)["adopt"] is False
    lopsided = [{"default_mae": 1.0, "tuned_mae": 0.7}] + [{"default_mae": 1.0, "tuned_mae": 1.01}] * 3
    assert decide(lopsided)["adopt"] is False
    assert decide([])["adopt"] is False


def test_cached_fetch_serves_repeats_from_disk(tmp_path):
    calls = []

    def inner(url, params=None):
        calls.append(url)
        return {"data": [1]}

    fetch = CachedFetch(tmp_path, inner)
    assert fetch("u", {"a": 1}) == {"data": [1]}
    assert fetch("u", {"a": 1}) == {"data": [1]}
    assert fetch("u", {"a": 2}) == {"data": [1]}
    assert calls == ["u", "u"] and fetch.hits == 1 and fetch.misses == 2
    assert len(list(tmp_path.glob("*.json"))) == 2


def test_run_backtest_end_to_end_report():
    report = run_backtest(NHLClient(fetch=fake_nhl, throttle=0.0), SJ, ["20232024"])
    assert report["seasons"] == ["20232024"]
    assert report["default"]["eval"]["overall"]["n"] > 0
    assert set(report["durability"]["by_pull"]) == {"0.0", "0.2", "0.4", "0.6", "0.8"}
    json.dumps(report)  # serializable
    text = report_markdown(report)
    assert "## Leave-one-season-out" in text and "| `recent` |" in text
    assert "ESPN-projection" in text
