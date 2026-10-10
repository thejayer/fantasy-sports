"""Bet tracker ingest + KPI math (roadmap P.11). Offline — no Sheets API."""

from __future__ import annotations

import json
from pathlib import Path

from sj.bets import (
    american_to_decimal,
    bettor_kpis,
    classify_parlay,
    dollar_pl,
    export_bets,
    filter_bets,
    in_window,
    load_local_rows,
    normalize_row,
    normalize_who,
    parse_odds,
    units_pl,
    window_date,
)
from sj.store import FileStore

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "bets"
XLSX = FIXTURES / "trent_steve_bet_tracker.xlsx"
SAMPLE = FIXTURES / "sample40.json"


def test_parse_odds_american_decimal_and_blank():
    label, dec = parse_odds("+770")
    assert label == "+770"
    assert dec == 8.7
    label, dec = parse_odds("-110")
    assert label == "-110"
    assert dec is not None and abs(dec - american_to_decimal(-110)) < 1e-9
    label, dec = parse_odds("not shown")
    assert label is None and dec is None
    label, dec = parse_odds("", 10.0)
    assert label is None and dec == 10.0
    label, dec = parse_odds("1.91")
    assert dec == 1.91


def test_who_aliases():
    assert normalize_who("Trent Attyah") == "Trent"
    assert normalize_who("@BookitWithTrent") == "Trent"
    assert normalize_who("Steve Will Do It") == "Steve"


def test_dollar_pl_stake_win_loss_push_and_units_only():
    win = {
        "res": "W",
        "stake": 100,
        "dec": 2.0,
        "odds": "+100",
    }
    assert dollar_pl(win) == 100.0
    assert dollar_pl({**win, "res": "L"}) == -100.0
    assert dollar_pl({**win, "res": "Push"}) == 0.0
    assert dollar_pl({**win, "res": "Pending"}) is None
    assert dollar_pl({"res": "W", "units": 5, "dec": 2.0}) is None


def test_units_pl_needs_odds_on_a_win():
    win = {"res": "W", "units": 10, "odds": "+100", "dec": 2.0}
    assert units_pl(win) == 10.0
    assert units_pl({**win, "res": "L"}) == -10.0
    assert units_pl({"res": "W", "units": 10, "odds": "not shown"}) is None


def test_record_win_pct_roi_excludes_pending_unknown():
    rows = [
        {"who": "Trent", "res": "W", "stake": 100, "dec": 2.0, "gd": "2026-09-10"},
        {"who": "Trent", "res": "L", "stake": 100, "dec": 2.0, "gd": "2026-09-10"},
        {"who": "Trent", "res": "Push", "stake": 50, "dec": 2.0, "gd": "2026-09-10"},
        {"who": "Trent", "res": "Pending", "stake": 200, "dec": 2.0, "gd": "2026-09-10"},
        {"who": "Trent", "res": "Unknown", "stake": 200, "dec": 2.0, "gd": "2026-09-10"},
    ]
    kpi = bettor_kpis(rows, "Trent")
    assert kpi["record"] == "1-1-1"
    assert kpi["win_pct"] == 0.5
    assert kpi["pl"] == 0.0
    assert kpi["roi"] == 0.0
    assert kpi["pending"] == 1
    assert kpi["unknown"] == 1
    assert kpi["bets"] == 5


def test_windows_use_game_date_then_posted():
    cfb = {"gd": "2026-08-27", "posted": "2026-08-01 12:00:00"}
    pre = {"gd": "2026-08-26", "posted": "2026-08-26 12:00:00"}
    posted_only = {"gd": None, "posted": "2026-09-09 08:00:00"}
    assert in_window(cfb, "cfb")
    assert not in_window(pre, "cfb")
    assert in_window(posted_only, "nfl")
    when, basis = window_date(cfb)
    assert when is not None and when.isoformat() == "2026-08-27"
    assert basis == "game"
    _when, basis = window_date(posted_only)
    assert basis == "posted"


def test_parlay_classification():
    assert classify_parlay({"n": 1, "bt": "ML"}) == "single"
    assert classify_parlay({"n": 4, "bt": "parlay"}) == "multi"
    assert classify_parlay({"n": None, "bt": "SGP", "ps": ""}) == "multi"
    assert classify_parlay({"n": 4, "bt": "PrizePicks/DFS"}) == "multi"
    assert classify_parlay({"n": 1, "bt": "PrizePicks/DFS"}) == "single"


def test_sample40_normalizes_and_trent_has_units_only_rows():
    bets = load_local_rows(SAMPLE)
    assert len(bets) == 40
    assert {b["who"] for b in bets} <= {"Trent", "Steve"}
    units_only = [
        b
        for b in bets
        if b["who"] == "Trent" and b["units"] is not None and b["stake"] is None
    ]
    assert units_only
    # Dollar P/L skips units-only slips; unit P/L still prices a loss.
    lost = next(b for b in units_only if b["res"] == "L")
    assert dollar_pl(lost) is None
    assert units_pl(lost) == -float(lost["units"])


def test_xlsx_fixture_round_trip(tmp_path: Path):
    bets = load_local_rows(XLSX)
    assert len(bets) >= 500
    assert sum(1 for b in bets if b["who"] == "Trent") > 200
    assert sum(1 for b in bets if b["who"] == "Steve") > 200
    result = export_bets(from_path=XLSX, store_dir=tmp_path)
    store = FileStore(tmp_path)
    loaded = store.read_bets("bets")
    assert loaded is not None
    assert loaded["bet_count"] == len(bets)
    assert store.read_bets("summary")["trent"]["bets"] == result["summary"]["trent"]["bets"]
    nfl = filter_bets(bets, window="nfl", sport="NFL")
    assert nfl
    assert all(in_window(b, "nfl") for b in nfl)


def test_gamba_row_passthrough():
    raw = json.loads(SAMPLE.read_text(encoding="utf-8"))[0]
    bet = normalize_row(raw)
    assert bet is not None
    assert bet["id"] == "T-578065"
    assert bet["who"] == "Trent"
    assert bet["res"] == "L"
    assert bet["stake"] == 1000.0
    assert dollar_pl(bet) == -1000.0
