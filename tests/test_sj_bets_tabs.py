"""Multi-tab bet tracker: data-driven bettors, parlay legs, public warnings."""

from __future__ import annotations

from pathlib import Path

import pytest

from sj.bets import (
    FADE_AMERICAN,
    PARLAY_TAB,
    PUBLIC_TAB,
    SHEET_MIME,
    XLSX_MIME,
    bettor_kpis,
    export_bets,
    fade_pl,
    fetch_remote_workbook,
    invert_result,
    list_xlsx_sheets,
    load_local_workbook,
    normalize_row,
    normalize_rows,
    normalize_who,
    strip_value_prefix,
    unique_bettors,
)
from sj.bets_parlay import (
    filter_parlay_legs,
    normalize_parlay_row,
    normalize_parlay_rows,
    ou_bucket,
    parlay_kpis,
)
from sj.bets_public import (
    filter_public_warnings,
    normalize_public_row,
    normalize_public_rows,
    public_kpis,
)
from sj.store import FileStore

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "bets"
TABS = FIXTURES / "tracker_tabs.xlsx"
LEGACY = FIXTURES / "trent_steve_bet_tracker.xlsx"
SAMPLE = FIXTURES / "sample40.json"


def test_strip_value_prefix_blank_and_line():
    assert strip_value_prefix("Value") == ""
    assert strip_value_prefix("Value ") == ""
    assert strip_value_prefix("value") == ""
    assert strip_value_prefix("Value -6.5") == "-6.5"
    assert strip_value_prefix("Value -150 leftover") == "-150 leftover"
    assert strip_value_prefix(-6.5) == -6.5
    assert strip_value_prefix("Over") == "Over"


def test_who_is_data_driven_not_a_closed_list():
    assert normalize_who("btidy216") == "btidy216"
    assert normalize_who("@chellgod") == "chellgod"
    assert normalize_who("@btidy216") == "btidy216"
    assert normalize_who("chellgod") == "chellgod"
    assert normalize_who("Trent Attyah") == "Trent"
    assert normalize_who("@BookitWithTrent") == "Trent"
    names = unique_bettors(
        [
            {"who": "chellgod"},
            {"who": "Trent"},
            {"who": "chellgod"},
            {"who": "btidy216"},
        ]
    )
    assert names == ["chellgod", "btidy216", "Trent"]


def test_fade_pl_assumes_minus_110_on_100():
    assert fade_pl("W") == pytest.approx(100 * (100 / 110))
    assert fade_pl("L") == -100.0
    assert fade_pl("Push") == 0.0
    assert fade_pl("Pending") is None
    assert invert_result("W") == "L"
    assert invert_result("Push") == "Push"
    assert FADE_AMERICAN == -110


def test_tracker_tabs_xlsx_has_four_data_tabs():
    names = list_xlsx_sheets(TABS)
    assert names[0] == "Bets"
    assert PARLAY_TAB in names
    assert PUBLIC_TAB in names
    from sj.bets import RECORD_SPLITS_TAB

    assert RECORD_SPLITS_TAB in names
    book = load_local_workbook(TABS)
    assert set(book) == {"Bets", PARLAY_TAB, PUBLIC_TAB, RECORD_SPLITS_TAB}


