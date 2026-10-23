"""Record Splits ingest — header detection, never fixed rows/ranges."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from sj.bets import (
    FORMULA_TABS,
    RECORD_SPLITS_TAB,
    TRACKER_TABS,
    _norm_key,
    cut_header_table,
    export_bets,
    flat_1u_pl,
    header_map,
    is_hypothetical_1u,
    locate_header_row,
    normalize_row,
    normalize_rows,
    read_xlsx_grid,
)
from sj.bets_splits import (
    _RECON_ALIASES,
    _SPLIT_ALIASES,
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
    from sj.bets import header_map as bets_header_map

    mapped = bets_header_map(headers)
    assert mapped["pick_class"] == 30
    assert mapped["posted"] == 2  # Date posted (CT) still matches after punctuation fold
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


# Exact live Record Splits header strings (sj-bets-lj6mw). Synthetic values only.
LIVE_FADE = "1u Fade P&L (\u2212110)"
LIVE_MAIN_HEADERS = [
    "Win %",
    "Class",
    "Bettor",
    LIVE_FADE,
    "W",
    "L",
    "P",
    "Pending",
    "Unknown/Void",
    "Units P&L (posted units)",
    "$ P&L (stake shown)",
    "$ staked (settled)",
    "Flat 1u",
    "Source tab",
    "Class key",
    "Bettor key",
]


def _live_row(
    *,
    display_who: str,
    key_who: str,
    display_klass: str,
    key_klass: str,
    source: str,
    w: int,
    l: int,
    p: int = 0,
    pending: int = 0,
    unknown: int = 0,
    win_pct: float,
    units_pl: float,
    pl: float,
    staked: float,
    flat_1u: float,
    fade_1u: float,
) -> list[object]:
    by_name = {
        "Win %": win_pct,
        "Class": display_klass,
        "Bettor": display_who,
        LIVE_FADE: fade_1u,
        "W": w,
        "L": l,
        "P": p,
        "Pending": pending,
        "Unknown/Void": unknown,
        "Units P&L (posted units)": units_pl,
        "$ P&L (stake shown)": pl,
        "$ staked (settled)": staked,
        "Flat 1u": flat_1u,
        "Source tab": source,
        "Class key": key_klass,
        "Bettor key": key_who,
    }
    return [by_name[name] for name in LIVE_MAIN_HEADERS]


def live_splits_grid(*, pad: int = 6) -> list[list[object]]:
    """Live header strings + synthetic bettors. Rows can sit anywhere."""
    title = [["Record Splits"], ["Synthetic — not the live sheet"]]
    pad_rows = [[""] for _ in range(pad)]
    main = [
        LIVE_MAIN_HEADERS,
        _live_row(
            display_who="Alex (alexhandle)",
            key_who="alexhandle",
            display_klass="whole parlay tickets",
            key_klass="Parlay",
            source="Bets",
            w=8,
            l=20,
            win_pct=0.2857,
            units_pl=4.2,
            pl=210,
            staked=800,
            flat_1u=12.5,
            fade_1u=22.0,
        ),
        _live_row(
            display_who="Alex (alexhandle)",
            key_who="alexhandle",
            display_klass="single bets \u2013 player props",
            key_klass="Player prop",
            source="Bets",
            w=1,
            l=4,
            win_pct=0.2,
            units_pl=-3.1,
            pl=-155,
            staked=400,
            flat_1u=-2.8,
            fade_1u=3.64,
        ),
        _live_row(
            display_who="Jordan (jordanh)",
            key_who="jordanh",
            display_klass="single bets \u2013 team picks",
            key_klass="Team",
            source="Bets",
            w=3,
            l=2,
            p=1,
            win_pct=0.6,
            units_pl=1.1,
            pl=55,
            staked=500,
            flat_1u=0.4,
            fade_1u=-0.5,
        ),
        _live_row(
            display_who="*",
            key_who="*",
            display_klass="parlay legs \u2013 team picks",
            key_klass="Team pick",
            source="Parlay Legs",
            w=10,
            l=6,
            win_pct=0.625,
            units_pl=2.0,
            pl=100,
            staked=600,
            flat_1u=1.5,
            fade_1u=-4.0,
        ),
        _live_row(
            display_who="*",
            key_who="*",
            display_klass="parlay legs \u2013 player props",
            key_klass="Player prop",
            source="Parlay Legs",
            w=7,
            l=9,
            win_pct=0.4375,
            units_pl=-1.2,
            pl=-60,
            staked=700,
            flat_1u=-2.0,
            fade_1u=1.82,
        ),
    ]
    recon = [
        [],
        ["Bets check", "Expected", "Actual", "Delta", "Status"],
        ["Bets W vs splits", "12", "12", "0", "Pass"],
        ["Legs check", "Expected", "Actual", "Delta", "Status"],
        ["Parlay legs vs splits", "8", "8", "0", "Pass"],
    ]
    sport = [
        [],
        ["Sport split"],
        [
            "Sport",
            "Bettor",
            "Bettor key",
            "Class",
            "Class key",
            "Source tab",
            "W",
            "L",
            "P",
            LIVE_FADE,
        ],
        ["NFL", "Alex (alexhandle)", "alexhandle", "whole parlay tickets", "Parlay", "Bets", 5, 12, 0, 14.0],
        ["CFB", "Alex (alexhandle)", "alexhandle", "whole parlay tickets", "Parlay", "Bets", 3, 8, 0, 8.0],
    ]
    return [*title, *pad_rows, *main, *recon, *sport]


def test_norm_key_folds_unicode_minus_and_punctuation():
    assert _norm_key(LIVE_FADE) == _norm_key("1u fade p&l (-110)")
    assert _norm_key("Unknown/Void") == "unknown void"
    assert _norm_key("Units P&L (posted units)") == _norm_key("units p&l (posted units)")
    assert _norm_key("Class key") == "class key"
    assert _norm_key("Bets check") == "bets check"


def test_header_map_prefers_key_columns_over_display():
    headers = ["Bettor", "Class", "Bettor key", "Class key", "Source tab"]
    mapping = header_map(headers, _SPLIT_ALIASES)
    assert headers[mapping["who"]] == "Bettor key"
    assert headers[mapping["klass"]] == "Class key"
    # Display-only sheet still resolves.
    display_only = header_map(["Bettor", "Class", "Source tab"], _SPLIT_ALIASES)
    assert display_only["who"] == 0
    assert display_only["klass"] == 1


def test_live_headers_are_matched_in_any_column_order():
    mapping = header_map(LIVE_MAIN_HEADERS, _SPLIT_ALIASES)
    assert LIVE_MAIN_HEADERS[mapping["who"]] == "Bettor key"
    assert LIVE_MAIN_HEADERS[mapping["klass"]] == "Class key"
    assert LIVE_MAIN_HEADERS[mapping["fade_1u"]] == LIVE_FADE
    assert LIVE_MAIN_HEADERS[mapping["unknown"]] == "Unknown/Void"
    assert LIVE_MAIN_HEADERS[mapping["units_pl"]] == "Units P&L (posted units)"
    assert LIVE_MAIN_HEADERS[mapping["pl"]] == "$ P&L (stake shown)"
    assert LIVE_MAIN_HEADERS[mapping["staked"]] == "$ staked (settled)"
    recon = header_map(
        ["Bets check", "Expected", "Actual", "Delta", "Status"],
        _RECON_ALIASES,
    )
    assert recon["bets_check"] == 0
    assert recon["expected"] == 1
    assert "check" not in recon
    legs = header_map(["Legs check", "Expected", "Actual"], _RECON_ALIASES)
    assert legs["legs_check"] == 0
    assert "check" not in legs


def test_live_record_splits_headers_parse_kinds_and_fade(tmp_path: Path):
    compact = parse_splits_grid(live_splits_grid(pad=0))
    shifted = parse_splits_grid(live_splits_grid(pad=11))
    assert [row["kind"] for row in compact["splits"]] == [
        row["kind"] for row in shifted["splits"]
    ]
    parsed = shifted
    alex_ticket = next(
        row
        for row in parsed["splits"]
        if row["who"] == "alexhandle" and row["kind"] == "ticket"
    )
    assert alex_ticket["record"] == "8-20-0"
    assert alex_ticket["flat_1u"] == pytest.approx(12.5)
    assert alex_ticket["fade_1u"] == pytest.approx(22.0)
    assert alex_ticket["fade_plus"] is True
    assert alex_ticket["fade_emphasis"] is True
    assert alex_ticket["units_pl"] == pytest.approx(4.2)
    assert alex_ticket["pl"] == pytest.approx(210)
    assert alex_ticket["staked"] == pytest.approx(800)
    alex_prop = next(
        row
        for row in parsed["splits"]
        if row["who"] == "alexhandle" and row["kind"] == "single_prop"
    )
    assert alex_prop["fade_emphasis"] is True
    assert alex_prop["klass"] == "prop"
    # Display column would have been "Alex (alexhandle)" / long class labels.
    assert all("(" not in row["who"] for row in parsed["splits"])
    assert {row["kind"] for row in parsed["splits"]} == {
        "ticket",
        "single_prop",
        "single_team",
        "leg_team",
        "leg_prop",
    }
    assert [row["check"] for row in parsed["checks"]] == [
        "Bets W vs splits",
        "Parlay legs vs splits",
    ]
    nfl = next(row for row in parsed["sports"] if row["sport"] == "NFL")
    assert nfl["who"] == "alexhandle"
    assert nfl["kind"] == "ticket"
    assert nfl["fade_1u"] == pytest.approx(14.0)

    path = tmp_path / "live-headers.xlsx"
    write_xlsx(path, {RECORD_SPLITS_TAB: live_splits_grid(pad=4)})
    exported = export_bets(from_path=path, store_dir=tmp_path / "out")
    assert exported["record_splits"]["check_count"] == 2
    assert any(
        row["who"] == "alexhandle" and row["kind"] == "ticket"
        for row in exported["record_splits"]["splits"]
    )


def test_display_class_labels_still_map_when_class_key_missing():
    headers = [
        "Bettor",
        "Source tab",
        "Class",
        "W",
        "L",
        "P",
        LIVE_FADE,
    ]
    grid = [
        ["spacer"],
        headers,
        ["Pat", "Bets", "single bets \u2013 team picks", 2, 1, 0, -0.2],
        ["Pat", "Bets", "whole parlay tickets", 1, 9, 0, 4.5],
        ["Pat", "Parlay Legs", "parlay legs \u2013 player props", 3, 3, 0, 0.9],
    ]
    parsed = parse_splits_grid(grid)
    kinds = {row["kind"] for row in parsed["splits"]}
    assert kinds == {"single_team", "ticket", "leg_prop"}
    ticket = next(row for row in parsed["splits"] if row["kind"] == "ticket")
    assert ticket["fade_1u"] == pytest.approx(4.5)
    assert ticket["fade_emphasis"] is True


def test_classify_live_headers_is_not_coordinate_based():
    assert classify_header_row(LIVE_MAIN_HEADERS) == "main"
    assert classify_header_row(["Bets check", "Expected", "Actual"]) == "recon"
    assert classify_header_row(["Legs check", "Expected", "Actual"]) == "recon"
    # Data row labeled "Bets check" must not start a new header section.
    assert classify_header_row(["Bets check", "12", "12", "0", "Pass"]) is None


# Live Record Splits reconciliation headers (tracker sheet). Columns move;
# the two long record labels are matched by prefix/suffix, not a guessed
# exact middle. Values are synthetic — not live bettor records.
LIVE_RECON_HEADERS = [
    "Bettor key",
    "Bets tab record",
    "Singles (team + prop) + tickets",
    "Bets check",
    "Parlay Legs record",
    "Leg splits (team + prop)",
    "Legs check",
]


def _recon_by_name(headers: list[str], values: dict[str, object]) -> list[object]:
    return [values[name] for name in headers]


def test_live_recon_headers_parse_record_pairs_and_flags():
    """Read the live pair-table headers by name, never by column index."""
    shuffled = [
        "Legs check",
        "Parlay Legs record",
        "Bettor key",
        "Leg splits vs legs tab",
        "Bets tab record",
        "Bets check",
        "Singles / tickets + tickets",
    ]
    assert shuffled[0] != LIVE_RECON_HEADERS[0]
    assert classify_header_row(LIVE_RECON_HEADERS) == "recon"
    assert classify_header_row(shuffled) == "recon"
    # A pair-table data row must not be treated as a new header.
    assert (
        classify_header_row(
            ["alexhandle", "8-20-0", "8-20-0", True, "4-2-0", "4-2-0", False]
        )
        is None
    )

    rows = [
        {
            "Bettor key": "*",
            "Bets tab record": "12-8-1",
            "Singles (team + prop) + tickets": "12-8-1",
            "Bets check": True,
            "Parlay Legs record": "20-10-0",
            "Leg splits (team + prop)": "20-10-0",
            "Legs check": True,
        },
        {
            "Bettor key": "alexhandle",
            "Bets tab record": "8-20-0",
            "Singles (team + prop) + tickets": "8-20-0",
            "Bets check": "TRUE",
            "Parlay Legs record": "4-2-0",
            "Leg splits (team + prop)": "4-2-1",
            "Legs check": False,
        },
        {
            "Bettor key": "jordanh",
            "Bets tab record": "3-2-1",
            "Singles (team + prop) + tickets": "3-2-0",
            "Bets check": False,
            "Parlay Legs record": "1-1-0",
            "Leg splits (team + prop)": "1-1-0",
            "Legs check": "FALSE",
        },
        {
            "Bettor key": "patk",
            "Bets tab record": "2-2-0",
            "Singles (team + prop) + tickets": "2-2-0",
            "Bets check": True,
            "Parlay Legs record": "0-1-0",
            "Leg splits (team + prop)": "0-1-0",
            "Legs check": True,
        },
        {
            "Bettor key": "samw",
            "Bets tab record": "1-0-0",
            "Singles (team + prop) + tickets": "1-0-0",
            "Bets check": True,
            "Parlay Legs record": "5-3-0",
            "Leg splits (team + prop)": "5-3-0",
            "Legs check": True,
        },
        {
            "Bettor key": "rileyq",
            "Bets tab record": "0-1-0",
            "Singles (team + prop) + tickets": "0-1-0",
            "Bets check": True,
            "Parlay Legs record": "2-2-0",
            "Leg splits (team + prop)": "2-2-0",
            "Legs check": True,
        },
        {
            "Bettor key": "casey",
            "Bets tab record": "4-4-0",
            "Singles (team + prop) + tickets": "4-4-0",
            "Bets check": True,
            "Parlay Legs record": "3-3-0",
            "Leg splits (team + prop)": "3-3-0",
            "Legs check": True,
        },
    ]
    grid = [
        ["Record Splits"],
        [],
        LIVE_RECON_HEADERS,
        *[_recon_by_name(LIVE_RECON_HEADERS, row) for row in rows],
    ]
    parsed = parse_splits_grid(grid)
    assert len(parsed["checks"]) == 7
    star = parsed["checks"][0]
    assert star["who"] == "*"
    assert star["bets_record"] == "12-8-1"
    assert star["singles_tickets"] == "12-8-1"
    assert star["bets_check"] is True
    assert star["legs_record"] == "20-10-0"
    assert star["leg_splits"] == "20-10-0"
    assert star["legs_check"] is True
    assert star.get("check") in {None, ""} or "check" not in star
    alex = next(row for row in parsed["checks"] if row["who"] == "alexhandle")
    assert alex["bets_check"] is True
    assert alex["legs_check"] is False
    assert alex["bets_record"] == "8-20-0"
    assert alex["leg_splits"] == "4-2-1"
    jordan = next(row for row in parsed["checks"] if row["who"] == "jordanh")
    assert jordan["bets_check"] is False
    assert jordan["legs_check"] is False
    assert {row["who"] for row in parsed["checks"]} == {
        "*",
        "alexhandle",
        "jordanh",
        "patk",
        "samw",
        "rileyq",
        "casey",
    }
    assert all(row.get("actual", "") == "" or "actual" not in row for row in parsed["checks"])

    # Same values, columns in a different order, slightly different long labels.
    shuffled_values = []
    rename = {
        "Singles (team + prop) + tickets": "Singles / tickets + tickets",
        "Leg splits (team + prop)": "Leg splits vs legs tab",
    }
    for row in rows:
        remapped = {rename.get(key, key): value for key, value in row.items()}
        shuffled_values.append(_recon_by_name(shuffled, remapped))
    shifted = parse_splits_grid([["spacer"], shuffled, *shuffled_values])
    assert [row["who"] for row in shifted["checks"]] == [row["who"] for row in parsed["checks"]]
    assert [row["bets_check"] for row in shifted["checks"]] == [
        row["bets_check"] for row in parsed["checks"]
    ]
    assert [row["legs_check"] for row in shifted["checks"]] == [
        row["legs_check"] for row in parsed["checks"]
    ]
    assert [row["singles_tickets"] for row in shifted["checks"]] == [
        row["singles_tickets"] for row in parsed["checks"]
    ]
    assert [row["leg_splits"] for row in shifted["checks"]] == [
        row["leg_splits"] for row in parsed["checks"]
    ]
