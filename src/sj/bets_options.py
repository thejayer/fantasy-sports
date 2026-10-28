"""Options tracker ingest — Trades / Traders tabs only (portal P.12).

Reads the Strictly Jayers Options Tracker sheet (or a local simulated
JSON fixture) by header name. Writes ``bets/options.json`` next to the
other bet-tracker sidecars. Never writes to Google. Never folds options
P/L into ``bets.json`` / ``summary.json`` / ``record_splits.json``.

Blank P/L is ``not posted`` — excluded from totals and W-L. Open rows
are counted, not marked to market. P/L % is the evaluated sheet value
or nothing; formulas are not computed here.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sj.bets import (
    _as_float,
    _cell,
    _norm_key,
    _sheet_text,
    format_game_date,
    format_posted,
    header_map,
    strip_value_prefix,
)
from sj.store import write_bets

TRADES_TAB = "Trades"
TRADERS_TAB = "Traders"
# Formula / notes tabs — listed so we never ingest them even if present.
FORMULA_TABS = frozenset({"Summary", "Legend & Notes"})
OPTIONS_TABS = (TRADES_TAB, TRADERS_TAB)

TRADE_TYPES = ("Call", "Put", "Shares", "Spread", "Daily recap")
TRADE_STATUSES = ("Open", "Closed", "Expired")

_TYPE_CANON = {t.casefold(): t for t in TRADE_TYPES}
_STATUS_CANON = {s.casefold(): s for s in TRADE_STATUSES}

TRADE_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "id": ("trade id", "id"),
    "trader": ("trader", "display name"),
    "posted": ("post date", "posted", "date"),
    "url": ("post url", "url"),
    "underlying": ("underlying", "ticker", "symbol"),
    "type": ("type",),
    "strike": ("strike",),
    "expiry": ("expiry", "expiration", "exp"),
    "contracts": ("contracts", "qty", "quantity"),
    "entry": ("entry price", "entry"),
    "exit": ("exit price", "exit"),
    "cost": ("cost basis $", "cost basis", "cost"),
    "proceeds": ("proceeds $", "proceeds"),
    "pl": ("p/l $", "pl $", "pnl $", "p/l", "pl", "pnl"),
    "pl_pct": ("p/l %", "pl %", "pnl %"),
    "status": ("status",),
    "source": ("source",),
    "notes": ("notes",),
}

TRADER_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "name": ("display name", "trader", "name"),
    "handle": ("x handle", "handle", "twitter", "twitter handle"),
    "tracked_since": ("tracked since", "since"),
    "notes": ("notes",),
}

TRADE_FIELDS = tuple(TRADE_HEADER_ALIASES)
TRADER_FIELDS = tuple(TRADER_HEADER_ALIASES)


def options_sync_enabled() -> bool:
    """Off unless SJ_OPTIONS_SYNC is an explicit truthy value."""
    return os.environ.get("SJ_OPTIONS_SYNC", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def options_header_spec(tab: str) -> tuple[dict[str, tuple[str, ...]], tuple[str, ...]] | None:
    """Header aliases + required keys for ``sheet_as_table`` (lazy, no cycle)."""
    if tab == TRADES_TAB:
        return TRADE_HEADER_ALIASES, ("id", "trader")
    if tab == TRADERS_TAB:
        return TRADER_HEADER_ALIASES, ("name",)
    return None


def _canon_type(value: Any) -> str:
    text = _sheet_text(value)
    return _TYPE_CANON.get(text.casefold(), text)


def _canon_status(value: Any) -> str:
    text = _sheet_text(value)
    return _STATUS_CANON.get(text.casefold(), text)


def _evaluated_number(value: Any) -> float | None:
    """Numeric sheet value only. Formulas and blanks → None (do not infer)."""
    if isinstance(value, str) and value.lstrip().startswith("="):
        return None
    return _as_float(strip_value_prefix(value))


def _handle_href(handle: str) -> str:
    text = handle.strip().lstrip("@")
    if not text:
        return ""
    if text.startswith(("http://", "https://")):
        return text
    return f"https://x.com/{text}"


def normalize_trade_row(
    row: dict[str, Any] | list[Any],
    headers: list[Any] | None = None,
) -> dict[str, Any] | None:
    """One Trades-tab row, keyed by header name. Extra columns ignored."""
    if isinstance(row, dict):
        if "id" in row and "trader" in row and "Trade ID" not in row:
            source = row
        else:
            keys = list(row.keys())
            mapping = header_map(keys, TRADE_HEADER_ALIASES)
            if "id" not in mapping:
                return None
            values = list(row.values())
            source = {
                field: values[mapping[field]] if field in mapping else None
                for field in TRADE_FIELDS
            }
    else:
        mapping = header_map(headers or [], TRADE_HEADER_ALIASES)
        if "id" not in mapping:
            return None
        source = {field: _cell(row, mapping, field) for field in TRADE_FIELDS}

    trade_id = _sheet_text(source.get("id"))
    if not trade_id or _norm_key(trade_id) in {"trade id", "id"}:
        return None
    trader = _sheet_text(source.get("trader"))
    if not trader or _norm_key(trader) in {"trader", "display name"}:
        return None

    return {
        "id": trade_id,
        "trader": trader,
        "posted": format_posted(source.get("posted")),
        "url": _sheet_text(source.get("url")),
        "underlying": _sheet_text(source.get("underlying")),
        "type": _canon_type(source.get("type")),
        "strike": _evaluated_number(source.get("strike")),
        "expiry": format_game_date(source.get("expiry")),
        "contracts": _evaluated_number(source.get("contracts")),
        "entry": _evaluated_number(source.get("entry")),
        "exit": _evaluated_number(source.get("exit")),
        "cost": _evaluated_number(source.get("cost")),
        "proceeds": _evaluated_number(source.get("proceeds")),
        "pl": _evaluated_number(source.get("pl")),
        "pl_pct": _evaluated_number(source.get("pl_pct")),
        "status": _canon_status(source.get("status")),
        "source": _sheet_text(source.get("source")),
        "notes": _sheet_text(source.get("notes")),
    }


def normalize_trade_rows(
    rows: Iterable[Any],
    headers: list[Any] | None = None,
) -> list[dict[str, Any]]:
    trades: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        trade = normalize_trade_row(row, headers)
        if trade is None or trade["id"] in seen:
            continue
        seen.add(trade["id"])
        trades.append(trade)
    return trades


def normalize_trader_row(
    row: dict[str, Any] | list[Any],
    headers: list[Any] | None = None,
) -> dict[str, Any] | None:
    if isinstance(row, dict):
        if "name" in row and "Display name" not in row and "Trader" not in row:
            source = row
        else:
            keys = list(row.keys())
            mapping = header_map(keys, TRADER_HEADER_ALIASES)
            if "name" not in mapping:
                return None
            values = list(row.values())
            source = {
                field: values[mapping[field]] if field in mapping else None
                for field in TRADER_FIELDS
            }
    else:
        mapping = header_map(headers or [], TRADER_HEADER_ALIASES)
        if "name" not in mapping:
            return None
        source = {field: _cell(row, mapping, field) for field in TRADER_FIELDS}

    name = _sheet_text(source.get("name"))
    if not name or _norm_key(name) in {"display name", "trader", "name"}:
        return None
    handle = _sheet_text(source.get("handle")).lstrip("@")
    return {
        "name": name,
        "handle": handle,
        "href": _handle_href(handle),
        "tracked_since": format_game_date(source.get("tracked_since"))
        or _sheet_text(source.get("tracked_since")),
        "notes": _sheet_text(source.get("notes")),
    }


def normalize_trader_rows(
    rows: Iterable[Any],
    headers: list[Any] | None = None,
) -> list[dict[str, Any]]:
    traders: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        trader = normalize_trader_row(row, headers)
        if trader is None or trader["name"] in seen:
            continue
        seen.add(trader["name"])
        traders.append(trader)
    return traders


def posted_pl(trade: dict[str, Any]) -> float | None:
    """Posted P/L $ only. Blank / formula / non-numeric → None."""
    return _evaluated_number(trade.get("pl"))


def trader_summary(
    trades: Iterable[dict[str, Any]],
    meta: dict[str, Any] | None = None,
    *,
    name: str,
) -> dict[str, Any]:
    """Per-trader KPIs from posted P/L only. Open rows are not marked to market."""
    rows = [t for t in trades if t.get("trader") == name]
    wins = losses = open_n = 0
    pl_sum = 0.0
    pl_n = 0
    recaps = 0
    green = red = 0
    for trade in rows:
        status = _canon_status(trade.get("status"))
        kind = _canon_type(trade.get("type"))
        pl = posted_pl(trade)
        if pl is not None:
            pl_sum += pl
            pl_n += 1
        if status == "Open":
            open_n += 1
        elif status in {"Closed", "Expired"} and pl is not None:
            if pl > 0:
                wins += 1
            elif pl < 0:
                losses += 1
        if kind == "Daily recap":
            recaps += 1
            if pl is not None:
                if pl > 0:
                    green += 1
                elif pl < 0:
                    red += 1
    info = dict(meta or {})
    handle = _sheet_text(info.get("handle")).lstrip("@")
    return {
        "name": name,
        "handle": handle,
        "href": _sheet_text(info.get("href")) or _handle_href(handle),
        "tracked_since": _sheet_text(info.get("tracked_since")),
        "notes": _sheet_text(info.get("notes")),
        "trades": len(rows),
        "pl": pl_sum if pl_n else 0.0,
        "pl_posted": pl_n,
        "wins": wins,
        "losses": losses,
        "open": open_n,
        "has_daily_recap": recaps > 0,
        "green_days": green if recaps else None,
        "red_days": red if recaps else None,
    }


def unique_traders(trades: Iterable[dict[str, Any]]) -> list[str]:
    counts: Counter[str] = Counter()
    for trade in trades:
        name = _sheet_text(trade.get("trader"))
        if name:
            counts[name] += 1
    return [
        name
        for name, _n in sorted(
            counts.items(), key=lambda kv: (-kv[1], kv[0].casefold(), kv[0])
        )
    ]


def build_options_document(
    trades: list[dict[str, Any]],
    traders_meta: Iterable[dict[str, Any]] | None = None,
    *,
    source: str = "simulated",
    synced_at: str | None = None,
) -> dict[str, Any]:
    meta_by_name = {
        _sheet_text(row.get("name")): row
        for row in (traders_meta or [])
        if _sheet_text(row.get("name"))
    }
    names = list(unique_traders(trades))
    for extra in meta_by_name:
        if extra not in names:
            names.append(extra)
    traders = [trader_summary(trades, meta_by_name.get(name), name=name) for name in names]
    label = source or "simulated"
    return {
        "schema": "sj-options-v1",
        "simulated": label.startswith("fixture:") or "simulat" in label.casefold(),
        "synced_at": synced_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": label,
        "trade_count": len(trades),
        "trades": trades,
        "traders": traders,
        "footnote": "Data comes only from posted screenshots and fills.",
    }


def load_local_options(
    path: Path | str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Load a simulated JSON fixture (trades array or {trades, traders})."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return normalize_trade_rows(payload), []
    if not isinstance(payload, dict):
        raise TypeError(f"options fixture {path} is not an object or array")
    trades_raw = payload.get("trades") or payload.get("rows") or []
    traders_raw = payload.get("traders") or []
    headers = payload.get("headers")
    trade_headers = payload.get("trade_headers") or headers
    trader_headers = payload.get("trader_headers")
    if trades_raw and isinstance(trades_raw[0], list):
        trades = normalize_trade_rows(trades_raw, trade_headers)
    else:
        trades = normalize_trade_rows(trades_raw)
    if traders_raw and isinstance(traders_raw[0], list):
        traders = normalize_trader_rows(traders_raw, trader_headers)
    else:
        traders = normalize_trader_rows(traders_raw)
    return trades, traders


def fetch_options_workbook(
    sheet_id: str,
    *,
    opener=None,
) -> tuple[dict[str, tuple[list[str], list[list[Any]]]], str]:
    """Drive/Sheets read-only fetch of Trades + Traders (reuse bets auth)."""
    from sj.bets import fetch_remote_workbook

    return fetch_remote_workbook(sheet_id, OPTIONS_TABS, opener=opener)


def export_options(
    *,
    sheet_id: str = "",
    from_path: Path | str | None = None,
    store_dir: Path | str | None = None,
    source: str | None = None,
) -> dict[str, Any]:
    """Normalize Trades + Traders and write ``bets/options.json`` only."""
    if from_path:
        src = source or f"fixture:{Path(from_path).name}"
        trades, traders_meta = load_local_options(from_path)
    else:
        resolved = (sheet_id or os.environ.get("SJ_OPTIONS_SHEET_ID", "")).strip()
        if not resolved:
            raise RuntimeError("SJ_OPTIONS_SHEET_ID is required for a live options pull")
        book, detected = fetch_options_workbook(resolved)
        src = source or detected
        trade_headers, trade_rows = book.get(TRADES_TAB, ([], []))
        trader_headers, trader_rows = book.get(TRADERS_TAB, ([], []))
        trades = normalize_trade_rows(trade_rows, trade_headers)
        traders_meta = normalize_trader_rows(trader_rows, trader_headers)

    document = build_options_document(trades, traders_meta, source=src)
    write_bets(document, "options", store_dir=store_dir)
    return document


def maybe_export_options(
    *,
    sheet_id: str | None = None,
    from_path: Path | str | None = None,
    store_dir: Path | str | None = None,
    log=None,
) -> dict[str, Any] | None:
    """Run the options export when asked. Never raise to the bets caller.

    Live sheet reads require ``SJ_OPTIONS_SYNC`` on. An explicit
    ``from_path`` (CLI ``--options-from``) is enough for fixture regen.
    """
    echo = log or (lambda msg: None)
    if from_path is None and not options_sync_enabled():
        return None
    try:
        return export_options(
            sheet_id=sheet_id or "",
            from_path=from_path,
            store_dir=store_dir,
        )
    except Exception as exc:  # noqa: BLE001 — never fail the bets export
        echo(f"options: skipped ({exc})")
        return None
