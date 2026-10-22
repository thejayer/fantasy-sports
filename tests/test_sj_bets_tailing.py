"""Tailing parlay-leg math — synthetic only. Live acceptance is env-gated."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import pytest

from sj.bets import (
    DEFAULT_SHEET_TAB,
    FADE_AMERICAN,
    PARLAY_TAB,
    american_to_decimal,
    export_bets,
    header_map,
)
from sj.bets_parlay import _HEADER_ALIASES as PARLAY_ALIASES
from sj.bets_tailing import (
    ALL_WHO,
    assumed_breakeven,
    assumed_decimal,
    bucket_record,
    build_tailing_document,
    build_view,
    extract_selection_odds,
    filter_tailing_legs,
    join_legs,
    month_bucket,
    normalize_leg_sport,
    parent_decimal,
    parse_american_odds,
    platform_bucket,
    ticket_implied_decimal,
    ticket_size_bucket,
)


def _load_write_xlsx():
    path = Path(__file__).resolve().parent / "xlsx_write.py"
    spec = importlib.util.spec_from_file_location("xlsx_write_tailing", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.write_xlsx


write_xlsx = _load_write_xlsx()

ROOT = Path(__file__).resolve().parents[1]
TABS = ROOT / "tests" / "fixtures" / "bets" / "tracker_tabs.xlsx"


def _dec110() -> float:
    dec = american_to_decimal(FADE_AMERICAN)
    assert dec is not None
    return dec


def test_flat_110_tail_and_fade_match_prototype_formula():
    # 298-203-4 at −110 → tail +67.9u, fade −113.5u (acceptance, synthetic counts).
    rec = bucket_record(
        [{"res": "W"}] * 298 + [{"res": "L"}] * 203 + [{"res": "Push"}] * 4
    )
    assert rec["record"] == "298-203-4"
    assert rec["n"] == 501
    assert rec["hit"] == pytest.approx(298 / 501)
    assert rec["tail_110"] == pytest.approx(298 * (100 / 110) - 203, abs=0.05)
    assert rec["fade_110"] == pytest.approx(203 * (100 / 110) - 298, abs=0.05)
    assert rec["tail_110"] == pytest.approx(67.9, abs=0.05)
    assert rec["fade_110"] == pytest.approx(-113.5, abs=0.05)
    assert rec["small_sample"] is False
    assert rec["signal"] == "tail"


def test_small_sample_and_signal_thresholds():
    tiny = bucket_record([{"res": "W"}] * 12 + [{"res": "L"}] * 5)
    assert tiny["n"] == 17
    assert tiny["small_sample"] is True
    assert tiny["signal"] == "small_sample"
    avoid = bucket_record([{"res": "W"}] * 10 + [{"res": "L"}] * 12)
    assert avoid["signal"] == "avoid"
    marginal = bucket_record([{"res": "W"}] * 11 + [{"res": "L"}] * 10)
    assert marginal["hit"] == pytest.approx(11 / 21)
    assert assumed_breakeven() == pytest.approx(1 / assumed_decimal())
    assert 0.52 < assumed_breakeven() < 0.53
    assert marginal["signal"] == "marginal"


def test_ticket_implied_is_nth_root_and_labeled_estimate():
    implied = ticket_implied_decimal(8.70, 4)
    assert implied == pytest.approx(8.70**0.25)
    assert ticket_implied_decimal(None, 4) is None
    assert ticket_implied_decimal(1.91, 1) is None
    legs = [
        {
            "res": "W",
            "ticket_implied_dec": 1.7174,
            "leg_type": "Moneyline",
            "pick": "Team pick",
        },
        {
            "res": "W",
            "ticket_implied_dec": 1.7174,
            "leg_type": "Moneyline",
            "pick": "Team pick",
        },
        {
            "res": "L",
            "ticket_implied_dec": 1.7174,
            "leg_type": "Moneyline",
            "pick": "Team pick",
        },
    ]
    rec = bucket_record(legs)
    assert rec["ticket_implied_n"] == 3
    assert rec["ticket_implied_be"] == pytest.approx(1 / 1.7174)
    assert rec["ticket_implied_pl"] == pytest.approx(2 * (1.7174 - 1) - 1)


def test_value_and_blank_leg_odds_are_missing():
    assert parse_american_odds("") is None
    assert parse_american_odds("Value") is None
    assert parse_american_odds("Value ") is None
    assert parse_american_odds("-160") == -160
    assert parse_american_odds("+150") == 150
    assert parse_american_odds("1500") == 1500
    assert parse_american_odds("500") == 500


def test_selection_text_odds_join_by_name_not_column():
    pairs = extract_selection_odds(
        "Alpha City ML -160 / Beta Town ML -138 / Gamma FC ML -156"
    )
    assert [am for _ctx, am in pairs] == [-160, -138, -156]
    parent = {
        "id": "P-1",
        "bt": "Sportsbook parlay",
        "n": 3,
        "odds": "+770",
        "dec": 8.7,
        "legs": "Alpha City ML -160 / Beta Town ML -138 / Gamma FC ML -156",
    }
    raw_legs = [
        {
            "id": "P-1-1",
            "who": "Pat",
            "parent": "P-1",
            "res": "W",
            "sel": "Alpha City ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "MLB",
            "odds": "Value",
            "parent_n": 3,
            "parent_bt": "Sportsbook parlay",
        },
        {
            "id": "P-1-2",
            "who": "Pat",
            "parent": "P-1",
            "res": "W",
            "sel": "Beta Town ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "MLB",
            "odds": "",
            "parent_n": 3,
        },
        {
            "id": "P-1-3",
            "who": "Pat",
            "parent": "P-1",
            "res": "L",
            "sel": "Gamma FC ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "MLB",
            "odds": "",
            "parent_n": 3,
        },
    ]
    joined = join_legs(raw_legs, [parent])
    assert [row["odds_american"] for row in joined] == [-160, -138, -156]
    assert all(row["ticket_implied_dec"] == pytest.approx(8.7 ** (1 / 3)) for row in joined)
    assert all(row["platform"] == "Sportsbook parlay" for row in joined)


def test_sport_remap_other_plus_league_and_buckets():
    assert normalize_leg_sport("Other", "NHL") == "NHL"
    assert normalize_leg_sport("Other", "KBO") == "KBO/NPB"
    assert normalize_leg_sport("Tennis", "ATP") == "Tennis"
    assert normalize_leg_sport("MLB", "") == "MLB"
    assert ticket_size_bucket(2) == "2-3 legs"
    assert ticket_size_bucket(5) == "4-5 legs"
    assert ticket_size_bucket(6) == "6+ legs"
    assert month_bucket("2026-09-15") == "Sep"
    assert month_bucket("9/15/2026") == "Sep"
    assert platform_bucket("PrizePicks/DFS") == "PrizePicks"
    assert platform_bucket("Surgical Six") == "Surgical Six (PrizePicks)"
    assert platform_bucket("Sportsbook/team parlay") == "Sportsbook parlay"
    assert platform_bucket("parlay") == "Sportsbook parlay"


def test_parent_bt_on_leg_beats_bets_parlay_type():
    """Live Bets 'Bet type' is just 'parlay'; platform lives on parent_bt."""
    parent = {
        "id": "P-BT",
        "bt": "parlay",
        "book": "",
        "n": 2,
        "odds": "+100",
        "dec": 2.0,
    }
    raw_legs = [
        {
            "id": "P-BT-SX",
            "who": "Pat",
            "parent": "P-BT",
            "res": "W",
            "sel": "Club A ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "NFL",
            "parent_n": 2,
            "parent_bt": "Surgical Six",
        },
        {
            "id": "P-BT-SB",
            "who": "Pat",
            "parent": "P-BT",
            "res": "W",
            "sel": "Club B ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "NFL",
            "parent_n": 2,
            "parent_bt": "Sportsbook/team parlay",
        },
        {
            "id": "P-BT-PP",
            "who": "Pat",
            "parent": "P-BT",
            "res": "L",
            "sel": "Player A Over 1.5",
            "pick": "Player prop",
            "leg_type": "prop",
            "sport": "NFL",
            "dir": "Over",
            "stat": "Receptions",
            "parent_n": 2,
            "parent_bt": "PrizePicks",
        },
        {
            "id": "P-BT-BLANK",
            "who": "Pat",
            "parent": "P-BT",
            "res": "L",
            "sel": "Club C ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "NFL",
            "parent_n": 2,
            "parent_bt": "",
        },
    ]
    joined = join_legs(raw_legs, [parent])
    by_id = {row["id"]: row for row in joined}
    assert by_id["P-BT-SX"]["platform"] == "Surgical Six (PrizePicks)"
    assert by_id["P-BT-SB"]["platform"] == "Sportsbook parlay"
    assert by_id["P-BT-PP"]["platform"] == "PrizePicks"
    assert by_id["P-BT-BLANK"]["platform"] == "Sportsbook parlay"
    # Per-leg price split is sportsbook-only.
    assert by_id["P-BT-SB"]["ticket_implied_dec"] == pytest.approx(2.0**0.5)
    assert by_id["P-BT-BLANK"]["ticket_implied_dec"] == pytest.approx(2.0**0.5)
    assert by_id["P-BT-SX"]["ticket_implied_dec"] is None
    assert by_id["P-BT-PP"]["ticket_implied_dec"] is None
    doc = build_tailing_document(raw_legs, [parent], source="fixture:synthetic")
    plats = {row["key"] for row in doc["views"][0]["splits"]["platform"]}
    assert "Surgical Six (PrizePicks)" in plats
    assert "PrizePicks" in plats
    assert "Sportsbook parlay" in plats


def test_unsigned_parent_odds_are_plus_money_decimal_wins():
    """Unsigned 1500 / 500 are +1500 / +500; decimal column wins on conflict."""
    assert parent_decimal({"odds": "1500", "dec": 16.0}) == pytest.approx(16.0)
    assert parent_decimal({"odds": "500", "dec": 6.0}) == pytest.approx(6.0)
    assert parent_decimal({"odds": "1500", "dec": None}) == pytest.approx(16.0)
    assert parent_decimal({"odds": 500, "dec": None}) == pytest.approx(6.0)
    # American says -200 (1.5), decimal says 16 — trust decimal.
    assert parent_decimal({"odds": "-200", "dec": 16.0}) == pytest.approx(16.0)
    joined = join_legs(
        [
            {
                "id": "U-1",
                "who": "Pat",
                "parent": "U",
                "res": "W",
                "sel": "Club D ML",
                "pick": "Team pick",
                "leg_type": "ML",
                "sport": "NFL",
                "parent_n": 2,
                "parent_bt": "Sportsbook/team parlay",
            },
            {
                "id": "U-2",
                "who": "Pat",
                "parent": "U",
                "res": "L",
                "sel": "Club E ML",
                "pick": "Team pick",
                "leg_type": "ML",
                "sport": "NFL",
                "parent_n": 2,
                "parent_bt": "Sportsbook/team parlay",
            },
        ],
        [{"id": "U", "bt": "parlay", "n": 2, "odds": "1500", "dec": 16.0}],
    )
    assert all(row["ticket_implied_dec"] == pytest.approx(16.0**0.5) for row in joined)
    view = build_view(joined, "Pat")
    assert view["ml"]["record"] == "1-1-0"
    assert view["ml"]["ticket_implied_n"] == 2


def test_priced_sportsbook_ml_matches_trent_formula():
    """Synthetic equivalent of the live priced-sportsbook set: 72-41 at ~61.6% BE.

    Prototype 66-38 / 61.70% dropped two Oct 13 parents whose American
    odds were unsigned (1500 / 500 = +1500 / +500). PrizePicks / Surgical
    Six tickets are excluded even if a parent price is present.
    """
    implied = 1.0 / 0.616
    rows = (
        [
            {
                "res": "W",
                "platform": "Sportsbook parlay",
                "ticket_implied_dec": implied,
                "leg_type": "Moneyline",
                "pick": "Team pick",
            }
        ]
        * 72
        + [
            {
                "res": "L",
                "platform": "Sportsbook parlay",
                "ticket_implied_dec": implied,
                "leg_type": "Moneyline",
                "pick": "Team pick",
            }
        ]
        * 41
        + [
            {
                "res": "W",
                "platform": "PrizePicks",
                "ticket_implied_dec": 2.0,
                "leg_type": "Moneyline",
                "pick": "Team pick",
            }
        ]
        * 10
        + [
            {
                "res": "W",
                "platform": "Surgical Six (PrizePicks)",
                "ticket_implied_dec": 2.0,
                "leg_type": "Moneyline",
                "pick": "Team pick",
            }
        ]
        * 5
    )
    view = build_view(rows, "Pat")
    assert view["ml"]["record"] == "72-41-0"
    assert view["ml"]["ticket_implied_be"] == pytest.approx(0.616, abs=0.002)
    assert view["ml"]["ticket_implied_n"] == 113
    # All-ML (old definition) would have been 87-41; priced sportsbook is 72-41.
    assert view["overall"]["record"] == "87-41-0"


def _synthetic_rows() -> tuple[list[dict], list[dict]]:
    """Scrubbed in-memory tracker: no live amounts, names, or sheet cells."""
    bets = [
        {
            "id": "SYN-SB",
            "who": "Pat",
            "bt": "Sportsbook parlay",
            "n": 4,
            "odds": "+400",
            "dec": 5.0,
            "legs": "North ML -120 / East ML -130 / West ML -140 / South ML -110",
            "res": "L",
        },
        {
            "id": "SYN-PP",
            "who": "Pat",
            "bt": "PrizePicks",
            "n": 4,
            "odds": "",
            "dec": None,
            "legs": "Player A Over 1.5 / Player B Under 2.5",
            "res": "W",
        },
        {
            "id": "SYN-LC",
            "who": "laurencowling",
            "bt": "PrizePicks",
            "n": 2,
            "odds": "",
            "dec": None,
            "res": "W",
        },
        {
            "id": "SYN-Z",
            "who": "Lockedin_Sportz",
            "bt": "Sportsbook parlay",
            "n": 2,
            "odds": "+100",
            "dec": 2.0,
            "res": "L",
        },
    ]
    legs = [
        {
            "id": "SYN-SB-1",
            "who": "Pat",
            "parent": "SYN-SB",
            "res": "W",
            "sel": "North ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "MLB",
            "gd": "2026-09-01",
            "odds": "",
            "parent_n": 4,
            "parent_bt": "Sportsbook parlay",
        },
        {
            "id": "SYN-SB-2",
            "who": "Pat",
            "parent": "SYN-SB",
            "res": "W",
            "sel": "East ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "MLB",
            "gd": "2026-09-01",
            "odds": "",
            "parent_n": 4,
        },
        {
            "id": "SYN-SB-3",
            "who": "Pat",
            "parent": "SYN-SB",
            "res": "L",
            "sel": "West ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "MLB",
            "gd": "2026-09-01",
            "odds": "",
            "parent_n": 4,
        },
        {
            "id": "SYN-SB-4",
            "who": "Pat",
            "parent": "SYN-SB",
            "res": "W",
            "sel": "South ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "NFL",
            "gd": "2026-10-04",
            "odds": "",
            "parent_n": 4,
        },
        {
            "id": "SYN-PP-1",
            "who": "Pat",
            "parent": "SYN-PP",
            "res": "W",
            "sel": "Player A Over 1.5 Hits",
            "pick": "Player prop",
            "leg_type": "player prop",
            "sport": "MLB",
            "stat": "Hits",
            "dir": "Over",
            "gd": "2026-09-02",
            "odds": "Value",
            "parent_n": 4,
            "parent_bt": "PrizePicks",
        },
        {
            "id": "SYN-PP-2",
            "who": "Pat",
            "parent": "SYN-PP",
            "res": "W",
            "sel": "Player B Under 2.5 Hits",
            "pick": "Player prop",
            "leg_type": "player prop",
            "sport": "MLB",
            "stat": "Hits",
            "dir": "Under",
            "gd": "2026-09-02",
            "odds": "",
            "parent_n": 4,
        },
        {
            "id": "SYN-PP-3",
            "who": "Pat",
            "parent": "SYN-PP",
            "res": "L",
            "sel": "Player C Over 0.5 HR",
            "pick": "Player prop",
            "leg_type": "player prop",
            "sport": "MLB",
            "stat": "Home runs",
            "dir": "Over",
            "gd": "2026-10-05",
            "odds": "",
            "parent_n": 4,
        },
        {
            "id": "SYN-PP-4",
            "who": "Pat",
            "parent": "SYN-PP",
            "res": "Push",
            "sel": "Player D Over 6.5",
            "pick": "Player prop",
            "leg_type": "player prop",
            "sport": "MLB",
            "stat": "Hitter fantasy score",
            "dir": "Over",
            "gd": "2026-10-05",
            "odds": "",
            "parent_n": 4,
        },
        {
            "id": "SYN-NHL-1",
            "who": "Pat",
            "parent": "SYN-PP",
            "res": "W",
            "sel": "Club A ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "Other",
            "lg": "NHL",
            "gd": "2026-10-06",
            "odds": "",
            "parent_n": 4,
        },
        {
            "id": "SYN-LC-1",
            "who": "laurencowling",
            "parent": "SYN-LC",
            "res": "W",
            "sel": "Player E Over 20.5",
            "pick": "Player prop",
            "leg_type": "player prop",
            "sport": "NFL",
            "stat": "Rush yards",
            "dir": "Over",
            "gd": "2026-10-06",
            "parent_n": 2,
            "parent_bt": "PrizePicks",
        },
        {
            "id": "SYN-LC-2",
            "who": "laurencowling",
            "parent": "SYN-LC",
            "res": "L",
            "sel": "Player F Over 40.5",
            "pick": "Player prop",
            "leg_type": "player prop",
            "sport": "NFL",
            "stat": "Rec yards",
            "dir": "Over",
            "gd": "2026-10-06",
            "parent_n": 2,
        },
        {
            "id": "SYN-Z-1",
            "who": "Lockedin_Sportz",
            "parent": "SYN-Z",
            "res": "L",
            "sel": "Club B ML",
            "pick": "Team pick",
            "leg_type": "ML",
            "sport": "NFL",
            "gd": "2026-10-07",
            "parent_n": 2,
            "parent_bt": "Sportsbook parlay",
        },
        {
            "id": "SYN-PEND",
            "who": "Pat",
            "parent": "SYN-PP",
            "res": "Pending",
            "sel": "Player G Over 1.5",
            "pick": "Player prop",
            "leg_type": "player prop",
            "sport": "NBA",
            "stat": "Points",
            "dir": "Over",
            "gd": "2026-10-20",
        },
        {
            "id": "SYN-VOID",
            "who": "Pat",
            "parent": "SYN-PP",
            "res": "Void",
            "sel": "Player H Over 1.5",
            "pick": "Player prop",
            "leg_type": "player prop",
            "sport": "NBA",
            "dir": "Over",
            "gd": "2026-10-20",
        },
    ]
    return legs, bets


def test_build_document_splits_filters_and_hypothetical_1u():
    legs, bets = _synthetic_rows()
    doc = build_tailing_document(legs, bets, source="fixture:synthetic")
    assert doc["settled_count"] == 12  # pending + void excluded
    assert doc["assumed_odds"] == -110
    assert "approximate" in doc["odds_note"].lower() or "−110" in doc["odds_note"]
    whos = {view["who"] for view in doc["views"]}
    assert whos == {ALL_WHO, "Pat", "laurencowling", "Lockedin_Sportz"}
    pat = next(view for view in doc["views"] if view["who"] == "Pat")
    assert pat["overall"]["record"] == "6-2-1"
    assert pat["overall"]["hit"] == pytest.approx(6 / 8)
    dec = _dec110()
    assert pat["overall"]["tail_110"] == pytest.approx(6 * (dec - 1) - 2)
    assert pat["overall"]["fade_110"] == pytest.approx(2 * (dec - 1) - 6)
    sports = {row["key"]: row for row in pat["splits"]["sport"]}
    assert sports["NHL"]["record"] == "1-0-0"
    assert sports["MLB"]["wins"] >= 1
    months = {row["key"]: row for row in pat["splits"]["month"]}
    assert months["Sep"]["record"] == "4-1-0"
    assert months["Oct"]["record"] == "2-1-1"
    dirs = {row["key"]: row for row in pat["splits"]["direction"]}
    assert dirs["Under"]["record"] == "1-0-0"
    plats = {row["key"]: row for row in pat["splits"]["platform"]}
    assert "PrizePicks" in plats and "Sportsbook parlay" in plats
    sizes = {row["key"]: row for row in pat["splits"]["ticket_size"]}
    assert sizes["4-5 legs"]["n"] >= 1
    locked = next(view for view in doc["views"] if view["who"] == "Lockedin_Sportz")
    assert locked["hypothetical_1u"] is True
    mlb_props = filter_tailing_legs(
        doc["legs"], who="Pat", sport="MLB", pick="Player prop"
    )
    rec = bucket_record(mlb_props)
    assert rec["record"] == "2-1-1"
    unders = filter_tailing_legs(doc["legs"], who="Pat", ou="Under")
    assert bucket_record(unders)["record"] == "1-0-0"
    assert all(leg["res"] in {"W", "L", "Push"} for leg in doc["legs"])


def test_header_name_join_prefers_bettor_key_in_shuffled_xlsx(tmp_path: Path):
    """Live-like headers, shuffled columns — never A1 / column index."""
    bets_headers = [
        "Notes",
        "Result",
        "Bettor",
        "Bettor key",
        "Bet ID",
        "Bet type",
        "# Legs",
        "Odds (American)",
        "Odds (decimal)",
        "Selection/legs",
    ]
    parlay_headers = [
        "Notes",
        "Leg result",
        "Bettor",
        "Bettor key",
        "Leg ID",
        "Parent bet ID",
        "Pick group",
        "Leg type",
        "Sport",
        "League/event",
        "Direction",
        "Stat category",
        "Team/selection",
        "Game date",
        "Parent bet type",
        "Parent # legs",
        "Leg odds",
    ]
    mapping = header_map(parlay_headers, PARLAY_ALIASES)
    assert parlay_headers[mapping["who"]] == "Bettor key"
    assert parlay_headers[mapping["parent"]] == "Parent bet ID"
    bets_row = {
        "Notes": "",
        "Result": "W",
        "Bettor": "Alex (alexhandle)",
        "Bettor key": "alexhandle",
        "Bet ID": "S-9",
        "Bet type": "Sportsbook parlay",
        "# Legs": 2,
        "Odds (American)": "+100",
        "Odds (decimal)": 2.0,
        "Selection/legs": "Unit A ML -150 / Unit B ML -130",
    }
    leg_a = {
        "Notes": "",
        "Leg result": "W",
        "Bettor": "Alex (alexhandle)",
        "Bettor key": "alexhandle",
        "Leg ID": "S-9-1",
        "Parent bet ID": "S-9",
        "Pick group": "Team pick",
        "Leg type": "ML",
        "Sport": "MLB",
        "League/event": "MLB",
        "Direction": "",
        "Stat category": "",
        "Team/selection": "Unit A ML",
        "Game date": "2026-09-08",
        "Parent bet type": "Sportsbook parlay",
        "Parent # legs": 2,
        "Leg odds": "Value",
    }
    leg_b = {
        **leg_a,
        "Leg ID": "S-9-2",
        "Leg result": "L",
        "Team/selection": "Unit B ML",
    }
    path = tmp_path / "tailing-headers.xlsx"
    write_xlsx(
        path,
        {
            DEFAULT_SHEET_TAB: [
                bets_headers,
                [bets_row[h] for h in bets_headers],
            ],
            PARLAY_TAB: [
                ["Parlay Legs — synthetic, not live"],
                parlay_headers,
                [leg_a[h] for h in parlay_headers],
                [leg_b[h] for h in parlay_headers],
            ],
        },
    )
    result = export_bets(from_path=path, store_dir=tmp_path / "out")
    # Existing feeds still written; record_splits empty is fine.
    assert "record_splits" in result
    tail = result["tailing_legs"]
    assert tail["settled_count"] == 2
    view = next(row for row in tail["views"] if row["who"] == "alexhandle")
    assert view["overall"]["record"] == "1-1-0"
    assert all(leg["who"] == "alexhandle" for leg in tail["legs"])
    assert {leg["odds_american"] for leg in tail["legs"]} == {-150, -130}
    implied = 2.0 ** 0.5
    assert all(leg["ticket_implied_dec"] == pytest.approx(implied) for leg in tail["legs"])


def test_tracker_tabs_export_still_writes_record_splits(tmp_path: Path):
    result = export_bets(from_path=TABS, store_dir=tmp_path)
    assert result["record_splits"]["split_count"] > 0
    assert result["tailing_legs"]["settled_count"] > 0
    assert result["tailing_legs"]["leg_count"] == result["parlay_legs"]["leg_count"]


def _live_fixture_path() -> Path | None:
    raw = os.environ.get("SJ_BETS_LIVE_FIXTURE", "").strip()
    if raw:
        path = Path(raw)
        return path if path.is_file() else None
    return None


def _can_fetch_live_sheet() -> bool:
    if os.environ.get("SJ_BETS_SYNC", "1") == "0":
        return False
    adc = Path.home() / ".config" / "gcloud" / "application_default_credentials.json"
    return adc.is_file() or bool(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"))


@pytest.mark.skipif(
    _live_fixture_path() is None and not _can_fetch_live_sheet(),
    reason="Needs SJ_BETS_LIVE_FIXTURE or sheet credentials; skipped in public CI.",
)
def test_trent_acceptance_from_live_or_env_fixture(tmp_path: Path):
    """Oct 21 snapshot numbers. Not committed. May drift if the sheet moves on."""
    fixture = _live_fixture_path()
    if fixture is not None:
        result = export_bets(from_path=fixture, store_dir=tmp_path)
    else:
        result = export_bets(store_dir=tmp_path)
    tail = result["tailing_legs"]
    trent = next(view for view in tail["views"] if view["who"] == "Trent")
    overall = trent["overall"]
    assert overall["record"] == "298-203-4"
    assert overall["hit"] == pytest.approx(0.595, abs=0.0006)
    assert overall["tail_110"] == pytest.approx(67.9, abs=0.06)
    assert overall["fade_110"] == pytest.approx(-113.5, abs=0.06)
    months = {row["key"]: row for row in trent["splits"]["month"]}
    assert months["Sep"]["record"] == "141-75-0" or months["Sep"]["record"].startswith(
        "141-75"
    )
    assert months["Oct"]["record"] == "65-63-1" or months["Oct"]["record"].startswith(
        "65-63"
    )
    mlb_props = filter_tailing_legs(
        [leg for leg in tail["legs"] if leg["who"] == "Trent"],
        sport="MLB",
        pick="Player prop",
    )
    assert bucket_record(mlb_props)["record"] == "84-60-3"
    unders = filter_tailing_legs(
        [leg for leg in tail["legs"] if leg["who"] == "Trent"],
        pick="Player prop",
        ou="Under",
    )
    assert bucket_record(unders)["record"] == "22-10-1"
    ml = trent.get("ml") or {}
    # Prototype 66-38 / 61.70% dropped two Oct 13 parents whose American
    # odds were unsigned (1500 / 500 → +1500 / +500). Priced sportsbook
    # legs only — not PrizePicks / Surgical Six.
    assert ml.get("record", "").startswith("72-41")
    assert ml.get("ticket_implied_be") == pytest.approx(0.616, abs=0.002)