def test_export_writes_six_json_files_and_stable_summary_keys(tmp_path: Path):
    result = export_bets(from_path=TABS, store_dir=tmp_path)
    store = FileStore(tmp_path)
    bets = store.read_bets("bets")
    summary = store.read_bets("summary")
    parlays = store.read_bets("parlay_legs")
    warnings = store.read_bets("public_warnings")
    splits = store.read_bets("record_splits")
    tailing = store.read_bets("tailing_legs")
    assert bets is not None and summary is not None
    assert parlays is not None and warnings is not None
    assert splits is not None and tailing is not None
    assert bets["bet_count"] == 12
    assert {b["who"] for b in bets["bets"]} == {
        "Trent",
        "Steve",
        "btidy216",
        "chellgod",
        "Lockedin_Sportz",
    }
    # P.11 keys stay put even though the board is no longer Trent/Steve-only.
    assert "trent" in summary and "steve" in summary and "all" in summary
    assert [row["who"] for row in summary["bettors"]] == [
        "Steve",
        "Trent",
        "btidy216",
        "chellgod",
        "Lockedin_Sportz",
    ]
    assert summary["all"]["bets"] == 12
    assert parlays["leg_count"] == 8
    assert warnings["warning_count"] == 8
    assert result["parlay_legs"]["leg_count"] == 8
    assert splits["split_count"] == result["record_splits"]["split_count"]
    assert any(row["who"] == "Lockedin_Sportz" for row in splits["splits"])
    assert tailing["settled_count"] == result["tailing_legs"]["settled_count"]
    assert tailing["tab"] == PARLAY_TAB
    assert {v["who"] for v in tailing["views"]} >= {"*"}


def test_legacy_xlsx_still_exports_empty_new_tabs(tmp_path: Path):
    result = export_bets(from_path=LEGACY, store_dir=tmp_path)
    assert result["bets"]["bet_count"] >= 500
    assert result["parlay_legs"]["leg_count"] == 0
    assert result["public_warnings"]["warning_count"] == 0
    assert result["record_splits"]["split_count"] == 0
    assert result["tailing_legs"]["settled_count"] == 0
    assert result["summary"]["trent"]["bets"] > 200


def test_json_from_still_bets_only(tmp_path: Path):
    result = export_bets(from_path=SAMPLE, store_dir=tmp_path)
    assert result["bets"]["bet_count"] == 40
    assert result["parlay_legs"]["leg_count"] == 0
    assert result["public_warnings"]["warning_count"] == 0
    assert result["record_splits"]["split_count"] == 0
    assert result["tailing_legs"]["settled_count"] == 0


def test_parlay_strips_value_prefix_and_kpis():
    _headers, rows = load_local_workbook(TABS)[PARLAY_TAB]
    # headers come from the book
    headers, rows = load_local_workbook(TABS)[PARLAY_TAB]
    legs = normalize_parlay_rows(rows, headers)
    lined = next(leg for leg in legs if leg["id"] == "S-P-1")
    assert lined["line"] == "-6.5"
    over = next(leg for leg in legs if leg["id"] == "T-3-2")
    assert over["line"] == "-1.5"
    assert over["ou"] == "Over"
    assert over["pick"] == "Player prop"
    assert over["slot"] == "SNF"
    note = next(leg for leg in legs if leg["id"] == "B-P-2")
    assert note["notes"] == "; note kept"
    kpi = parlay_kpis(legs)
    assert kpi["record"] == "5-3-0"
    assert kpi["fade_record"] == "3-5-0"
    assert kpi["hit_rate"] == 0.625
    assert ou_bucket("Over") == "Over"
    assert ou_bucket("Value") == "—"


def test_parlay_gamba_passthrough_and_fade_fallback():
    row = normalize_parlay_row(
        {
            "id": "X-1",
            "who": "chellgod",
            "res": "W",
            "fade": "",
            "dir": "Under",
            "pick": "Player prop",
        }
    )
    assert row is not None
    assert row["fade"] == "L"
    assert row["ou"] == "Under"


def test_public_kpis_and_fade_pl():
    headers, rows = load_local_workbook(TABS)[PUBLIC_TAB]
    warnings = normalize_public_rows(rows, headers)
    extra = next(w for w in warnings if w["id"] == "MGM-008")
    assert extra["notes"] == "-150 leftover"
    kpi = public_kpis(warnings)
    assert kpi["public_record"] == "3-3-1"
    assert kpi["mgm_record"] == "3-3-1"
    assert kpi["public_pending"] == 1
    # 3 fades won @ -110 ($90.91) + 3 losses (-$100) + 1 push; pending excluded.
    assert kpi["fade_n"] == 7
    assert kpi["fade_pl"] == pytest.approx(3 * (100 * 100 / 110) + 3 * (-100) + 0)


