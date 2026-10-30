"""Options tracker ingest (P.12). Offline — no Drive/Sheets. Simulated rows only."""

from __future__ import annotations

import json
from pathlib import Path

from sj.bets import export_bets, fetch_remote_workbook
from sj.bets_options import (
    TRADE_HEADER_ALIASES,
    TRADES_TAB,
    build_options_document,
    export_options,
    maybe_export_options,
    normalize_trade_rows,
    normalize_trader_rows,
    options_sync_enabled,
    posted_pl,
    trader_summary,
)
from sj.store import FileStore

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "bets"
SIMULATED = FIXTURES / "options_simulated.json"
XLSX = FIXTURES / "trent_steve_bet_tracker.xlsx"

TRADE_HEADERS = [
    "Trade ID",
    "Trader",
    "Post date",
    "Post URL",
    "Underlying",
    "Type",
    "Strike",
    "Expiry",
    "Contracts",
    "Entry price",
    "Exit price",
    "Cost basis $",
    "Proceeds $",
    "P/L $",
    "P/L %",
    "Status",
    "Source",
    "Notes",
]


def _row(
    tid: str,
    trader: str,
    *,
    posted: str = "2026-09-01",
    kind: str = "Call",
    status: str = "Closed",
    pl: object = 100,
    pl_pct: object = None,
    url: str = "https://example.com/posts/sim",
    extra: dict | None = None,
) -> dict:
    data = {
        "Trade ID": tid,
        "Trader": trader,
        "Post date": posted,
        "Post URL": url,
        "Underlying": "TEST",
        "Type": kind,
        "Strike": 10,
        "Expiry": "2026-12-18",
        "Contracts": 1,
        "Entry price": 1.0,
        "Exit price": 2.0,
        "Cost basis $": 100,
        "Proceeds $": 200,
        "P/L $": pl,
        "P/L %": pl_pct,
        "Status": status,
        "Source": "stated",
        "Notes": "Simulated row for tests.",
    }
    if extra:
        data.update(extra)
    return data


def test_options_sync_flag_off_by_default(monkeypatch):
    monkeypatch.delenv("SJ_OPTIONS_SYNC", raising=False)
    assert options_sync_enabled() is False
    monkeypatch.setenv("SJ_OPTIONS_SYNC", "0")
    assert options_sync_enabled() is False
    monkeypatch.setenv("SJ_OPTIONS_SYNC", "1")
    assert options_sync_enabled() is True


def test_header_name_reading_reordered_and_extra_columns():
    headers = [
        "Notes",
        "Status",
        "P/L %",
        "P/L $",
        "Extra column",
        "Trade ID",
        "Trader",
        "Type",
        "Post date",
        "Post URL",
        "Underlying",
    ]
    rows = [
        [
            "title row — not headers",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        ],
        headers,
        [
            "sim note",
            "Closed",
            "=N2/L2",
            50,
            "ignore-me",
            "O-UNIT-1",
            "Sample Trader A",
            "Put",
            "2026-09-02",
            "https://example.com/posts/unit-1",
            "XYZ",
        ],
    ]
    # Locate by header names: skip the title row the same way sheet_as_table does.
    from sj.bets import cut_header_table

    found_headers, found_rows = cut_header_table(
        rows, TRADE_HEADER_ALIASES, ("id", "trader")
    )
    trades = normalize_trade_rows(found_rows, found_headers)
    assert len(trades) == 1
    trade = trades[0]
    assert trade["id"] == "O-UNIT-1"
    assert trade["trader"] == "Sample Trader A"
    assert trade["type"] == "Put"
    assert trade["pl"] == 50.0
    assert trade["pl_pct"] is None  # formula string — do not infer
    assert trade["underlying"] == "XYZ"
    assert trade["status"] == "Closed"


def test_evaluated_pl_pct_kept_formula_and_blank_not_computed():
    rows = [
        _row("O-A", "A", pl=200, pl_pct=0.5),
        _row("O-B", "A", pl=200, pl_pct="=IF(L2,N2/L2,\"\")"),
        _row("O-C", "A", pl=200, pl_pct=""),
        _row("O-D", "A", pl=200, pl_pct=None),
    ]
    trades = normalize_trade_rows(rows)
    by_id = {t["id"]: t for t in trades}
    assert by_id["O-A"]["pl_pct"] == 0.5
    assert by_id["O-B"]["pl_pct"] is None
    assert by_id["O-C"]["pl_pct"] is None
    assert by_id["O-D"]["pl_pct"] is None
    # Posted P/L is never inferred from cost / proceeds.
    inferred = normalize_trade_rows(
        [_row("O-E", "A", pl=None, extra={"Cost basis $": 10, "Proceeds $": 40})]
    )[0]
    assert inferred["pl"] is None
    assert posted_pl(inferred) is None


