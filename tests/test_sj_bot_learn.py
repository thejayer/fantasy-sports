"""Per-signal Beta updates and the weekly note."""

from __future__ import annotations

from sj.bot.learn import iso_week, note_document, update_scorecard, update_weights
from sj.bot.signals import PRIOR_ALPHA, PRIOR_BETA, default_weights


def _pick(result: str, values: dict[str, float]) -> dict:
    return {
        "result": result,
        "sport": "NFL",
        "market": "spread",
        "clv": 0.5 if result == "W" else -0.5,
        "signals": [
            {"id": sid, "value": value, "weight": 0.5} for sid, value in values.items()
        ],
    }


def test_supporting_signal_gains_weight_on_a_win():
    weights = default_weights()
    before = weights["line_move"]["weight"]
    updated = update_weights(weights, _pick("W", {"line_move": 0.6, "fade": 0.0}))
    assert updated["line_move"]["alpha"] == PRIOR_ALPHA + 1
    assert updated["line_move"]["beta"] == PRIOR_BETA
    assert updated["line_move"]["hits"] == 1
    assert updated["line_move"]["weight"] > before
    assert updated["fade"]["alpha"] == PRIOR_ALPHA  # unused


def test_supporting_signal_loses_weight_on_a_loss():
    weights = default_weights()
    updated = update_weights(weights, _pick("L", {"line_move": 0.8}))
    assert updated["line_move"]["beta"] == PRIOR_BETA + 1
    assert updated["line_move"]["misses"] == 1
    assert updated["line_move"]["weight"] < 0.5


def test_opposing_signal_is_inverted():
    weights = default_weights()
    # line_move was against the pick, and the pick won → the fade-of-steam was right.
    updated = update_weights(weights, _pick("W", {"line_move": -0.7}))
    assert updated["line_move"]["beta"] == PRIOR_BETA + 1


def test_scorecard_and_weekly_note():
    card = update_scorecard({"rows": []}, _pick("W", {"line_move": 0.5}))
    card = update_scorecard(card, _pick("L", {"line_move": 0.5}))
    nfl = card["rows"][0]
    assert nfl["wins"] == 1
    assert nfl["losses"] == 1
    assert nfl["clv_n"] == 2
    before = default_weights()
    after = update_weights(before, _pick("W", {"line_move": 0.6}))
    note = note_document(week="2026-W43", before=before, after=after, graded=1, simulated=True)
    assert note["simulated"] is True
    assert note["title"] == "What I learned"
    assert "Line movement" in note["body"]
    assert note["markdown"].startswith("# What I learned")
    assert iso_week()
