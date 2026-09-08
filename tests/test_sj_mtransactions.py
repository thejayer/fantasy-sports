"""Unit tests for the historical ``mTransactions2`` fallback (no live ESPN)."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from espn_api.requests.espn_requests import ESPNAccessDenied, ESPNInvalidLeague

from sj.mtransactions import (
    DEFAULT_TXN_MAX_PERIODS,
    DEFAULT_TXN_PERIOD_THROTTLE,
    MAX_TXN_MAX_PERIODS,
    discover_scoring_periods,
    fetch_transactions_mview,
    normalize_mtransaction,
    txn_max_periods,
    txn_period_throttle,
)
from sj.serialize import serialize_activity, serialize_league
from sj.sync import ACTIVITY_MIN_SEASON, fetch_recent_activity

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "mtransactions2" / "baseball_2024.json"

PLAYER_MAP = {
    123: "Shohei Ohtani",
    456: "Aaron Judge",
    555: "Juan Soto",
    777: "Mookie Betts",
    789: "Freddie Freeman",
    321: "Dropped Bat",
    999: "Draft Pick",
}


def _fixture_by_period() -> dict[int, dict]:
    raw = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    return {int(key): value for key, value in raw.items()}


def _league_for_mview(
    *,
    year: int = 2024,
    last_period: int = 3,
    by_period: dict[int, dict] | None = None,
    league_get=None,
) -> SimpleNamespace:
    pages = by_period if by_period is not None else _fixture_by_period()

    def _get(params=None, headers=None, extend=""):
        del headers, extend
        period = int((params or {})["scoringPeriodId"])
        return pages.get(period, {"transactions": []})

    request = SimpleNamespace(league_get=league_get or _get)
    teams = {n: SimpleNamespace(team_id=n) for n in range(1, 7)}

    def get_team_data(team_id):
        return teams.get(int(team_id))

    return SimpleNamespace(
        year=year,
        firstScoringPeriod=1,
        finalScoringPeriod=last_period,
        scoringPeriodId=last_period,
        current_week=last_period,
        player_map=PLAYER_MAP,
        get_team_data=get_team_data,
        espn_request=request,
        recent_activity=MagicMock(side_effect=ESPNInvalidLeague("League 1 does not exist")),
    )


def test_txn_max_periods_from_env(monkeypatch):
    monkeypatch.delenv("SJ_TXN_MAX_PERIODS", raising=False)
    assert txn_max_periods() == DEFAULT_TXN_MAX_PERIODS
    monkeypatch.setenv("SJ_TXN_MAX_PERIODS", "12")
    assert txn_max_periods() == 12
    monkeypatch.setenv("SJ_TXN_MAX_PERIODS", "9999")
    assert txn_max_periods() == MAX_TXN_MAX_PERIODS
    monkeypatch.setenv("SJ_TXN_MAX_PERIODS", "nope")
    assert txn_max_periods() == DEFAULT_TXN_MAX_PERIODS


def test_txn_period_throttle_from_env(monkeypatch):
    monkeypatch.delenv("SJ_TXN_PERIOD_THROTTLE", raising=False)
    assert txn_period_throttle() == DEFAULT_TXN_PERIOD_THROTTLE
    monkeypatch.setenv("SJ_TXN_PERIOD_THROTTLE", "0.5")
    assert txn_period_throttle() == 0.5
    monkeypatch.setenv("SJ_TXN_PERIOD_THROTTLE", "nope")
    assert txn_period_throttle() == DEFAULT_TXN_PERIOD_THROTTLE


def test_discover_scoring_periods_uses_final_and_includes_zero():
    league = SimpleNamespace(finalScoringPeriod=18, firstScoringPeriod=1)
    periods = discover_scoring_periods(league)
    assert periods[0] == 0
    assert periods[-1] == 18
    assert len(periods) == 19


def test_discover_scoring_periods_empty_without_status():
    assert discover_scoring_periods(SimpleNamespace()) == []
    assert discover_scoring_periods(MagicMock()) == []


def test_discover_scoring_periods_caps(monkeypatch):
    monkeypatch.setenv("SJ_TXN_MAX_PERIODS", "5")
    league = SimpleNamespace(finalScoringPeriod=187)
    assert discover_scoring_periods(league) == [0, 1, 2, 3, 4]


def test_normalize_skips_proposals_and_pending():
    raw = {
        "id": "proposal-1",
        "type": "TRADE_PROPOSAL",
        "status": "PENDING",
        "isPending": True,
        "items": [{"playerId": 1, "fromTeamId": 1, "toTeamId": 2, "type": "TRADE"}],
    }
    assert normalize_mtransaction(raw) is None


def test_normalize_trade_resolves_names_and_both_sides():
    raw = _fixture_by_period()[1]["transactions"][0]
    activity = normalize_mtransaction(
        raw,
        player_map=PLAYER_MAP,
        get_team_data=lambda tid: SimpleNamespace(team_id=tid),
    )
    assert activity is not None
    assert activity.date == 1710000000000
    serialized = serialize_activity(activity)
    actions = serialized["actions"]
    labels = {row["action"] for row in actions}
    assert "TRADE_SENT" in labels
    assert "TRADE_RECEIVED" in labels
    names = {row["player_name"] for row in actions}
    assert names == {"Shohei Ohtani", "Aaron Judge"}
    assert all(row["team_id"] in {1, 2} for row in actions)


def test_normalize_waiver_keeps_bid():
    raw = _fixture_by_period()[2]["transactions"][1]
    activity = normalize_mtransaction(
        raw,
        player_map=PLAYER_MAP,
        get_team_data=lambda tid: SimpleNamespace(team_id=tid),
    )
    serialized = serialize_activity(activity)
    assert serialized["actions"] == [
        {
            "team_id": 4,
            "action": "WAIVER ADDED",
            "player_id": 555,
            "player_name": "Juan Soto",
            "bid_amount": 12.0,
        }
    ]


def test_fetch_transactions_mview_dedupes_and_throttles():
    sleeps: list[float] = []
    seen_periods: list[int] = []
    pages = _fixture_by_period()

    def league_get(params=None, headers=None, extend=""):
        del headers, extend
        period = int((params or {})["scoringPeriodId"])
        seen_periods.append(period)
        return pages.get(period, {"transactions": []})

    league = _league_for_mview(league_get=league_get)
    items = fetch_transactions_mview(
        league,
        throttle_seconds=0.15,
        sleep=sleeps.append,
        call=lambda fn, **_k: fn(),
    )
    # 0..3 inclusive → 3 gaps throttled.
    assert seen_periods == [0, 1, 2, 3]
    assert sleeps == [0.15, 0.15, 0.15]
    # trade-accept-1 is in periods 1 and 2 — one row after dedupe.
    serialized = [serialize_activity(row) for row in items]
    trade_rows = [
        row
        for row in serialized
        if any("TRADE" in (action["action"] or "") for action in row["actions"])
    ]
    assert len(trade_rows) == 2  # TRADE_ACCEPT + TRADE_UPHOLD
    ids_as_dates = [row["date"] for row in serialized]
    assert ids_as_dates == sorted(ids_as_dates, reverse=True)
    assert any(
        action["action"] == "FA ADDED" and action["player_name"] == "Freddie Freeman"
        for row in serialized
        for action in row["actions"]
    )
    assert any(
        action["action"] == "DRAFT" and action["player_name"] == "Draft Pick"
        for row in serialized
        for action in row["actions"]
    )
    # Pending proposal is dropped.
    assert all(
        action["player_name"] != "888"
        for row in serialized
        for action in row["actions"]
    )


def test_fetch_transactions_mview_skips_invalid_period():
    def league_get(params=None, headers=None, extend=""):
        del headers, extend
        period = int((params or {})["scoringPeriodId"])
        if period == 1:
            raise ESPNInvalidLeague("League 1 does not exist")
        if period == 2:
            return {
                "transactions": [
                    {
                        "id": "fa-only",
                        "type": "FREEAGENT",
                        "status": "EXECUTED",
                        "teamId": 3,
                        "processDate": 1,
                        "items": [
                            {
                                "playerId": 789,
                                "fromTeamId": 0,
                                "toTeamId": 3,
                                "type": "ADD",
                            }
                        ],
                    }
                ]
            }
        return {"transactions": []}

    league = _league_for_mview(last_period=2, league_get=league_get)
    items = fetch_transactions_mview(
        league, throttle_seconds=0, call=lambda fn, **_k: fn()
    )
    assert len(items) == 1
    assert serialize_activity(items[0])["actions"][0]["action"] == "FA ADDED"


def test_fetch_transactions_mview_raises_access_denied():
    def league_get(**_kwargs):
        raise ESPNAccessDenied("nope")

    league = _league_for_mview(last_period=1, league_get=league_get)
    with pytest.raises(ESPNAccessDenied):
        fetch_transactions_mview(league, throttle_seconds=0, call=lambda fn, **_k: fn())


def test_fetch_recent_activity_falls_back_when_unsupported(monkeypatch):
    monkeypatch.setattr("sj.mtransactions.time.sleep", lambda *_a, **_k: None)
    league = _league_for_mview()
    items = fetch_recent_activity(league)
    assert items
    actions = [action for row in items for action in serialize_activity(row)["actions"]]
    assert any("TRADE" in (row["action"] or "") for row in actions)
    league.recent_activity.assert_called()


def test_fetch_recent_activity_falls_back_when_empty(monkeypatch):
    monkeypatch.setattr("sj.mtransactions.time.sleep", lambda *_a, **_k: None)
    league = _league_for_mview()
    league.recent_activity = MagicMock(return_value=[])
    items = fetch_recent_activity(league)
    assert items
    assert any(
        "TRADE" in action
        for row in items
        for action in (a[1] for a in row.actions)
    )


def test_fetch_recent_activity_keeps_communication_path_when_populated():
    kept = SimpleNamespace(date="1", actions=[])
    league = _league_for_mview()
    league.recent_activity = MagicMock(return_value=[kept])
    items = fetch_recent_activity(league, page_size=2, max_pages=3)
    assert items == [kept]


def test_fetch_recent_activity_empty_before_2019_skips_mview():
    league = _league_for_mview(year=ACTIVITY_MIN_SEASON - 1)
    assert fetch_recent_activity(league) == []
    league.recent_activity.assert_not_called()


def test_mview_activities_serialize_into_hub_schema(monkeypatch):
    monkeypatch.setattr("sj.mtransactions.time.sleep", lambda *_a, **_k: None)
    league = _league_for_mview()
    league.teams = []
    league.settings = SimpleNamespace(scoring_type="H2H_CATEGORY")
    activities = fetch_recent_activity(league)
    snapshot = serialize_league(
        league,
        league_id="baseball-dynasty",
        sport="baseball",
        format="dynasty",
        season=2024,
        espn_league_id=2499137,
        transactions=activities,
    )
    rows = snapshot["transactions"]
    assert rows
    assert all("date" in row and "actions" in row for row in rows)
    trade_actions = [
        action
        for row in rows
        for action in row["actions"]
        if "TRADE" in (action["action"] or "")
    ]
    assert trade_actions
    assert all(action["player_name"] for action in trade_actions)
    assert {action["action"] for action in trade_actions} >= {
        "TRADE_SENT",
        "TRADE_RECEIVED",
    }