def test_blank_pl_excluded_from_totals_and_record():
    rows = [
        _row("W1", "A", pl=100, status="Closed"),
        _row("L1", "A", pl=-40, status="Closed"),
        _row("Z1", "A", pl=0, status="Closed"),
        _row("B1", "A", pl=None, status="Closed"),
        _row("B2", "A", pl="", status="Expired"),
        _row("O1", "A", pl=None, status="Open"),
    ]
    trades = normalize_trade_rows(rows)
    summary = trader_summary(trades, name="A")
    assert summary["pl"] == 60.0  # 100 + -40 + 0; blanks excluded
    assert summary["pl_posted"] == 3
    assert summary["wins"] == 1
    assert summary["losses"] == 1
    assert summary["open"] == 1
    assert summary["has_daily_recap"] is False
    assert summary["green_days"] is None
    assert summary["red_days"] is None


def test_open_positions_not_marked_to_market():
    rows = [
        _row("O1", "A", pl=None, status="Open", extra={"Entry price": 2, "Exit price": None}),
        _row("O2", "A", pl=999, status="Open"),  # posted figure still not a closed W
    ]
    trades = normalize_trade_rows(rows)
    summary = trader_summary(trades, name="A")
    assert summary["open"] == 2
    assert summary["wins"] == 0
    assert summary["losses"] == 0
    assert summary["pl"] == 999.0  # posted only
    assert trades[0]["exit"] is None


def test_daily_recap_green_red_days():
    rows = [
        _row("D1", "B", kind="Daily recap", pl=40, posted="2026-08-04"),
        _row("D2", "B", kind="Daily recap", pl=-10, posted="2026-08-05"),
        _row("D3", "B", kind="Daily recap", pl=0, posted="2026-08-06"),
        _row("D4", "B", kind="Daily recap", pl=None, posted="2026-08-07"),
        _row("C1", "B", kind="Call", pl=500, posted="2026-08-08"),
    ]
    trades = normalize_trade_rows(rows)
    summary = trader_summary(trades, name="B")
    assert summary["has_daily_recap"] is True
    assert summary["green_days"] == 1
    assert summary["red_days"] == 1
    assert summary["wins"] == 2  # D1 + C1 (zero / blank excluded)
    assert summary["losses"] == 1


