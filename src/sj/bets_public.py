"""BetMGM Public Warnings tab — public vs book + fade-the-public (roadmap P.11)."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from sj.bets import (
    DEFAULT_SHEET_ID,
    FADE_AMERICAN,
    FADE_STAKE,
    PUBLIC_TAB,
    _as_float,
    _cell,
    _norm_key,
    _ratio,
    _sheet_text,
    fade_pl,
    format_game_date,
    format_posted,
    invert_result,
    normalize_result,
)

_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "id": ("warning id", "id"),
    "posted": ("posted (ct)", "date posted (ct)", "posted"),
    "url": ("post url", "url"),
    "gd": ("game date", "gd"),
    "dow": ("day of week", "game day of week", "dow"),
    "sport": ("sport", "sport category"),
    "matchup": ("matchup",),
    "market": ("market",),
    "public_side": ("public side",),
    "line": ("line at post", "line"),
    "ticket": ("ticket %", "ticket"),
    "handle": ("handle %", "handle"),
    "wording": ("sportsbook wording", "wording"),
    "prime": ("prime time", "prime time (y/n)", "prime"),
    "slot": ("prime slot", "prime time slot"),
    "score": ("final score", "score"),
    "public_res": ("public result",),
    "mgm_res": ("betmgm result", "mgm result"),
    "bucket": ("pct bucket", "% bucket", "bucket"),
    "src": ("grading source", "result source", "src"),
    "notes": ("notes",),
}


def prime_bucket(value: Any) -> str:
    key = _norm_key(_sheet_text(value))
    if key == "y":
        return "Prime time"
    if key == "n":
        return "Not prime"
    return "Unknown"


def _header_map_aliases(headers: Iterable[Any]) -> dict[str, int]:
    index: dict[str, int] = {}
    normalized = [_norm_key(h) for h in headers]
    for field, aliases in _HEADER_ALIASES.items():
        for i, name in enumerate(normalized):
            if name in aliases:
                index[field] = i
                break
    return index


def normalize_public_row(
    row: dict[str, Any] | list[Any],
    headers: list[Any] | None = None,
) -> dict[str, Any] | None:
    if isinstance(row, dict):
        if "id" in row and "public_res" in row:
            source = row
        else:
            mapping = _header_map_aliases(row.keys())
            if "id" not in mapping:
                return None
            source = {}
            for field, aliases in _HEADER_ALIASES.items():
                for key, val in row.items():
                    if _norm_key(key) in aliases:
                        source[field] = val
                        break
    else:
        mapping = _header_map_aliases(headers or [])
        if "id" not in mapping:
            return None
        source = {field: _cell(row, mapping, field) for field in _HEADER_ALIASES}

    warn_id = _sheet_text(source.get("id"))
    if not warn_id or _norm_key(warn_id) in {"warning id", "id"}:
        return None

    public_res = normalize_result(_sheet_text(source.get("public_res")))
    mgm_raw = _sheet_text(source.get("mgm_res"))
    mgm_res = normalize_result(mgm_raw) if mgm_raw else invert_result(public_res)
    fade_res = invert_result(public_res)

    return {
        "id": warn_id,
        "posted": format_posted(source.get("posted")),
        "url": _sheet_text(source.get("url")),
        "gd": format_game_date(source.get("gd")),
        "dow": _sheet_text(source.get("dow")) or "—",
        "sport": _sheet_text(source.get("sport")) or "Other",
        "matchup": _sheet_text(source.get("matchup")),
        "market": _sheet_text(source.get("market")) or "—",
        "public_side": _sheet_text(source.get("public_side")),
        "line": _sheet_text(source.get("line")),
        "ticket": _as_float(source.get("ticket")),
        "handle": _as_float(source.get("handle")),
        "wording": _sheet_text(source.get("wording")),
        "prime": _sheet_text(source.get("prime")) or "",
        "slot": _sheet_text(source.get("slot")),
        "score": _sheet_text(source.get("score")),
        "public_res": public_res,
        "mgm_res": mgm_res,
        "fade_res": fade_res,
        "bucket": _sheet_text(source.get("bucket")) or "—",
        "src": _sheet_text(source.get("src")),
        "notes": _sheet_text(source.get("notes")),
        "fade_pl": fade_pl(fade_res),
    }


def normalize_public_rows(
    rows: Iterable[Any],
    headers: list[Any] | None = None,
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        item = normalize_public_row(row, headers)
        if item is None or item["id"] in seen:
            continue
        seen.add(item["id"])
        warnings.append(item)
    return warnings


def _count_results(rows: Iterable[dict[str, Any]], field: str) -> dict[str, int]:
    wins = losses = pushes = pending = unknown = 0
    for row in rows:
        res = normalize_result(row.get(field))
        if res == "W":
            wins += 1
        elif res == "L":
            losses += 1
        elif res == "Push":
            pushes += 1
        elif res == "Pending":
            pending += 1
        else:
            unknown += 1
    decided = wins + losses
    return {
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "pending": pending,
        "unknown": unknown,
        "record": f"{wins}-{losses}-{pushes}",
        "win_pct": _ratio(float(wins), float(decided)),
    }


def public_kpis(warnings: Iterable[dict[str, Any]]) -> dict[str, Any]:
    rows = list(warnings)
    public = _count_results(rows, "public_res")
    mgm = _count_results(rows, "mgm_res")
    fade = _count_results(rows, "fade_res")
    pl = 0.0
    pl_n = 0
    for row in rows:
        dollar = row.get("fade_pl")
        if dollar is None:
            dollar = fade_pl(row.get("fade_res"))
        if dollar is None:
            continue
        pl += float(dollar)
        pl_n += 1
    return {
        "warnings": len(rows),
        "public_wins": public["wins"],
        "public_losses": public["losses"],
        "public_pushes": public["pushes"],
        "public_pending": public["pending"],
        "public_unknown": public["unknown"],
        "public_record": public["record"],
        "public_win_pct": public["win_pct"],
        "mgm_wins": mgm["wins"],
        "mgm_losses": mgm["losses"],
        "mgm_pushes": mgm["pushes"],
        "mgm_pending": mgm["pending"],
        "mgm_unknown": mgm["unknown"],
        "mgm_record": mgm["record"],
        "mgm_win_pct": mgm["win_pct"],
        "fade_wins": fade["wins"],
        "fade_losses": fade["losses"],
        "fade_pushes": fade["pushes"],
        "fade_record": fade["record"],
        "fade_win_pct": fade["win_pct"],
        "fade_pl": pl if pl_n else None,
        "fade_n": pl_n,
        "fade_american": FADE_AMERICAN,
        "fade_stake": FADE_STAKE,
        "fade_roi": _ratio(pl, FADE_STAKE * pl_n) if pl_n else None,
    }


def public_breakdown(warnings: Iterable[dict[str, Any]], key_fn) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in warnings:
        label = str(key_fn(row) or "—")
        groups.setdefault(label, []).append(row)
    rows = [{"key": label, **public_kpis(items)} for label, items in groups.items()]
    rows.sort(key=lambda row: (-row["warnings"], str(row["key"])))
    return rows


def build_public_document(
    warnings: list[dict[str, Any]],
    *,
    synced_at: str | None = None,
    source: str = "sheet",
    sheet_id: str = DEFAULT_SHEET_ID,
) -> dict[str, Any]:
    stamp = synced_at or datetime.now(timezone.utc).isoformat()
    ordered = sorted(
        warnings,
        key=lambda b: (b.get("posted") or "", b.get("id") or ""),
        reverse=True,
    )
    return {
        "synced_at": stamp,
        "source": source,
        "sheet_id": sheet_id,
        "tab": PUBLIC_TAB,
        "warning_count": len(ordered),
        "warnings": ordered,
        "all": public_kpis(ordered),
    }
