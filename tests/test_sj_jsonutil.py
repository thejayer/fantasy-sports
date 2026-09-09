"""Snapshot JSON must be standard JSON — no Infinity / NaN tokens."""

from __future__ import annotations

import json

from sj.jsonutil import dumps_snapshot, is_nonfinite_number, sanitize_nonfinite
from sj.store import _dump


def test_dumps_snapshot_converts_nonfinite_floats_to_null():
    text = dumps_snapshot(
        {
            "ERA": float("inf"),
            "WHIP": float("-inf"),
            "AVG": float("nan"),
            "ok": 3.2,
            "nested": {"GAA": float("inf"), "line": [1.0, float("nan")]},
        }
    )
    assert "Infinity" not in text
    assert "NaN" not in text
    parsed = json.loads(text)
    assert parsed["ERA"] is None
    assert parsed["WHIP"] is None
    assert parsed["AVG"] is None
    assert parsed["ok"] == 3.2
    assert parsed["nested"]["GAA"] is None
    assert parsed["nested"]["line"] == [1.0, None]


def test_dumps_snapshot_keeps_indent_and_sort_keys():
    text = dumps_snapshot({"z": 1, "a": float("inf")})
    expected = json.dumps({"a": None, "z": 1}, indent=2, sort_keys=True) + "\n"
    assert text == expected


def test_store_dump_refuses_infinity_nan_substring():
    text = _dump(
        {
            "free_agents": [
                {
                    "id": 1,
                    "name": "Reliever",
                    "trailing_stats": {
                        "7": {"ERA": float("inf"), "WHIP": float("nan")}
                    },
                }
            ]
        }
    )
    assert "Infinity" not in text
    assert "NaN" not in text
    again = json.dumps(json.loads(text), indent=2, sort_keys=True) + "\n"
    assert again == text


def test_sanitize_and_is_nonfinite():
    assert is_nonfinite_number(float("inf"))
    assert is_nonfinite_number(float("-inf"))
    assert is_nonfinite_number(float("nan"))
    assert is_nonfinite_number("Infinity")
    assert not is_nonfinite_number(3.2)
    assert not is_nonfinite_number(None)
    assert not is_nonfinite_number(True)
    assert sanitize_nonfinite({"ERA": float("inf")}) == {"ERA": None}