def test_bets_row_strips_value_prefix_and_at_handles():
    bet = normalize_row(
        {
            "id": "C-1",
            "who": "@chellgod",
            "sport": "Value NFL",
            "notes": "Value ",
            "res": "Value W",
            "odds": "Value -110",
            "stake": "Value 100",
            "bt": "Value",
            "legs": "Value Chiefs -3",
        }
    )
    assert bet is not None
    assert bet["who"] == "chellgod"
    assert bet["sport"] == "NFL"
    assert bet["notes"] == ""
    assert bet["res"] == "W"
    assert bet["odds"] == "-110"
    assert bet["stake"] == 100
    assert bet["bt"] == ""
    assert bet["legs"] == "Chiefs -3"


def test_blank_mgm_result_stays_unknown_fade_still_inverts():
    row = normalize_public_row({"id": "MGM-BLANK", "public_res": "W", "mgm_res": ""})
    assert row is not None
    assert row["public_res"] == "W"
    assert row["mgm_res"] == "Unknown"
    assert row["fade_res"] == "L"
    assert row["fade_pl"] == -100.0


def test_combined_pl_equals_sum_of_per_bettor_pl():
    headers, rows = load_local_workbook(TABS)["Bets"]
    bets = normalize_rows(rows, headers)
    names = unique_bettors(bets)
    combined = bettor_kpis(bets)
    parts = [bettor_kpis(bets, name)["pl"] or 0.0 for name in names]
    assert combined["pl"] == pytest.approx(sum(parts))
    assert combined["bets"] == sum(bettor_kpis(bets, name)["bets"] for name in names)


def test_public_ticket_handle_accepts_fraction_or_percent():
    fraction = normalize_public_row(
        {"id": "MGM-P", "public_res": "W", "ticket": 0.82, "handle": "82%"}
    )
    assert fraction is not None
    assert fraction["ticket"] == pytest.approx(82)
    assert fraction["handle"] == pytest.approx(82)
    leftover = normalize_public_row(
        {"id": "MGM-Q", "public_res": "L", "ticket": 82, "handle": "Value 0.75"}
    )
    assert leftover is not None
    assert leftover["ticket"] == pytest.approx(82)
    assert leftover["handle"] == pytest.approx(75)
    one = normalize_public_row({"id": "MGM-R", "public_res": "W", "ticket": 1, "handle": 0.01})
    assert one is not None
    assert one["ticket"] == pytest.approx(100)
    assert one["handle"] == pytest.approx(1)


def test_parlay_and_public_honor_season_windows():
    pre = {
        "id": "pre",
        "who": "Trent",
        "gd": "2026-08-20",
        "posted": "2026-08-20 12:00:00",
        "sport": "NFL",
    }
    cfb = {
        "id": "cfb",
        "who": "Trent",
        "gd": "2026-08-28",
        "posted": "2026-08-28 12:00:00",
        "sport": "NFL",
    }
    nfl = {
        "id": "nfl",
        "who": "Steve",
        "gd": "2026-09-10",
        "posted": "2026-09-10 12:00:00",
        "sport": "NFL",
    }
    assert [row["id"] for row in filter_parlay_legs([pre, cfb, nfl], window="cfb")] == [
        "cfb",
        "nfl",
    ]
    assert [row["id"] for row in filter_parlay_legs([pre, cfb, nfl], window="nfl")] == [
        "nfl"
    ]
    assert [
        row["id"] for row in filter_parlay_legs([pre, cfb, nfl], who="Steve")
    ] == ["nfl"]
    assert [row["id"] for row in filter_public_warnings([pre, cfb, nfl], window="nfl")] == [
        "nfl"
    ]
    assert [row["id"] for row in filter_public_warnings([pre, cfb, nfl], window="all")] == [
        "pre",
        "cfb",
        "nfl",
    ]


