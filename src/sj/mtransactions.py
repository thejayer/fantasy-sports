"""ESPN ``mTransactions2`` fallback for historical ``transactions.json``.

``espn-api`` ``League.recent_activity()`` uses the communication view, which
often raises ``ESPNInvalidLeague`` (or returns empty) for past seasons even
when standings/rosters load. Live ESPN still serves the full ledger via

    GET .../leagues/{id}?view=mTransactions2&scoringPeriodId={N}

Default ``mTransactions2`` without ``scoringPeriodId`` is only a recent
window. Scanning discovered scoring periods and deduping by transaction
``id`` reconstructs TRADE / FREEAGENT / WAIVER / DRAFT history in the same
Activity-shaped objects ``serialize_activity`` already consumes.
"""

from __future__ import annotations

import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

# Executed ledger types we persist. Proposals / vetoes / roster moves stay out
# so the hub Feed matches recent_activity (adds, drops, executed trades).
MVIEW_KEEP_TYPES = frozenset(
    {
        "DRAFT",
        "FREEAGENT",
        "TRADE_ACCEPT",
        "TRADE_UPHOLD",
        "WAIVER",
        "WAIVER_ERROR",
    }
)
MVIEW_SKIP_STATUSES = frozenset(
    {
        "CANCELED",
        "CANCELLED",
        "DECLINED",
        "FAILED",
        "PENDING",
        "VETOED",
    }
)

# Baseball seasons have ~180 daily scoring periods; football ~18. Cap the
# HTTP fan-out even if ESPN reports a huge finalScoringPeriod.
DEFAULT_TXN_MAX_PERIODS = 200
MAX_TXN_MAX_PERIODS = 250
DEFAULT_TXN_PERIOD_THROTTLE = 0.15


@dataclass(frozen=True)
class MViewActivity:
    """Activity-shaped row so ``serialize_activity`` needs no special case."""

    date: int | str | None
    actions: list[tuple[Any, str, Any, float]]


def txn_max_periods() -> int:
    raw = os.environ.get("SJ_TXN_MAX_PERIODS", "").strip()
    if not raw:
        return DEFAULT_TXN_MAX_PERIODS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_TXN_MAX_PERIODS
    return max(1, min(value, MAX_TXN_MAX_PERIODS))


def txn_period_throttle() -> float:
    raw = os.environ.get("SJ_TXN_PERIOD_THROTTLE", "").strip()
    if not raw:
        return DEFAULT_TXN_PERIOD_THROTTLE
    try:
        return max(0.0, float(raw))
    except ValueError:
        return DEFAULT_TXN_PERIOD_THROTTLE


def _positive_int(value: Any, default: int | None = None) -> int | None:
    if value is None or isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value if value >= 0 else default
    if isinstance(value, str):
        try:
            number = int(value)
        except ValueError:
            return default
        return number if number >= 0 else default
    return default


def discover_scoring_periods(
    league: Any,
    *,
    max_periods: int | None = None,
) -> list[int]:
    """Return scoringPeriodIds to scan, from league status when present.

    Requires a real ``finalScoringPeriod`` / ``scoringPeriodId`` /
    ``current_week`` so we do not blind-scan 0..200 on stubs. Period ``0`` is
    included (ESPN sometimes parks preseason / undated rows there).
    """
    last = _positive_int(getattr(league, "finalScoringPeriod", None))
    if last is None:
        last = _positive_int(getattr(league, "scoringPeriodId", None))
    if last is None:
        last = _positive_int(getattr(league, "current_week", None))
    if last is None:
        return []

    # Always include period 0 — ESPN sometimes parks undated / preseason rows
    # there. firstScoringPeriod is typically 1 for in-season sports.
    first = 0
    cap = txn_max_periods() if max_periods is None else max(1, int(max_periods))
    last = min(last, first + cap - 1)
    if last < first:
        return []
    return list(range(first, last + 1))


def _period_unsupported(exc: BaseException) -> bool:
    """Skip a scoring period ESPN refuses; do not hide auth / network errors."""
    try:
        from espn_api.requests.espn_requests import ESPNInvalidLeague
    except ImportError:  # pragma: no cover
        ESPNInvalidLeague = ()  # type: ignore[misc,assignment]
    if ESPNInvalidLeague and isinstance(exc, ESPNInvalidLeague):
        return True
    msg = str(exc).lower()
    return (
        "cant retrieve" in msg
        or "can't retrieve" in msg
        or "cant use recent" in msg
        or "does not exist" in msg
    )


def _player_map(league: Any) -> dict[Any, Any]:
    raw = getattr(league, "player_map", None)
    return raw if isinstance(raw, dict) else {}


def _resolve_player(player_id: Any, player_map: dict[Any, Any]) -> SimpleNamespace:
    pid = _positive_int(player_id)
    name = None
    if pid is not None and player_map:
        mapped = player_map.get(pid)
        if isinstance(mapped, str) and mapped.strip():
            name = mapped
    return SimpleNamespace(playerId=pid, name=name)


def _resolve_team(team_id: Any, get_team_data: Callable[[Any], Any] | None) -> Any:
    tid = _positive_int(team_id)
    if tid is None or tid == 0:
        return None
    if get_team_data is not None:
        try:
            team = get_team_data(tid)
        except Exception:  # noqa: BLE001 — team lookup is best-effort
            team = None
        if team not in (None, ""):
            return team
    return SimpleNamespace(team_id=tid)


