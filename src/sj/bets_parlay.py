"""Parlay Legs tab — per-leg hit rate vs fade (roadmap P.11)."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from sj.bets import (
    DEFAULT_SHEET_ID,
    PARLAY_TAB,
    _as_int,
    _as_text,
    _cell,
    _norm_key,
    _ratio,
    _sheet_text,
    format_game_date,
    format_posted,
    header_map,
    in_window,
    invert_result,
    normalize_result,
    normalize_who,
    unique_bettors,
)

_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "id": ("leg id", "id"),
    "who": ("bettor key", "who key", "bettor", "who"),
    "parent": ("parent bet id", "parent", "bet id"),
    "n": ("leg #", "leg number", "n"),
    "url": ("parent post url", "post url", "url"),
    "posted": ("date posted (ct)", "date posted", "posted"),
    "gd": ("game date", "gd"),
    "dow": ("game day of week", "day of week", "dow"),
    "prime": ("prime time (y/n)", "prime time", "prime"),
    "slot": ("prime time slot", "slot"),
    "sport": ("sport", "sport category"),
    "lg": ("league/event", "league", "lg"),
    "leg_type": ("leg type",),
    "pick": ("pick group", "pick"),
    "player": ("player",),
    "sel": ("team/selection", "selection", "sel"),
    "stat": ("stat category", "stat"),
    "line": ("line",),
    "dir": ("direction", "dir"),
    "opp": ("opponent", "opp"),
    "res": ("leg result", "result", "res"),
    "actual": ("actual stat / final score used", "actual"),
    "src": ("result source", "src"),
    "fade_side": ("fade side",),
    "fade": ("fade result", "fade"),
    "parent_res": ("parent parlay result", "parent result"),
    "parent_bt": ("parent bet type",),
    "parent_n": ("parent # legs", "parent n"),
    "parent_lost": ("parent legs lost",),
    "odds": ("leg odds", "odds"),
    "notes": ("notes",),
}


def ou_bucket(direction: Any) -> str:
    key = _norm_key(_sheet_text(direction))
    if key in {"over", "o"}:
        return "Over"
    if key in {"under", "u"}:
        return "Under"
    if not key:
        return "—"
    return "Other"


def pick_bucket(value: Any) -> str:
    key = _norm_key(_sheet_text(value))
    if "prop" in key:
        return "Player prop"
    if "team" in key:
        return "Team pick"
    if not key:
        return "—"
    return _sheet_text(value) or "—"


def prime_bucket(value: Any) -> str:
    key = _norm_key(_sheet_text(value))
    if key == "y":
        return "Prime time"
    if key == "n":
        return "Not prime"
    return "Unknown"


def normalize_parlay_row(
    row: dict[str, Any] | list[Any],
    headers: list[Any] | None = None,
) -> dict[str, Any] | None:
    if isinstance(row, dict):
        if "id" in row and "who" in row and "res" in row:
            source = row
        else:
            keys = list(row.keys())
            mapping = _header_map_aliases(keys)
            if "id" not in mapping:
                return None
            values = list(row.values())
            source = {
                field: values[mapping[field]] if field in mapping else None
                for field in _HEADER_ALIASES
            }
    else:
        mapping = _header_map_aliases(headers or [])
        if "id" not in mapping:
            return None
        source = {field: _cell(row, mapping, field) for field in _HEADER_ALIASES}

    leg_id = _sheet_text(source.get("id"))
    if not leg_id or _norm_key(leg_id) in {"leg id", "id"}:
        return None

    res = normalize_result(_sheet_text(source.get("res")))
    fade_raw = _sheet_text(source.get("fade"))
    fade = normalize_result(fade_raw) if fade_raw else invert_result(res)

    return {
        "id": leg_id,
        "who": normalize_who(source.get("who")),
        "parent": _sheet_text(source.get("parent")),
        "n": _as_int(source.get("n")),
        "url": _sheet_text(source.get("url")),
        "posted": format_posted(source.get("posted")),
        "gd": format_game_date(source.get("gd")),
        "dow": _sheet_text(source.get("dow")),
        "prime": _sheet_text(source.get("prime")) or "",
        "slot": _sheet_text(source.get("slot")),
        "sport": _sheet_text(source.get("sport")) or "Other",
        "lg": _sheet_text(source.get("lg")),
        "leg_type": _sheet_text(source.get("leg_type")),
        "pick": pick_bucket(source.get("pick")),
        "player": _sheet_text(source.get("player")),
        "sel": _sheet_text(source.get("sel")),
        "stat": _sheet_text(source.get("stat")) or "—",
        "line": _sheet_text(source.get("line")),
        "dir": _sheet_text(source.get("dir")),
        "opp": _sheet_text(source.get("opp")),
        "res": res,
        "actual": _sheet_text(source.get("actual")),
        "src": _sheet_text(source.get("src")),
        "fade_side": _sheet_text(source.get("fade_side")),
        "fade": fade,
        "parent_res": normalize_result(_sheet_text(source.get("parent_res")))
        if _sheet_text(source.get("parent_res"))
        else "",
        "parent_bt": _sheet_text(source.get("parent_bt")),
        "parent_n": _as_text(source.get("parent_n")),
        "parent_lost": _as_text(source.get("parent_lost")),
        "odds": _sheet_text(source.get("odds")),
        "notes": _sheet_text(source.get("notes")),
        "ou": ou_bucket(source.get("dir")),
    }


def _header_map_aliases(headers: Iterable[Any]) -> dict[str, int]:
    return header_map(headers, _HEADER_ALIASES)


def normalize_parlay_rows(
    rows: Iterable[Any],
    headers: list[Any] | None = None,
) -> list[dict[str, Any]]:
    legs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        leg = normalize_parlay_row(row, headers)
        if leg is None or leg["id"] in seen:
            continue
        seen.add(leg["id"])
        legs.append(leg)
    return legs


def _count_results(rows: Iterable[dict[str, Any]], field: str) -> dict[str, int]:
    wins = losses = pushes = pending = unknown = voids = 0
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
        elif _norm_key(res) == "void":
            voids += 1
        else:
            unknown += 1
    return {
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "pending": pending,
        "unknown": unknown,
        "voids": voids,
    }


def parlay_kpis(legs: Iterable[dict[str, Any]], who: str | None = None) -> dict[str, Any]:
    rows = [leg for leg in legs if who is None or leg.get("who") == who]
    hit = _count_results(rows, "res")
    fade = _count_results(rows, "fade")
    decided = hit["wins"] + hit["losses"]
    fade_decided = fade["wins"] + fade["losses"]
    return {
        "who": who,
        "legs": len(rows),
        "wins": hit["wins"],
        "losses": hit["losses"],
        "pushes": hit["pushes"],
        "pending": hit["pending"],
        "unknown": hit["unknown"],
        "voids": hit["voids"],
        "record": f"{hit['wins']}-{hit['losses']}-{hit['pushes']}",
        "hit_rate": _ratio(float(hit["wins"]), float(decided)),
        "fade_wins": fade["wins"],
        "fade_losses": fade["losses"],
        "fade_pushes": fade["pushes"],
        "fade_pending": fade["pending"],
        "fade_unknown": fade["unknown"],
        "fade_voids": fade["voids"],
        "fade_record": f"{fade['wins']}-{fade['losses']}-{fade['pushes']}",
        "fade_hit_rate": _ratio(float(fade["wins"]), float(fade_decided)),
    }


def filter_parlay_legs(
    legs: Iterable[dict[str, Any]],
    *,
    who: str | None = None,
    sport: str | None = None,
    window: str = "all",
) -> list[dict[str, Any]]:
    sport_key = _norm_key(sport) if sport else ""
    out: list[dict[str, Any]] = []
    for leg in legs:
        if who and leg.get("who") != who:
            continue
        if sport_key and _norm_key(leg.get("sport")) != sport_key:
            continue
        if not in_window({"gd": leg.get("gd"), "posted": leg.get("posted")}, window):
            continue
        out.append(leg)
    return out


def parlay_breakdown(legs: Iterable[dict[str, Any]], key_fn) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for leg in legs:
        label = str(key_fn(leg) or "—")
        groups.setdefault(label, []).append(leg)
    rows = []
    for label, items in groups.items():
        kpi = parlay_kpis(items)
        rows.append({"key": label, **kpi, "who": None})
    rows.sort(key=lambda row: (-row["legs"], str(row["key"])))
    return rows


def build_parlay_document(
    legs: list[dict[str, Any]],
    *,
    synced_at: str | None = None,
    source: str = "sheet",
    sheet_id: str = DEFAULT_SHEET_ID,
) -> dict[str, Any]:
    stamp = synced_at or datetime.now(timezone.utc).isoformat()
    ordered = sorted(
        legs,
        key=lambda b: (b.get("posted") or "", b.get("id") or ""),
        reverse=True,
    )
    return {
        "synced_at": stamp,
        "source": source,
        "sheet_id": sheet_id,
        "tab": PARLAY_TAB,
        "leg_count": len(ordered),
        "legs": ordered,
        "bettors": unique_bettors(ordered),
        "all": parlay_kpis(ordered),
    }
