"""Record Splits tab — header-detected sections (roadmap P.11).

The live tracker keeps W-L-P / win % / 1u fade math on a dedicated
``Record Splits`` sheet. Sections move (title rows, inserts), so this
parser never uses A1 ranges. It scans the full grid for header rows by
name, then keys data off Bettor / Source tab / Class (and Sport on the
sport block).

``*`` in the bettor column is the all-bettors rollup.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from sj.bets import (
    DEFAULT_SHEET_ID,
    RECORD_SPLITS_TAB,
    _as_float,
    _as_int,
    _cell,
    _is_blank,
    _norm_key,
    _sheet_text,
    header_map,
    normalize_who,
)

SPLIT_ORDER = (
    "single_team",
    "single_prop",
    "leg_team",
    "leg_prop",
    "ticket",
)
SPLIT_LABELS = {
    "single_team": "Single team picks",
    "single_prop": "Single player props",
    "leg_team": "Parlay-leg team picks",
    "leg_prop": "Parlay-leg player props",
    "ticket": "Whole parlay tickets",
}
# Positive fade P/L on these kinds gets extra emphasis in the UI.
FADE_EMPHASIS = frozenset({"single_prop", "ticket"})

ALL_WHO = "*"

# Main table + sport block share these column names (order never matters).
# Live sheet strings (Unicode minus, parentheticals, "key" columns) are
# listed verbatim; ``header_map`` / ``_norm_key`` fold punctuation.
_SPLIT_ALIASES: dict[str, tuple[str, ...]] = {
    "who": ("bettor key", "who key", "bettor", "who"),
    "source": ("source tab", "source", "tab"),
    "klass": ("class key", "pick class", "class", "split"),
    "sport": ("sport", "sport category", "sport split"),
    "n": ("n", "bets", "tickets", "count", "#"),
    "w": ("w", "wins", "win"),
    "l": ("l", "losses", "loss"),
    "p": ("p", "push", "pushes"),
    "pending": ("pending",),
    "unknown": ("unknown/void", "unknown", "void"),
    "win_pct": ("win %", "win%", "win pct", "win percent"),
    "units_pl": (
        "units p&l (posted units)",
        "posted units p&l",
        "posted units pnl",
        "units p&l",
        "units pnl",
        "p&l units",
        "profit/loss units",
    ),
    "pl": (
        "$ p&l (stake shown)",
        "$ p&l",
        "p&l $",
        "$ pnl",
        "pnl $",
        "profit/loss $",
        "p/l $",
    ),
    "staked": (
        "$ staked (settled)",
        "$ staked",
        "staked",
        "stake $",
        "stake",
    ),
    "flat_1u": ("flat 1u", "1u flat", "flat 1u p&l", "1u p&l"),
    "fade_1u": (
        "1u fade p&l (\u2212110)",
        "1u fade p&l (-110)",
        "1u fade at -110",
        "1u fade @ -110",
        "1u fade p&l at -110",
        "1u fade p&l @ -110",
        "1u fade",
        "fade 1u",
        "fade 1u at -110",
        "fade p&l @ -110",
        "fade p&l at -110",
    ),
}

# Per-bettor pair table (live tracker) plus the older Check / Expected / Actual block.
# "Bets check" / "Legs check" are boolean columns on the pair table — they are
# *not* aliases for the legacy name column (that was collapsing every row to
# ``{check: "True"}``). Prefix/suffix matches for the two long record headers
# live in ``_recon_header_map``.
_RECON_ALIASES: dict[str, tuple[str, ...]] = {
    "who": ("bettor key", "who key", "bettor", "who"),
    "bets_record": ("bets tab record",),
    "singles_tickets": ("singles + tickets",),
    "bets_check": ("bets check",),
    "legs_record": ("parlay legs record",),
    "leg_splits": ("leg splits",),
    "legs_check": ("legs check",),
    "check": ("check", "reconciliation", "test"),
    "expected": ("expected", "sheet"),
    "actual": ("actual", "computed", "raw"),
    "delta": ("delta", "diff", "difference"),
    "status": ("status", "ok", "pass/fail", "result"),
}

_TRUE_FLAGS = frozenset({"true", "yes", "y", "1", "pass", "ok"})
_FALSE_FLAGS = frozenset({"false", "no", "n", "0", "fail"})


def _recon_header_map(headers: Iterable[Any]) -> dict[str, int]:
    """Exact aliases first; then prefix/suffix for the two long record headers."""
    cells = list(headers)
    mapping = header_map(cells, _RECON_ALIASES)
    for i, cell in enumerate(cells):
        name = _norm_key(cell)
        if not name:
            continue
        if "singles_tickets" not in mapping and name.startswith("singles") and name.endswith(
            "+ tickets"
        ):
            mapping["singles_tickets"] = i
        if "leg_splits" not in mapping and name.startswith("leg splits"):
            mapping["leg_splits"] = i
    return mapping


def _as_flag(value: Any) -> bool | None:
    """Sheet TRUE/FALSE (bool or text) → Python bool. Blank stays None."""
    if isinstance(value, bool):
        return value
    if _is_blank(value):
        return None
    key = _norm_key(_sheet_text(value))
    if key in _TRUE_FLAGS:
        return True
    if key in _FALSE_FLAGS:
        return False
    return None


def _mapped_norm(cells: list[Any], mapping: dict[str, int], field: str) -> str:
    if field not in mapping:
        return ""
    idx = mapping[field]
    if idx >= len(cells):
        return ""
    return _norm_key(cells[idx])


def normalize_split_who(value: Any) -> str:
    text = _sheet_text(value)
    key = _norm_key(text)
    if key in {ALL_WHO, "all", "all bettors"}:
        return ALL_WHO
    return normalize_who(value)


def normalize_pick_class(value: Any) -> str:
    key = _norm_key(_sheet_text(value))
    if not key:
        return ""
    if "whole parlay" in key or key in {"parlay", "parlays", "ticket", "parlay ticket"}:
        return "parlay"
    if "player prop" in key or key in {"prop", "props"}:
        return "prop"
    if "team pick" in key or key in {"team"}:
        return "team"
    if key.endswith(" props") or key == "prop":
        return "prop"
    return key


def normalize_split_source(value: Any) -> str:
    key = _norm_key(_sheet_text(value))
    if "parlay" in key:
        return "parlay_legs"
    if key in {"bets", "bet", "bets tab"} or key.startswith("bet"):
        return "bets"
    return key


def split_kind(source: str, klass: str) -> str:
    if klass == "parlay":
        return "ticket"
    if source == "parlay_legs" and klass == "team":
        return "leg_team"
    if source == "parlay_legs" and klass == "prop":
        return "leg_prop"
    if source == "bets" and klass == "team":
        return "single_team"
    if source == "bets" and klass == "prop":
        return "single_prop"
    return "other"


def _as_rate(value: Any) -> float | None:
    """Win % as 0–1. Accepts a Sheets fraction, 55, or ``55%``."""
    text = _sheet_text(value)
    had_pct = "%" in text
    num = _as_float(text.replace("%", "") if text else value)
    if num is None:
        return None
    if had_pct or num > 1.0:
        return num / 100.0
    return num


def classify_header_row(row: Iterable[Any]) -> str | None:
    """``main`` / ``sport`` / ``recon`` when this row is a section header."""
    cells = list(row)
    split_map = header_map(cells, _SPLIT_ALIASES)
    if "who" in split_map and "sport" in split_map:
        return "sport"
    if all(key in split_map for key in ("who", "source", "klass")):
        return "main"
    if _is_recon_header(cells):
        return "recon"
    return None


def _is_check_label(value: Any) -> bool:
    key = _norm_key(_sheet_text(value))
    return key.endswith(" check") or key in {"check", "bets check", "legs check"}


def _is_pair_recon_header(cells: list[Any], recon_map: dict[str, int]) -> bool:
    """Live per-bettor table: Bettor key + record pairs + Bets/Legs check."""
    bets_check = _mapped_norm(cells, recon_map, "bets_check") == "bets check"
    legs_check = _mapped_norm(cells, recon_map, "legs_check") == "legs check"
    if not (bets_check or legs_check):
        return False
    who = _mapped_norm(cells, recon_map, "who")
    bets_rec = _mapped_norm(cells, recon_map, "bets_record")
    legs_rec = _mapped_norm(cells, recon_map, "legs_record")
    singles = _mapped_norm(cells, recon_map, "singles_tickets")
    splits = _mapped_norm(cells, recon_map, "leg_splits")
    return bool(
        who in {"bettor key", "who key", "bettor", "who"}
        or bets_rec == "bets tab record"
        or legs_rec == "parlay legs record"
        or (singles.startswith("singles") and singles.endswith("+ tickets"))
        or splits.startswith("leg splits")
    )


def _is_recon_header(cells: list[Any]) -> bool:
    """True for a recon *header* row, not a data row labeled ``Bets check``."""
    recon_map = _recon_header_map(cells)
    if _is_pair_recon_header(cells, recon_map):
        return True
    if "expected" in recon_map:
        exp = _mapped_norm(cells, recon_map, "expected")
        if exp in {"expected", "sheet"}:
            return True
    if "actual" in recon_map:
        act = _mapped_norm(cells, recon_map, "actual")
        if act in {"actual", "computed", "raw"}:
            return True
    if "check" not in recon_map:
        return False
    header_words = {
        "expected",
        "actual",
        "delta",
        "status",
        "ok",
        "pass fail",
        "result",
        "sheet",
    }
    norms = [_norm_key(cell) for cell in cells if not _is_blank(cell)]
    if any(name in header_words for name in norms):
        return True
    return bool(norms) and all(
        _as_float(cell) is None for cell in cells if not _is_blank(cell)
    )


def _count(value: Any) -> int:
    num = _as_int(value)
    return 0 if num is None else num


def normalize_split_row(
    row: list[Any],
    mapping: dict[str, int],
    *,
    section: str,
) -> dict[str, Any] | None:
    who = normalize_split_who(_cell(row, mapping, "who"))
    if not who:
        return None
    source = normalize_split_source(_cell(row, mapping, "source"))
    klass = normalize_pick_class(_cell(row, mapping, "klass"))
    if section == "main" and (not source or not klass):
        return None
    wins = _count(_cell(row, mapping, "w"))
    losses = _count(_cell(row, mapping, "l"))
    pushes = _count(_cell(row, mapping, "p"))
    kind = split_kind(source, klass) if source and klass else "other"
    fade = _as_float(_cell(row, mapping, "fade_1u"))
    return {
        "who": who,
        "source": source,
        "klass": klass,
        "kind": kind,
        "sport": _sheet_text(_cell(row, mapping, "sport")) or None,
        "section": section,
        "n": _as_int(_cell(row, mapping, "n")),
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "pending": _count(_cell(row, mapping, "pending")),
        "unknown": _count(_cell(row, mapping, "unknown")),
        "record": f"{wins}-{losses}-{pushes}",
        "win_pct": _as_rate(_cell(row, mapping, "win_pct")),
        "units_pl": _as_float(_cell(row, mapping, "units_pl")),
        "pl": _as_float(_cell(row, mapping, "pl")),
        "staked": _as_float(_cell(row, mapping, "staked")),
        "flat_1u": _as_float(_cell(row, mapping, "flat_1u")),
        "fade_1u": fade,
        "fade_plus": fade is not None and fade > 0,
        "fade_emphasis": (
            fade is not None and fade > 0 and kind in FADE_EMPHASIS
        ),
    }


def _is_pair_recon_mapping(mapping: dict[str, int]) -> bool:
    pair_fields = (
        "bets_record",
        "singles_tickets",
        "legs_record",
        "leg_splits",
    )
    if any(field in mapping for field in pair_fields):
        return True
    if "expected" in mapping or "actual" in mapping or "check" in mapping:
        return False
    return "who" in mapping and ("bets_check" in mapping or "legs_check" in mapping)


def normalize_check_row(
    row: list[Any],
    mapping: dict[str, int],
) -> dict[str, Any] | None:
    if classify_header_row(row) is not None:
        return None
    if _is_pair_recon_mapping(mapping):
        who = normalize_split_who(_cell(row, mapping, "who"))
        bets_record = _sheet_text(_cell(row, mapping, "bets_record"))
        singles = _sheet_text(_cell(row, mapping, "singles_tickets"))
        bets_check = _as_flag(_cell(row, mapping, "bets_check"))
        legs_record = _sheet_text(_cell(row, mapping, "legs_record"))
        leg_splits = _sheet_text(_cell(row, mapping, "leg_splits"))
        legs_check = _as_flag(_cell(row, mapping, "legs_check"))
        if not who:
            return None
        if not any(
            (
                bets_record,
                singles,
                bets_check is not None,
                legs_record,
                leg_splits,
                legs_check is not None,
            )
        ):
            return None
        return {
            "who": who,
            "bets_record": bets_record,
            "singles_tickets": singles,
            "bets_check": bets_check,
            "legs_record": legs_record,
            "leg_splits": leg_splits,
            "legs_check": legs_check,
        }
    check_field = "check"
    if "check" not in mapping:
        if "bets_check" in mapping:
            check_field = "bets_check"
        elif "legs_check" in mapping:
            check_field = "legs_check"
    check = _sheet_text(_cell(row, mapping, check_field)) if check_field in mapping else ""
    if not check:
        filled = [_sheet_text(cell) for cell in row if not _is_blank(cell)]
        check = filled[0] if filled else ""
    if not check:
        return None
    return {
        "check": check,
        "expected": _sheet_text(_cell(row, mapping, "expected")),
        "actual": _sheet_text(_cell(row, mapping, "actual")),
        "delta": _sheet_text(_cell(row, mapping, "delta")),
        "status": _sheet_text(_cell(row, mapping, "status")),
    }


def _row_empty(row: Iterable[Any]) -> bool:
    return all(_is_blank(cell) for cell in row)


def _is_title_row(row: Iterable[Any]) -> bool:
    """A lone label like ``Sport split`` — not a header and not a data row."""
    filled = [_sheet_text(cell) for cell in row if not _is_blank(cell)]
    return len(filled) == 1 and classify_header_row(row) is None


def parse_splits_grid(grid: list[list[Any]]) -> dict[str, list[dict[str, Any]]]:
    """Walk a Record Splits grid and return main / sport / recon rows."""
    splits: list[dict[str, Any]] = []
    sports: list[dict[str, Any]] = []
    checks: list[dict[str, Any]] = []
    i = 0
    n = len(grid)
    while i < n:
        kind = classify_header_row(grid[i])
        if kind is None:
            i += 1
            continue
        mapping = (
            _recon_header_map(grid[i])
            if kind == "recon"
            else header_map(grid[i], _SPLIT_ALIASES)
        )
        i += 1
        block: list[list[Any]] = []
        saw_data = False
        while i < n:
            if classify_header_row(grid[i]) is not None:
                break
            if _row_empty(grid[i]) or _is_title_row(grid[i]):
                if saw_data:
                    if _row_empty(grid[i]):
                        i += 1
                        while i < n and (_row_empty(grid[i]) or _is_title_row(grid[i])):
                            i += 1
                    break
                i += 1
                continue
            saw_data = True
            block.append(grid[i])
            i += 1
        if kind == "recon":
            for row in block:
                item = normalize_check_row(row, mapping)
                if item is not None:
                    checks.append(item)
            continue
        section = "sport" if kind == "sport" else "main"
        bucket = sports if section == "sport" else splits
        for row in block:
            item = normalize_split_row(row, mapping, section=section)
            if item is not None:
                bucket.append(item)
    return {"splits": splits, "sports": sports, "checks": checks}


def build_splits_document(
    parsed: dict[str, list[dict[str, Any]]] | None = None,
    *,
    synced_at: str | None = None,
    source: str = "sheet",
    sheet_id: str = DEFAULT_SHEET_ID,
) -> dict[str, Any]:
    payload = parsed or {"splits": [], "sports": [], "checks": []}
    stamp = synced_at or datetime.now(timezone.utc).isoformat()
    splits = list(payload.get("splits") or [])
    sports = list(payload.get("sports") or [])
    checks = list(payload.get("checks") or [])
    return {
        "synced_at": stamp,
        "source": source,
        "sheet_id": sheet_id,
        "tab": RECORD_SPLITS_TAB,
        "split_count": len(splits),
        "sport_count": len(sports),
        "check_count": len(checks),
        "splits": splits,
        "sports": sports,
        "checks": checks,
        "kinds": list(SPLIT_ORDER),
        "labels": dict(SPLIT_LABELS),
    }