def _item_action_label(tx_type: str, item_type: str) -> str | None:
    kind = (item_type or "").upper()
    parent = (tx_type or "").upper()
    if kind == "DROP":
        return "DROPPED"
    if kind == "ADD":
        if parent in {"WAIVER", "WAIVER_ERROR"}:
            return "WAIVER ADDED"
        return "FA ADDED"
    if kind == "TRADE":
        return "TRADED"
    if kind == "DRAFT" or parent == "DRAFT":
        return "DRAFT"
    if parent in {"TRADE_ACCEPT", "TRADE_UPHOLD"} and kind in {"", "TRADE"}:
        return "TRADED"
    return None


def _action_team(
    *,
    item: dict[str, Any],
    tx_team_id: Any,
    item_type: str,
    get_team_data: Callable[[Any], Any] | None,
    side: str | None = None,
) -> Any:
    kind = (item_type or "").upper()
    if side == "from":
        return _resolve_team(item.get("fromTeamId"), get_team_data)
    if side == "to":
        return _resolve_team(item.get("toTeamId") or tx_team_id, get_team_data)
    if kind == "DROP":
        return _resolve_team(item.get("fromTeamId") or tx_team_id, get_team_data)
    return _resolve_team(item.get("toTeamId") or tx_team_id, get_team_data)


def normalize_mtransaction(
    tx: dict[str, Any],
    *,
    player_map: dict[Any, Any] | None = None,
    get_team_data: Callable[[Any], Any] | None = None,
) -> MViewActivity | None:
    """Turn one ESPN ``mTransactions2`` row into an Activity-shaped object."""
    if not isinstance(tx, dict):
        return None
    tx_type = str(tx.get("type") or "").upper()
    if tx_type not in MVIEW_KEEP_TYPES:
        return None
    if tx.get("isPending"):
        return None
    status = str(tx.get("status") or "").upper()
    if status in MVIEW_SKIP_STATUSES:
        return None

    items = tx.get("items")
    if not isinstance(items, list) or not items:
        return None

    names = player_map or {}
    bid = tx.get("bidAmount")
    try:
        bid_amount = float(bid or 0)
    except (TypeError, ValueError):
        bid_amount = 0.0

    actions: list[tuple[Any, str, Any, float]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        item_type = str(item.get("type") or "")
        label = _item_action_label(tx_type, item_type)
        if not label:
            continue
        player = _resolve_player(item.get("playerId"), names)
        if label == "TRADED":
            from_team = _action_team(
                item=item,
                tx_team_id=tx.get("teamId"),
                item_type=item_type,
                get_team_data=get_team_data,
                side="from",
            )
            to_team = _action_team(
                item=item,
                tx_team_id=tx.get("teamId"),
                item_type=item_type,
                get_team_data=get_team_data,
                side="to",
            )
            if from_team is not None:
                actions.append((from_team, "TRADE_SENT", player, 0.0))
            if to_team is not None:
                actions.append((to_team, "TRADE_RECEIVED", player, 0.0))
            if from_team is None and to_team is None:
                actions.append((None, "TRADED", player, 0.0))
            continue
        team = _action_team(
            item=item,
            tx_team_id=tx.get("teamId"),
            item_type=item_type,
            get_team_data=get_team_data,
        )
        item_bid = bid_amount if label == "WAIVER ADDED" else 0.0
        actions.append((team, label, player, item_bid))

    if not actions:
        return None

    date = tx.get("processDate")
    if date is None:
        date = tx.get("proposedDate")
    if date is None:
        date = tx.get("acceptedDate")
    return MViewActivity(date=date, actions=actions)


def _transaction_id(tx: dict[str, Any]) -> str | None:
    raw = tx.get("id")
    if raw is None or raw == "":
        return None
    return str(raw)


def fetch_transactions_mview(
    league: Any,
    *,
    throttle_seconds: float | None = None,
    max_periods: int | None = None,
    sleep: Callable[[float], None] | None = None,
    call: Callable[..., Any] | None = None,
) -> list[MViewActivity]:
    """Scan ``mTransactions2`` across scoring periods; dedupe by ESPN ``id``."""
    request = getattr(league, "espn_request", None)
    league_get = getattr(request, "league_get", None) if request is not None else None
    if not callable(league_get):
        return []

    periods = discover_scoring_periods(league, max_periods=max_periods)
    if not periods:
        return []

    if call is None:
        from sj.sync import espn_call

        call = espn_call
    if sleep is None:
        sleep = time.sleep

    delay = txn_period_throttle() if throttle_seconds is None else max(0.0, float(throttle_seconds))
    player_map = _player_map(league)
    get_team_data = getattr(league, "get_team_data", None)
    if not callable(get_team_data):
        get_team_data = None

    seen: set[str] = set()
    anonymous: list[MViewActivity] = []
    by_id: dict[str, MViewActivity] = {}

    for index, period in enumerate(periods):
        if index and delay:
            sleep(delay)
        try:
            data = call(
                lambda current=period: league_get(
                    params={"view": "mTransactions2", "scoringPeriodId": current}
                ),
                label=f"mTransactions2:sp{period}",
            )
        except Exception as exc:
            if _period_unsupported(exc):
                continue
            raise
        if not isinstance(data, dict):
            continue
        rows = data.get("transactions")
        if not isinstance(rows, list):
            continue
        for raw in rows:
            if not isinstance(raw, dict):
                continue
            activity = normalize_mtransaction(
                raw, player_map=player_map, get_team_data=get_team_data
            )
            if activity is None:
                continue
            tx_id = _transaction_id(raw)
            if tx_id is None:
                anonymous.append(activity)
                continue
            if tx_id in seen:
                continue
            seen.add(tx_id)
            by_id[tx_id] = activity

    items = list(by_id.values()) + anonymous

    def _sort_key(row: MViewActivity) -> int:
        try:
            return int(row.date) if row.date is not None else 0
        except (TypeError, ValueError):
            return 0

    items.sort(key=_sort_key, reverse=True)
    return items
