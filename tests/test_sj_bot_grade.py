"""W/L/P, units, and CLV for SJ Bot paper bets."""

from __future__ import annotations

from sj.bot.grade import (
    apply_grade,
    closing_market,
    compute_clv,
    grade_result,
    ml_clv,
    spread_clv,
    total_clv,
    units_pl,
)


def test_spread_cover_push_and_loss():
    assert grade_result(market="spread", side="away", line=-3.5, away_score=27, home_score=20) == "W"
    assert grade_result(market="spread", side="away", line=-7.0, away_score=27, home_score=20) == "P"
    assert grade_result(market="spread", side="away", line=-8.5, away_score=27, home_score=20) == "L"
    assert grade_result(market="spread", side="home", line=3.5, away_score=27, home_score=20) == "L"
    assert grade_result(market="spread", side="home", line=7.5, away_score=27, home_score=20) == "W"


def test_total_and_moneyline():
    assert grade_result(market="total", side="over", line=44.5, away_score=27, home_score=20) == "W"
    assert grade_result(market="total", side="under", line=44.5, away_score=27, home_score=20) == "L"
    assert grade_result(market="total", side="over", line=47.0, away_score=27, home_score=20) == "P"
    assert grade_result(market="ml", side="away", line=None, away_score=27, home_score=20) == "W"
    assert grade_result(market="ml", side="home", line=None, away_score=27, home_score=20) == "L"
    assert grade_result(market="ml", side="away", line=None, away_score=10, home_score=10) == "P"
    assert grade_result(market="spread", side="away", line=-3, away_score=None, home_score=20) == "Pending"


def test_units_and_clv():
    assert units_pl("W", 1, -110) == 0.9091
    assert units_pl("L", 1, -110) == -1
    assert units_pl("P", 2, -110) == 0
    assert units_pl("Pending", 1, -110) is None
    assert spread_clv(-3.5, -4.5) == 1.0
    assert spread_clv(3.5, 2.5) == 1.0
    assert total_clv("over", 44.5, 46.5) == 2.0
    assert total_clv("under", 44.5, 43.5) == 1.0
    assert ml_clv(150, 120) is not None
    assert ml_clv(150, 120) > 0  # we got a better plus-money price


def test_closing_market_uses_last_snapshot_before_kickoff():
    snaps = [
        {
            "captured_at": "2026-10-26T12:00:00+00:00",
            "games": [
                {
                    "id": "g1",
                    "markets": [{"type": "spread", "side": "away", "line": -3.0, "american": -110}],
                }
            ],
        },
        {
            "captured_at": "2026-10-26T16:30:00+00:00",
            "games": [
                {
                    "id": "g1",
                    "markets": [{"type": "spread", "side": "away", "line": -3.5, "american": -110}],
                }
            ],
        },
        {
            "captured_at": "2026-10-26T18:00:00+00:00",
            "games": [
                {
                    "id": "g1",
                    "markets": [{"type": "spread", "side": "away", "line": -4.0, "american": -110}],
                }
            ],
        },
    ]
    close = closing_market(
        snaps,
        game_id="g1",
        market="spread",
        side="away",
        kickoff="2026-10-26T17:00:00+00:00",
    )
    assert close["line"] == -3.5
    graded = apply_grade(
        {
            "market": "spread",
            "side": "away",
            "line": -3.0,
            "american": -110,
            "units": 1,
        },
        "W",
        close,
    )
    assert graded["result"] == "W"
    assert graded["clv"] == 0.5
    assert graded["units_pl"] == 0.9091
    assert compute_clv({"market": "spread", "side": "away", "line": -3}, None)["clv"] is None