def test_extra_column_is_ignored():
    headers, rows = load_local_workbook(TABS)["Bets"]
    assert headers[-1] == "Extra unused"
    from sj.bets import normalize_rows

    bets = normalize_rows(rows, headers)
    assert all("ignore-me" not in b.values() for b in bets)
    assert {b["id"]: b.get("pick_class") for b in bets}["C-2"] == "Prop"
    locked = next(b for b in bets if b["id"] == "Z-1")
    assert locked["who"] == "Lockedin_Sportz"
    assert locked["stake"] is None and locked["units"] is None
    assert locked["pick_class"] == "Prop"


def test_fetch_remote_workbook_xlsx(monkeypatch):
    monkeypatch.setattr("sj.bets.lookup_drive_mime", lambda *a, **k: XLSX_MIME)
    monkeypatch.setattr("sj.bets.download_drive_file", lambda *a, **k: TABS.read_bytes())

    def boom(*_a, **_k):
        raise AssertionError("Sheets API must not run for an uploaded xlsx")

    monkeypatch.setattr("sj.bets.fetch_sheet_workbook", boom)
    book, source = fetch_remote_workbook("drive-file-id")
    assert source == "drive-xlsx"
    from sj.bets import RECORD_SPLITS_TAB

    assert set(book) == {"Bets", PARLAY_TAB, PUBLIC_TAB, RECORD_SPLITS_TAB}
    assert len(book["Bets"][1]) == 12


def test_fetch_remote_workbook_native_sheet(monkeypatch):
    canned = {
        "Bets": (["Bet ID", "Bettor"], [["T-1", "Trent"]]),
        PARLAY_TAB: (["Leg ID", "Bettor"], [["T-1-1", "Trent"]]),
        PUBLIC_TAB: (["Warning ID", "Public result"], [["MGM-001", "W"]]),
    }
    monkeypatch.setattr("sj.bets.lookup_drive_mime", lambda *a, **k: SHEET_MIME)
    monkeypatch.setattr("sj.bets.fetch_sheet_workbook", lambda *a, **k: canned)

    def boom(*_a, **_k):
        raise AssertionError("xlsx download must not run for a native Sheet")

    monkeypatch.setattr("sj.bets.download_drive_file", boom)
    book, source = fetch_remote_workbook("native-sheet-id")
    assert source == "sheets"
    assert book[PARLAY_TAB][1][0][0] == "T-1-1"


def test_dollar_pl_uses_posted_payout_when_odds_not_shown():
    from sj.bets import dollar_pl

    # LC posts payout but no American odds; sheet decimal is a rounded helper.
    bet = {"res": "W", "stake": 198.02, "odds": "not shown", "dec": 2.232, "towin": 442.0}
    assert dollar_pl(bet) == pytest.approx(243.98)
    priced = {"res": "W", "stake": 100.0, "odds": "+150", "dec": None, "towin": 999.0}
    assert dollar_pl(priced) == pytest.approx(150.0)


def test_laurencowling_no_units_and_header_lookup_tolerates_shifted_columns():
    from sj.bets import TRACKER_TABS, bettor_kpis, normalize_rows

    # Summary / Leg Fade Summary are formula tabs and never read (no fixed rows).
    assert "Leg Fade Summary" not in TRACKER_TABS and "Summary" not in TRACKER_TABS
    from sj.bets import RECORD_SPLITS_TAB

    assert RECORD_SPLITS_TAB in TRACKER_TABS
    headers = ["Notes", "Result", "Bettor", "Bet ID", "Stake $", "Odds (American)",
               "To win/payout $ (total return)", "Units", "Date posted (CT)"]
    rows = [
        ["", "W", "laurencowling", "L-1", 100, "not shown", 250, "", 46235],
        ["", "L", "@laurencowling", "L-2", 50, "-110", "", "", 46236],
    ]
    bets = normalize_rows(rows, headers)
    assert [b["id"] for b in bets] == ["L-1", "L-2"]
    assert {b["who"] for b in bets} == {"laurencowling"}
    k = bettor_kpis(bets, "laurencowling")
    assert k["record"] == "1-1-0" and k["pl"] == pytest.approx(100.0)
    assert k["units_pl"] is None and k["units_roi"] is None
