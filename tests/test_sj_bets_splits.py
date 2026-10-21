"""Record Splits ingest — header detection, never fixed rows/ranges."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from sj.bets import (
    FORMULA_TABS,
    RECORD_SPLITS_TAB,
    TRACKER_TABS,
    cut_header_table,
    export_bets,
    flat_1u_pl,
    is_hypothetical_1u,
    locate_header_row,
    normalize_row,
    normalize_rows,
    read_xlsx_grid,
)
from sj.bets_splits import (
    FADE_EMPHASIS,
    classify_header_row,
    normalize_pick_class,
    normalize_split_source,
    parse_splits_grid,
    split_kind,
)
from sj.store import FileStore


def _load_write_xlsx():
    path = Path(__file__).resolve().parent / "xlsx_write.py"
    spec = importlib.util.spec_from_file_location("xlsx_write", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.write_xlsx


write_xlsx = _load_write_xlsx()

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "bets"
TABS = FIXTURES / "tracker_tabs.xlsx"
LEGACY = FIXTURES / "trent_steve_bet_tracker.xlsx"


def _main_headers_shuffled() -> list[str]:
    # Deliberately not A=Bettor / D=Source / E=Class.
    return [
        "Class",
        "Win %",
        "Bettor",
        "W",
        "L",
        "Source tab",
        "P",
        "Pending",
        "Unknown",
        "Posted units P&L",
        "$ P&L",
        "$ staked",
        "Flat 1u",
        "1u fade at -110",
    ]


def _split_row(
    klass: str,
    win_pct: float,
    who: str,
    w: int,
    l: int,
    source: str,
    p: int = 0,
    pending: int = 0,
    unknown: int = 0,
    units_pl: float | None = None,
    pl: float | None = None,
    staked: float | None = None,
    flat_1u: float | None = None,
    fade_1u: float | None = None,
) -> list[object]:
    return [
        klass,
        win_pct,
        who,
        w,
        l,
        source,
        p,
        pending,
        unknown,
        "" if units_pl is None else units_pl,
        "" if pl is None else pl,
        "" if staked is None else staked,
        "" if flat_1u is None else flat_1u,
        "" if fade_1u is None else fade_1u,
    ]


def sample_splits_grid(*, pad: int = 3) -> list[list[object]]:
    """Synthetic Record Splits grid with title rows + shuffled columns."""
    title = [["Record Splits"], ["Synthetic fixture — not live data"]]
    pad_rows = [[""] for _ in range(pad)]
    main = [
        _main_headers_shuffled(),
        _split_row("Team", 0.667, "*", 4, 2, "Bets", p=1, fade_1u=-1.5, flat_1u=0.4),
        _split_row("Prop", 0.0, "*", 0, 2, "Bets", fade_1u=1.82, flat_1u=-2.0),
        _split_row("Parlay", 1.0, "*", 1, 0, "Bets", fade_1u=0.91, flat_1u=2.5),
        _split_row("Team pick", 0.8, "*", 4, 1, "Parlay Legs", fade_1u=-2.73),
        _split_row("Player prop", 0.25, "*", 1, 3, "Parlay Legs", fade_1u=1.64),
        _split_row("Team", 0.5, "Trent", 1, 1, "Bets", fade_1u=-0.09),
        _split_row("Prop", 0.0, "Trent", 0, 0, "Bets", pending=0, fade_1u=0.0),
        _split_row("Parlay", 0.0, "Trent", 0, 0, "Bets", pending=1, fade_1u=0.0),
        _split_row("Team pick", 1.0, "Trent", 1, 0, "Parlay Legs", fade_1u=-0.91),
        _split_row("Player prop", 0.0, "Trent", 0, 1, "Parlay Legs", fade_1u=0.91),
        _split_row("Team", 0.5, "Steve", 1, 1, "Bets", p=1, fade_1u=-0.09),
        _split_row("Parlay", 0.0, "Steve", 0, 1, "Bets", fade_1u=1.0),
        _split_row("Team pick", 0.0, "Steve", 0, 1, "Parlay Legs", fade_1u=0.91),
        _split_row("Player prop", 1.0, "Steve", 1, 0, "Parlay Legs", fade_1u=-0.91),
        _split_row("Prop", 0.0, "chellgod", 0, 1, "Bets", fade_1u=0.91),
        _split_row("Parlay", 1.0, "chellgod", 1, 0, "Bets", fade_1u=-0.91),
        _split_row("Team pick", 1.0, "chellgod", 2, 0, "Parlay Legs", fade_1u=-1.82),
        _split_row("Team", 1.0, "btidy216", 2, 0, "Bets", fade_1u=-1.82),
        _split_row("Team pick", 1.0, "btidy216", 1, 0, "Parlay Legs", fade_1u=-0.91),
        _split_row("Player prop", 0.0, "btidy216", 0, 1, "Parlay Legs", fade_1u=0.91),
        _split_row("Prop", 0.5, "Lockedin_Sportz", 1, 1, "Bets", fade_1u=0.4, flat_1u=0.0),
        _split_row("Parlay", 0.0, "Lockedin_Sportz", 0, 0, "Bets", fade_1u=0.0),
        _split_row("Team pick", 0.0, "@Lockedin_Sportz", 0, 0, "Parlay Legs", fade_1u=0.0),
        _split_row("Player prop", 0.0, "Lockedin_Sportz", 0, 0, "Parlay Legs", fade_1u=0.0),
    ]
    recon = [
        [],
        ["Check", "Expected", "Actual", "Delta", "Status"],
        ["Bets W vs splits", "12", "12", "0", "Pass"],
        ["Parlay legs vs splits", "8", "8", "0", "Pass"],
    ]
    sport = [
        [],
        ["Sport split"],
        [
            "Sport",
            "Bettor",
            "W",
            "Class",
            "L",
            "Source tab",
            "P",
            "Win %",
            "1u fade at -110",
        ],
        ["NFL", "*", 3, "Team", 2, "Bets", 0, 0.6, -0.5],
        ["NFL", "*", 0, "Prop", 2, "Bets", 0, 0.0, 1.82],
        ["NFL", "*", 0, "Parlay", 0, "Bets", 1, 0.0, 0.0],
        ["CFB", "*", 2, "Team", 1, "Bets", 1, 0.667, -0.7],
        ["MLB", "*", 1, "Parlay", 0, "Bets", 0, 1.0, -0.91],
        ["Other", "*", 0, "Team", 0, "Bets", 0, 0.0, 0.0],
        ["NFL", "Lockedin_Sportz", 1, "Prop", 1, "Bets", 0, 0.5, 0.4],
        ["NFL", "Trent", 1, "Team", 0, "Bets", 0, 1.0, -0.91],
        ["CFB", "Trent", 0, "Team", 1, "Bets", 0, 0.0, 0.91],
    ]
    return [*title, *pad_rows, *main, *recon, *sport]


def test_formula_tabs_stay_out_of_ingest():
    assert RECORD_SPLITS_TAB in TRACKER_TABS
    assert "Summary" not in TRACKER_TABS
    assert "Leg Fade Summary" not in TRACKER_TABS
    assert FORMULA_TABS.isdisjoint(TRACKER_TABS)


def test_pick_class_column_is_read_by_name_even_as_column_ae():
    """Live tracker added Pick Class as AE — extra columns must not break rows."""
    # 31 columns so Pick Class sits at AE (1-indexed 31).
    headers = [
        "Bet ID",
        "Bettor",
        "Date posted (CT)",
        "Game date",
        "Sport category",
        "Bet type",
        "Selection/legs",
        "# legs",
        "Odds (American)",
        "Odds (decimal)",
        "Stake $",
        "Units",
        "To win/payout $ (total return)",
        "Book/platform",
        "Result",
        "Result source",
        "Sponsored/promo flag",
        "Post URL",
        "Notes",
        "Single vs parlay",
        "Day of week (posted)",
        "Game day of week",
        "Game kickoff time (ET)",
        "Prime time (Y/N)",
        "Prime time slot",
        "League/event",
        "Profit/Loss $",
        "Profit/Loss units",
        "Settled $ stake (helper)",
        "Settled units (helper)",
        "Pick Class",
        "Trailing junk",
    ]
    assert headers.index("Pick Class") == 30  # column AE
    row = [""] * len(headers)
    row[0] = "Z-1"
    row[1] = "Lockedin_Sportz"
    row[14] = "W"
    row[30] = "Player prop"
    row[31] = "should-be-ignored"
    bet = normalize_row(row, headers)
    assert bet is not None
    assert bet["id"] == "Z-1"
    assert bet["who"] == "Lockedin_Sportz"
    assert bet["res"] == "W"
    assert bet["pick_class"] == "Player prop"
    assert "should-be-ignored" not in bet.values()


def test_bets_header_scan_skips_title_rows():
    headers = ["Bet ID", "Bettor", "Result", "Stake $", "Odds (American)"]
    grid = [
        ["Bets"],
        ["do not treat this as a header"],
        [],
        headers,
        ["T-99", "Trent", "W", 100, "+100"],
        ["Z-9", "Lockedin_Sportz", "L", "", ""],
    ]
    found, rows = cut_header_table(
        grid,
        {
            "id": ("bet id", "id"),
            "who": ("bettor", "who"),
            "res": ("result", "res"),
            "stake": ("stake $", "stake"),
            "odds": ("odds (american)", "odds"),
        },
        ("id", "who"),
    )
    assert found == headers
    bets = normalize_rows(rows, found)
    assert [b["id"] for b in bets] == ["T-99", "Z-9"]
    assert locate_header_row(
        grid,
        {"id": ("bet id", "id"), "who": ("bettor", "who")},
        ("id", "who"),
    ) == 3


def test_splits_parser_finds_sections_after_title_rows_and_shuffled_columns():
    parsed = parse_splits_grid(sample_splits_grid(pad=5))
    kinds = {(row["who"], row["kind"]) for row in parsed["splits"]}
    assert ("*", "single_team") in kinds
    assert ("*", "single_prop") in kinds
    assert ("*", "ticket") in kinds
    assert ("*", "leg_team") in kinds
    assert ("*", "leg_prop") in kinds
    star_prop = next(
        row for row in parsed["splits"] if row["who"] == "*" and row["kind"] == "single_prop"
    )
    assert star_prop["record"] == "0-2-0"
    assert star_prop["fade_1u"] == pytest.approx(1.82)
    assert star_prop["fade_plus"] is True
    assert star_prop["fade_emphasis"] is True
    star_ticket = next(
        row for row in parsed["splits"] if row["who"] == "*" and row["kind"] == "ticket"
    )
    assert star_ticket["fade_emphasis"] is True
    locked = next(
        row
        for row in parsed["splits"]
        if row["who"] == "Lockedin_Sportz" and row["kind"] == "single_prop"
    )
    assert locked["fade_plus"] is True
    sports = parsed["sports"]
    assert {row["sport"] for row in sports} >= {"NFL", "CFB", "MLB", "Other"}
    nfl_prop = next(
        row
        for row in sports
        if row["who"] == "*" and row["sport"] == "NFL" and row["kind"] == "single_prop"
    )
    assert nfl_prop["fade_emphasis"] is True
    assert parsed["checks"][0]["check"] == "Bets W vs splits"
    assert parsed["checks"][0]["status"] == "Pass"
    assert [row["check"] for row in parsed["checks"]] == [
        "Bets W vs splits",
        "Parlay legs vs splits",
    ]


def test_title_row_ends_recon_when_blank_rows_are_stripped():
    """xlsx readers drop empty rows; a lone 'Sport split' label still starts the next block."""
    grid = [
        _main_headers_shuffled(),
        _split_row("Team", 0.5, "*", 1, 1, "Bets", fade_1u=-0.1),
        ["Check", "Expected", "Actual", "Delta", "Status"],
        ["Bets W vs splits", "12", "12", "0", "Pass"],
        ["Sport split"],
        [
            "Sport",
            "Bettor",
            "W",
            "Class",
            "L",
            "Source tab",
            "P",
            "Win %",
            "1u fade at -110",
        ],
        ["NFL", "*", 3, "Team", 2, "Bets", 0, 0.6, -0.5],
    ]
    parsed = parse_splits_grid(grid)
    assert [row["check"] for row in parsed["checks"]] == ["Bets W vs splits"]
    assert parsed["sports"][0]["sport"] == "NFL"
    assert parsed["splits"][0]["kind"] == "single_team"


def test_splits_parser_survives_rows_moving_down():
    compact = parse_splits_grid(sample_splits_grid(pad=0))
    shifted = parse_splits_grid(sample_splits_grid(pad=12))
    assert [row["kind"] for row in compact["splits"]] == [
        row["kind"] for row in shifted["splits"]
    ]
    assert len(compact["sports"]) == len(shifted["sports"])
    assert len(compact["checks"]) == len(shifted["checks"])


def test_classify_header_does_not_use_coordinates():
    main = classify_header_row(_main_headers_shuffled())
    sport = classify_header_row(
        ["Sport", "Bettor", "W", "Class", "L", "Source tab", "P", "Win %", "1u fade at -110"]
    )
    recon = classify_header_row(["Check", "Expected", "Actual", "Delta", "Status"])
    assert main == "main"
    assert sport == "sport"
    assert recon == "recon"
    assert classify_header_row(["Record Splits"]) is None
    assert classify_header_row(["Team", 1, 2, 3]) is None


def test_split_kind_and_class_aliases():
    assert normalize_pick_class("Team pick") == "team"
    assert normalize_pick_class("Player prop") == "prop"
    assert normalize_pick_class("Parlay") == "parlay"
    assert normalize_split_source("Bets") == "bets"
    assert normalize_split_source("Parlay Legs") == "parlay_legs"
    assert split_kind("bets", "team") == "single_team"
    assert split_kind("bets", "prop") == "single_prop"
    assert split_kind("parlay_legs", "team") == "leg_team"
    assert split_kind("parlay_legs", "prop") == "leg_prop"
    assert split_kind("bets", "parlay") == "ticket"
    assert "ticket" in FADE_EMPHASIS and "single_prop" in FADE_EMPHASIS


def test_lockedin_is_hypothetical_1u():
    assert is_hypothetical_1u("Lockedin_Sportz")
    assert is_hypothetical_1u("@Lockedin_Sportz")
    assert not is_hypothetical_1u("Trent")
    assert not is_hypothetical_1u("laurencowling")
    win = {"res": "W", "odds": None, "dec": None}
    assert flat_1u_pl(win) == pytest.approx(100 / 110)
    assert flat_1u_pl({**win, "res": "L"}) == -1.0
    assert flat_1u_pl({**win, "res": "Pending"}) is None


def test_tracker_tabs_xlsx_exports_record_splits(tmp_path: Path):
    grid = read_xlsx_grid(TABS, RECORD_SPLITS_TAB)
    assert classify_header_row(grid[0]) is None  # title, not a header
    parsed = parse_splits_grid(grid)
    assert parsed["splits"]
    result = export_bets(from_path=TABS, store_dir=tmp_path)
    store = FileStore(tmp_path)
    doc = store.read_bets("record_splits")
    assert doc is not None
    assert doc["split_count"] == result["record_splits"]["split_count"]
    assert doc["tab"] == RECORD_SPLITS_TAB
    who = {row["who"] for row in doc["splits"]}
    assert "*" in who
    assert "Lockedin_Sportz" in who
    assert any(row["fade_emphasis"] for row in doc["splits"])
    assert [row["check"] for row in doc["checks"]] == [
        "Bets W vs splits",
        "Parlay legs vs splits",
    ]


def test_legacy_xlsx_writes_empty_record_splits(tmp_path: Path):
    result = export_bets(from_path=LEGACY, store_dir=tmp_path)
    assert result["record_splits"]["split_count"] == 0
    assert result["record_splits"]["sports"] == []


def test_write_xlsx_round_trip_shifted_splits(tmp_path: Path):
    path = tmp_path / "shifted.xlsx"
    write_xlsx(
        path,
        {
            "Bets": [
                ["Bet ID", "Bettor", "Result", "Pick Class"],
                ["Z-1", "Lockedin_Sportz", "W", "Prop"],
            ],
            RECORD_SPLITS_TAB: sample_splits_grid(pad=8),
        },
    )
    result = export_bets(from_path=path, store_dir=tmp_path / "out")
    assert result["bets"]["bets"][0]["pick_class"] == "Prop"
    assert result["bets"]["bets"][0]["who"] == "Lockedin_Sportz"
    kinds = {row["kind"] for row in result["record_splits"]["splits"] if row["who"] == "*"}
    assert kinds == {"single_team", "single_prop", "leg_team", "leg_prop", "ticket"}
