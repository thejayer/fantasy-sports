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
    export_bets,
    fade_pl,
    fetch_remote_workbook,
    invert_result,
    list_xlsx_sheets,
    load_local_workbook,
    normalize_who,
    strip_value_prefix,
    unique_bettors,
)
from sj.bets_parlay import (
    normalize_parlay_row,
    normalize_parlay_rows,
    ou_bucket,
    parlay_kpis,
)
from sj.bets_public import normalize_public_rows, public_kpis
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
    assert normalize_who("@chellgod") == "@chellgod" or normalize_who("chellgod") == "chellgod"
    assert normalize_who("chellgod") == "chellgod"
    assert normalize_who("Trent Attyah") == "Trent"
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


def test_tracker_tabs_xlsx_has_three_data_tabs():
    names = list_xlsx_sheets(TABS)
    assert names[0] == "Bets"
    assert PARLAY_TAB in names
    assert PUBLIC_TAB in names
    book = load_local_workbook(TABS)
    assert set(book) == {"Bets", PARLAY_TAB, PUBLIC_TAB}


def test_export_writes_four_json_files_and_stable_summary_keys(tmp_path: Path):
    result = export_bets(from_path=TABS, store_dir=tmp_path)
    store = FileStore(tmp_path)
    bets = store.read_bets("bets")
    summary = store.read_bets("summary")
    parlays = store.read_bets("parlay_legs")
    warnings = store.read_bets("public_warnings")
    assert bets is not None and summary is not None
    assert parlays is not None and warnings is not None
    assert bets["bet_count"] == 10
    assert {b["who"] for b in bets["bets"]} == {"Trent", "Steve", "btidy216", "chellgod"}
    # P.11 keys stay put even though the board is no longer Trent/Steve-only.
    assert "trent" in summary and "steve" in summary and "all" in summary
    assert [row["who"] for row in summary["bettors"]] == [
        "Steve",
        "Trent",
        "btidy216",
        "chellgod",
    ]
    assert summary["all"]["bets"] == 10
    assert parlays["leg_count"] == 8
    assert warnings["warning_count"] == 8
    assert result["parlay_legs"]["leg_count"] == 8


def test_legacy_xlsx_still_exports_empty_new_tabs(tmp_path: Path):
    result = export_bets(from_path=LEGACY, store_dir=tmp_path)
    assert result["bets"]["bet_count"] >= 500
    assert result["parlay_legs"]["leg_count"] == 0
    assert result["public_warnings"]["warning_count"] == 0
    assert result["summary"]["trent"]["bets"] > 200


def test_json_from_still_bets_only(tmp_path: Path):
    result = export_bets(from_path=SAMPLE, store_dir=tmp_path)
    assert result["bets"]["bet_count"] == 40
    assert result["parlay_legs"]["leg_count"] == 0
    assert result["public_warnings"]["warning_count"] == 0


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


def test_extra_column_is_ignored():
    headers, rows = load_local_workbook(TABS)["Bets"]
    assert headers[-1] == "Extra unused"
    from sj.bets import normalize_rows

    bets = normalize_rows(rows, headers)
    assert all("ignore-me" not in b.values() for b in bets)


def test_fetch_remote_workbook_xlsx(monkeypatch):
    monkeypatch.setattr("sj.bets.lookup_drive_mime", lambda *a, **k: XLSX_MIME)
    monkeypatch.setattr("sj.bets.download_drive_file", lambda *a, **k: TABS.read_bytes())

    def boom(*_a, **_k):
        raise AssertionError("Sheets API must not run for an uploaded xlsx")

    monkeypatch.setattr("sj.bets.fetch_sheet_workbook", boom)
    book, source = fetch_remote_workbook("drive-file-id")
    assert source == "drive-xlsx"
    assert set(book) == {"Bets", PARLAY_TAB, PUBLIC_TAB}
    assert len(book["Bets"][1]) == 10


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
