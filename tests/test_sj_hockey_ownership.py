"""H7 ESPN ownership — offline; the ESPN endpoint is a stub."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from sj.hockey_ownership import attach_hockey_ownership, fetch_espn_ownership, parse_ownership


def _payload(rows: dict[int, tuple[float, float]]) -> dict:
    return {"players": [
        {"id": pid, "player": {"id": pid, "ownership": {
            "percentOwned": owned, "percentChange": change, "percentStarted": owned / 2}}}
        for pid, (owned, change) in rows.items()
    ]}


def test_parse_ownership_skips_rows_without_percent_owned():
    payload = _payload({1: (99.51, 0.13)})
    payload["players"].append({"id": 2, "player": {"id": 2, "ownership": {}}})
    assert parse_ownership(payload) == {1: {"owned": 99.51, "change": 0.13, "started": 49.76}}
    assert parse_ownership(None) == {}


class _Espn:
    """Stub league_get: 400 on the first request shape when told to."""

    def __init__(self, data: dict[int, tuple[float, float]], *, fail_first: bool = False):
        self.data, self.fail_first, self.calls = data, fail_first, []

    def league_get(self, params=None, headers=None):
        self.calls.append(params["view"])
        if self.fail_first and params["view"] == "kona_player_info":
            raise RuntimeError("ESPN returned an HTTP 400")
        ids = json.loads(headers["x-fantasy-filter"])["players"]["filterIds"]["value"]
        if params["view"] == "kona_player_info":
            # The shape that works live: scoringPeriodId + a sort next to filterIds.
            assert "scoringPeriodId" in params
            assert "sortPercOwned" in json.loads(headers["x-fantasy-filter"])["players"]
        return _payload({i: self.data[i] for i in ids if i in self.data})


def _league(espn: _Espn) -> SimpleNamespace:
    return SimpleNamespace(espn_request=espn, scoringPeriodId=1)


def test_fetch_chunks_and_falls_back_to_playercard():
    data = {i: (50.0 + i % 40, 0.5) for i in range(1, 121)}
    espn = _Espn(data, fail_first=True)
    got = fetch_espn_ownership(_league(espn), sorted(data))
    assert len(got) == 120
    # 3 chunks of 50: each tries kona_player_info, then kona_playercard.
    assert espn.calls.count("kona_playercard") == 3


def test_fetch_raises_only_when_everything_failed():
    class Dead:
        def league_get(self, **_):
            raise RuntimeError("down")

    with pytest.raises(RuntimeError, match="down"):
        fetch_espn_ownership(SimpleNamespace(espn_request=Dead(), scoringPeriodId=1), [1, 2])
    assert fetch_espn_ownership(SimpleNamespace(), [1]) == {}


def test_attach_writes_rostered_and_free_agents(capsys):
    snapshot = {
        "league_id": "hockey-main",
        "teams": [{"roster": [{"id": 1}, {"id": 2}]}],
        "free_agents": [{"id": 3}, {"id": 4}],
    }
    espn = _Espn({1: (99.5, 0.1), 2: (88.0, -0.4), 3: (74.4, 2.04)})
    assert attach_hockey_ownership(_league(espn), snapshot) == 3
    assert snapshot["teams"][0]["roster"][1]["percent_change"] == -0.4
    assert snapshot["free_agents"][0]["percent_owned"] == 74.4
    assert "percent_owned" not in snapshot["free_agents"][1]
    assert "3/4 players" in capsys.readouterr().err


def test_attach_never_fails_the_sync(capsys):
    class Dead:
        def league_get(self, **_):
            raise RuntimeError("ESPN down")

    snapshot = {"league_id": "hockey-main", "teams": [{"roster": [{"id": 1}]}], "free_agents": []}
    assert attach_hockey_ownership(SimpleNamespace(espn_request=Dead(), scoringPeriodId=1), snapshot) == 0
    assert "ESPN down" in capsys.readouterr().err
    assert "percent_owned" not in snapshot["teams"][0]["roster"][0]


def test_values_carry_ownership_and_drop_the_missing_sentinel():
    from nhl.value import _owned

    assert _owned(74.36) == 74.36
    assert _owned(-1) is None
    assert _owned(None) is None


def test_fixture_values_have_ownership():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    doc = json.loads((root / "fixtures/sj/hockey-main/2027/nhl/values.json").read_text("utf-8"))
    players = doc["players"].values()
    assert sum(p["percent_owned"] is not None for p in players) > 50
    assert any(p.get("percent_change") for p in players)