def test_flag_off_does_not_write_options(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("SJ_OPTIONS_SYNC", raising=False)
    result = maybe_export_options(store_dir=tmp_path, sheet_id="unused")
    assert result is None
    assert not (tmp_path / "bets" / "options.json").exists()


def test_reader_failure_does_not_block_bets_export(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("SJ_OPTIONS_SYNC", "1")
    monkeypatch.delenv("SJ_OPTIONS_SHEET_ID", raising=False)
    bets = export_bets(from_path=XLSX, store_dir=tmp_path)
    assert (tmp_path / "bets" / "bets.json").exists()
    splits_before = (tmp_path / "bets" / "record_splits.json").read_text(encoding="utf-8")

    logged: list[str] = []
    result = maybe_export_options(
        sheet_id="",
        store_dir=tmp_path,
        log=logged.append,
    )
    assert result is None
    assert logged and "skipped" in logged[0]
    assert not (tmp_path / "bets" / "options.json").exists()
    assert (tmp_path / "bets" / "bets.json").exists()
    assert (tmp_path / "bets" / "record_splits.json").read_text(
        encoding="utf-8"
    ) == splits_before
    # Options P/L is not folded into human betting totals.
    assert "Sample Trader" not in json.dumps(bets["summary"])
    assert "options" not in bets


def test_export_options_from_simulated_fixture(tmp_path: Path):
    doc = export_options(from_path=SIMULATED, store_dir=tmp_path)
    store = FileStore(tmp_path)
    loaded = store.read_bets("options")
    assert loaded is not None
    assert loaded["simulated"] is True
    assert loaded["schema"] == "sj-options-v1"
    assert loaded["trade_count"] == 74
    assert loaded["footnote"].startswith("Data comes only from posted")
    names = {row["name"] for row in loaded["traders"]}
    assert names == {"Sample Trader A", "Sample Trader B"}
    by_name = {row["name"]: row for row in loaded["traders"]}
    assert by_name["Sample Trader A"]["open"] == 3
    assert by_name["Sample Trader A"]["wins"] == 4
    assert by_name["Sample Trader A"]["losses"] == 1
    assert by_name["Sample Trader A"]["pl"] == 446000.0
    assert by_name["Sample Trader A"]["has_daily_recap"] is False
    assert by_name["Sample Trader B"]["has_daily_recap"] is True
    assert by_name["Sample Trader B"]["green_days"] == 34
    assert by_name["Sample Trader B"]["red_days"] == 11
    # No sheet id / emails / real handles in the sidecar.
    blob = json.dumps(loaded)
    assert "sheet_id" not in loaded
    assert "@gmail.com" not in blob
    assert "docs.google.com" not in blob
    # Blank P/L stays null; open rows keep status Open.
    opens = [t for t in loaded["trades"] if t["status"] == "Open"]
    assert opens and all(t["pl"] is None for t in opens)
    assert doc["trade_count"] == 74


def test_traders_tab_header_names():
    headers = ["Notes", "Tracked since", "X handle", "Display name"]
    rows = [
        [
            "Simulated trader.",
            "2026-08-01",
            "sampletradera",
            "Sample Trader A",
        ]
    ]
    traders = normalize_trader_rows(rows, headers)
    assert traders == [
        {
            "name": "Sample Trader A",
            "handle": "sampletradera",
            "href": "https://x.com/sampletradera",
            "tracked_since": "2026-08-01",
            "notes": "Simulated trader.",
        }
    ]


def test_export_bets_does_not_write_options_json(tmp_path: Path):
    export_bets(from_path=XLSX, store_dir=tmp_path)
    assert (tmp_path / "bets" / "bets.json").exists()
    assert (tmp_path / "bets" / "record_splits.json").exists()
    assert not (tmp_path / "bets" / "options.json").exists()


def test_fetch_options_tabs_use_trade_headers(monkeypatch):
    """Native Sheet batchGet for Trades is cut by Trade ID / Trader, not Bet ID."""

    def fake_tabs(*_a, **_k):
        return ["Trades", "Traders", "Summary", "Legend & Notes"]

    def fake_http(url: str, **_k):
        if "values:batchGet" in url:
            return json.dumps(
                {
                    "valueRanges": [
                        {
                            "values": [
                                TRADE_HEADERS,
                                [
                                    "O-SHEET-1",
                                    "Sample Trader A",
                                    "2026-09-01",
                                    "https://example.com/posts/sheet-1",
                                    "ABC",
                                    "Call",
                                    10,
                                    "2026-12-18",
                                    2,
                                    1.5,
                                    3.0,
                                    300,
                                    600,
                                    300,
                                    1.0,
                                    "Closed",
                                    "screenshot",
                                    "Simulated sheet row.",
                                ],
                            ]
                        },
                        {
                            "values": [
                                ["Display name", "X handle", "Tracked since", "Notes"],
                                [
                                    "Sample Trader A",
                                    "sampletradera",
                                    "2026-08-01",
                                    "Simulated.",
                                ],
                            ]
                        },
                    ]
                }
            ).encode()
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr("sj.bets.lookup_drive_mime", lambda *_a, **_k: "application/vnd.google-apps.spreadsheet")
    monkeypatch.setattr("sj.bets.list_remote_tabs", fake_tabs)
    monkeypatch.setattr("sj.bets._adc_token", lambda *_a, **_k: "token")
    monkeypatch.setattr("sj.bets._http_get", fake_http)
    book, source = fetch_remote_workbook("options-sheet-id", ("Trades", "Traders"))
    assert source == "sheets"
    headers, rows = book[TRADES_TAB]
    trades = normalize_trade_rows(rows, headers)
    assert trades[0]["id"] == "O-SHEET-1"
    assert trades[0]["pl"] == 300.0
    assert trades[0]["pl_pct"] == 1.0  # evaluated number, not a formula


def test_build_document_footnote_and_sort():
    trades = normalize_trade_rows(
        [
            _row("T2", "Zed", pl=1),
            _row("T1", "Ann", pl=2),
            _row("T3", "Ann", pl=3),
        ]
    )
    doc = build_options_document(trades, source="fixture:unit.json")
    assert doc["simulated"] is True
    assert [t["name"] for t in doc["traders"]] == ["Ann", "Zed"]
    assert "posted screenshots" in doc["footnote"]


def test_maybe_export_from_path_without_flag(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("SJ_OPTIONS_SYNC", raising=False)
    doc = maybe_export_options(from_path=SIMULATED, store_dir=tmp_path)
    assert doc is not None
    assert (tmp_path / "bets" / "options.json").exists()
