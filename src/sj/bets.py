"""Public-bet tracker — sheet ingest + KPI math (roadmap P.11).

Reads the Bets tab (and optional Parlay Legs / BetMGM Public Warnings /
Record Splits tabs) from a Drive file or a local xlsx/JSON fixture.
Bettors are discovered from the Bettor column — no closed Trent/Steve
list. Summary / By-Sport formula tabs are ignored; KPIs come from raw
rows. Record Splits is the one summary tab we do read — by header names
and key columns, never fixed rows or A1 ranges.

Live ingest looks up the Drive ``mimeType`` (read-only) and then either
calls the Sheets API (native spreadsheet) or downloads an uploaded
``.xlsx`` (``files.get?alt=media``). Headers are matched by name so
added columns are tolerated. ADC uses ``drive.readonly`` +
``spreadsheets.readonly``. Tests never hit Google.
"""

from __future__ import annotations

import json
import math
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import Counter
from collections.abc import Iterable
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from sj.jsonutil import dumps_snapshot
from sj.store import write_bets

DEFAULT_SHEET_ID = "1_F9HCU7uOPH5uo8cgXkxwKrvREolPid_ZoviVVcX3HU"
DEFAULT_SHEET_TAB = "Bets"
PARLAY_TAB = "Parlay Legs"
PUBLIC_TAB = "BetMGM Public Warnings"
RECORD_SPLITS_TAB = "Record Splits"
TRACKER_TABS = (DEFAULT_SHEET_TAB, PARLAY_TAB, PUBLIC_TAB, RECORD_SPLITS_TAB)
# Formula / layout tabs that must never be ingested even if present.
FORMULA_TABS = frozenset({"Summary", "Leg Fade Summary"})
DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
READONLY_SCOPES = (DRIVE_READONLY_SCOPE, SHEETS_READONLY_SCOPE)
SHEET_MIME = "application/vnd.google-apps.spreadsheet"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DRIVE_FILE_URL = "https://www.googleapis.com/drive/v3/files/{file_id}"
SHEETS_SPREADSHEET_URL = "https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}"
SHEETS_VALUES_URL = (
    "https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{range_}"
)
SHEETS_BATCH_URL = (
    "https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values:batchGet"
)

# Assumed juice when fading the public / a parlay leg with no posted price.
FADE_AMERICAN = -110
FADE_STAKE = 100.0

# Excel's date serial epoch (Lotus 123 leap-year bug).
_EXCEL_EPOCH = datetime(1899, 12, 30, tzinfo=timezone.utc)

BLANK = frozenset(
    {
        "",
        "-",
        "—",
        "–",
        "n/a",
        "na",
        "none",
        "null",
        "not shown",
        "not matched",
    }
)

TRENT_ALIASES = frozenset(
    {
        "trent",
        "trent attyah",
        "bookitwithtrent",
        "@bookitwithtrent",
    }
)
STEVE_ALIASES = frozenset(
    {
        "steve",
        "steve will do it",
        "stevewilldoit",
        "@stevewilldoit",
    }
)

CFB_START = date(2026, 8, 27)
NFL_START = date(2026, 9, 9)
WINDOWS = {
    "all": None,
    "cfb": CFB_START,
    "nfl": NFL_START,
}

GRADED = frozenset({"w", "l", "push"})
MULTI_TYPES = frozenset({"parlay", "sgp", "prizepicks/dfs"})

# Sheet headers (current export) plus the shorter names from the product brief.
_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "id": ("bet id", "id"),
    "who": ("bettor", "who"),
    "posted": ("date posted (ct)", "date posted", "posted"),
    "gd": ("game date", "gd"),
    "kt": ("game kickoff time (et)", "kickoff time (et)", "kt"),
    "prime": ("prime time (y/n)", "prime time", "prime"),
    "slot": ("prime time slot", "slot"),
    "sport": ("sport category", "sport"),
    "lg": ("league/event", "league", "lg"),
    "bt": ("bet type", "bt"),
    "legs": ("selection/legs", "selection", "legs"),
    "n": ("# legs", "n legs", "n"),
    "odds": ("odds (american)", "odds (american/decimal)", "odds"),
    "dec": ("odds (decimal)", "dec"),
    "stake": ("stake $", "stake"),
    "units": ("units",),
    "towin": ("to win/payout $ (total return)", "to win $", "towin"),
    "book": ("book/platform", "book"),
    "res": ("result", "res"),
    "src": ("result source", "src"),
    "promo": ("sponsored/promo flag", "promo flag", "promo"),
    "url": ("post url", "url"),
    "notes": ("notes",),
    "ps": ("single vs parlay", "ps"),
    # Live tracker added this as column AE; match by name so extra columns
    # (or a later insert) never shift the rest of the row.
    "pick_class": ("pick class",),
}

# Bettors with no posted stake / units — any P/L is a hypothetical 1u figure.
HYPOTHETICAL_1U_WHO = frozenset({"lockedin_sportz"})

_SSML = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def bets_sync_enabled() -> bool:
    return os.environ.get("SJ_BETS_SYNC", "1") != "0"


def _norm_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return True
    text = str(value).strip()
    return _norm_key(text) in BLANK


def _as_text(value: Any) -> str:
    if _is_blank(value):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def strip_value_prefix(value: Any) -> Any:
    """Sheet export artifact: ``Value`` / ``Value `` is blank; ``Value -6.5`` → ``-6.5``."""
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    text = str(value).strip()
    if _norm_key(text) == "value":
        return ""
    if text.lower().startswith("value "):
        return text[6:].strip()
    return text


def _sheet_text(value: Any) -> str:
    return _as_text(strip_value_prefix(value))


def _as_float(value: Any) -> float | None:
    if _is_blank(value):
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        num = float(value)
        return None if math.isnan(num) or math.isinf(num) else num
    text = str(value).strip().replace(",", "").replace("$", "")
    text = text.replace("u", "").replace("U", "")
    try:
        num = float(text)
    except ValueError:
        return None
    return None if math.isnan(num) or math.isinf(num) else num


def _as_int(value: Any) -> int | None:
    num = _as_float(value)
    if num is None:
        return None
    return round(num)


def normalize_who(value: Any) -> str:
    text = _as_text(value)
    key = _norm_key(text).lstrip("@")
    if key in TRENT_ALIASES:
        return "Trent"
    if key in STEVE_ALIASES:
        return "Steve"
    stripped = text[1:].strip() if text.startswith("@") else text
    return stripped or "Unknown"


def is_hypothetical_1u(who: Any) -> bool:
    """True when the sheet posts no stake/units (Lockedin_Sportz / Z-)."""
    return _norm_key(who).lstrip("@") in HYPOTHETICAL_1U_WHO


def unique_bettors(bets: Iterable[dict[str, Any]]) -> list[str]:
    """Distinct ``who`` values, most slips first (stable alpha tie-break)."""
    counts: Counter[str] = Counter()
    for bet in bets:
        who = _as_text(bet.get("who")) or "Unknown"
        counts[who] += 1
    return [
        who
        for who, _n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower(), kv[0]))
    ]


def invert_result(value: Any) -> str:
    """W↔L; Push / Pending / Unknown stay put."""
    res = normalize_result(value)
    if res == "W":
        return "L"
    if res == "L":
        return "W"
    return res


def fade_pl(
    result: Any,
    *,
    american: float = FADE_AMERICAN,
    stake: float = FADE_STAKE,
) -> float | None:
    """Net $ for a graded fade priced at ``american`` on ``stake`` (default −110 / $100)."""
    res = normalize_result(result)
    if not is_graded(res):
        return None
    if res == "Push":
        return 0.0
    if res == "L":
        return -stake
    dec = american_to_decimal(american)
    if dec is None:
        return None
    return stake * (dec - 1.0)


def normalize_result(value: Any) -> str:
    key = _norm_key(value)
    mapping = {
        "w": "W",
        "win": "W",
        "won": "W",
        "l": "L",
        "loss": "L",
        "lost": "L",
        "push": "Push",
        "p": "Push",
        "pending": "Pending",
        "unknown": "Unknown",
        "": "Unknown",
    }
    return mapping.get(key, _as_text(value) or "Unknown")


def from_excel_serial(value: Any) -> datetime | None:
    """Convert an Excel serial (or ISO / already-parsed datetime) to datetime."""
    if _is_blank(value):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    num = _as_float(value)
    if num is not None and 20000 < num < 80000:
        return _EXCEL_EPOCH + timedelta(days=num)
    text = _as_text(value)
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m/%d/%Y %H:%M:%S",
    ):
        try:
            raw = text.replace("+00:00", "+0000") if "%z" in fmt else text
            parsed = datetime.strptime(raw, fmt)  # noqa: DTZ007
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            continue
    return None


def format_posted(value: Any) -> str | None:
    dt = from_excel_serial(value)
    if dt is None:
        text = _as_text(value)
        return text or None
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def format_game_date(value: Any) -> str | None:
    dt = from_excel_serial(value)
    if dt is None:
        text = _as_text(value)
        if re.match(r"^\d{4}-\d{2}-\d{2}", text):
            return text[:10]
        return text or None
    return dt.strftime("%Y-%m-%d")


def american_to_decimal(american: float) -> float | None:
    if american == 0:
        return None
    if american > 0:
        return 1.0 + american / 100.0
    return 1.0 + 100.0 / abs(american)


def parse_odds(raw: Any, decimal_hint: Any = None) -> tuple[str | None, float | None]:
    """Return (american-or-raw-string, decimal). Blank / 'not shown' → (None, None)."""
    dec = _as_float(decimal_hint)
    if _is_blank(raw):
        return None, dec
    text = _as_text(raw)
    compact = text.replace(",", "").replace(" ", "")
    if compact.startswith(("+", "-")) or re.fullmatch(r"-?\d+(\.\d+)?", compact):
        num = _as_float(compact)
        if num is None:
            return text, dec
        # Bare 1.xx–50 without a sign is decimal odds; ± / large ints are American.
        if not compact.startswith(("+", "-")) and 1 < num < 50 and "." in compact:
            return text, dec if dec is not None else num
        if dec is None and (abs(num) >= 100 or compact.startswith(("+", "-"))):
            dec = american_to_decimal(num)
        return text, dec
    return text, dec


def window_date(bet: dict[str, Any]) -> tuple[date | None, str]:
    """Game date if present, otherwise the posted date. States which one."""
    gd = format_game_date(bet.get("gd"))
    if gd:
        try:
            return date.fromisoformat(gd[:10]), "game"
        except ValueError:
            pass
    posted = format_posted(bet.get("posted"))
    if posted:
        try:
            return date.fromisoformat(posted[:10]), "posted"
        except ValueError:
            pass
    return None, "none"


def in_window(bet: dict[str, Any], window: str) -> bool:
    start = WINDOWS.get(window, None)
    if start is None:
        return True
    when, _basis = window_date(bet)
    if when is None:
        return False
    return when >= start


def classify_parlay(bet: dict[str, Any]) -> str:
    """``single`` vs ``multi`` (parlay / SGP / PrizePicks / n≥2)."""
    n = _as_int(bet.get("n"))
    if n is not None:
        return "multi" if n >= 2 else "single"
    ps = _norm_key(bet.get("ps"))
    if "parlay" in ps or "multi" in ps:
        return "multi"
    bt = _norm_key(bet.get("bt"))
    if bt in MULTI_TYPES or bt == "sgp":
        return "multi"
    return "single"


def is_graded(result: str) -> bool:
    return normalize_result(result).lower() in GRADED


def dollar_pl(bet: dict[str, Any]) -> float | None:
    """Net $ P/L for a graded slip that has a visible stake. Else None."""
    res = normalize_result(bet.get("res"))
    if not is_graded(res):
        return None
    stake = _as_float(bet.get("stake"))
    if stake is None:
        return None
    if res == "L":
        return -stake
    if res == "Push":
        return 0.0
    towin = _as_float(bet.get("towin"))
    if towin is not None and _is_blank(bet.get("odds")):
        # No posted American price: the sheet's decimal is a rounded helper,
        # so the posted payout is the exact figure (matches sheet P/L $).
        return towin - stake if towin > stake else towin
    dec = _as_float(bet.get("dec"))
    if dec is None:
        _odds, dec = parse_odds(bet.get("odds"), bet.get("dec"))
    if dec is not None:
        return stake * (dec - 1.0)
    if towin is None:
        return None
    # Sheet mixes "profit" and "total return"; total return is always > stake.
    return towin - stake if towin > stake else towin


def flat_1u_pl(bet: dict[str, Any]) -> float | None:
    """P/L of a graded slip as if it were 1 unit. Missing odds assume −110."""
    res = normalize_result(bet.get("res"))
    if not is_graded(res):
        return None
    if res == "Push":
        return 0.0
    if res == "L":
        return -1.0
    dec = _as_float(bet.get("dec"))
    if dec is None:
        _odds, dec = parse_odds(bet.get("odds"), bet.get("dec"))
    if dec is None:
        dec = american_to_decimal(FADE_AMERICAN)
    if dec is None:
        return None
    return dec - 1.0


def units_pl(bet: dict[str, Any]) -> float | None:
    """Unit P/L when units exist and the result can be priced. Else None."""
    res = normalize_result(bet.get("res"))
    if not is_graded(res):
        return None
    units = _as_float(bet.get("units"))
    if units is None:
        return None
    if res == "L":
        return -units
    if res == "Push":
        return 0.0
    dec = _as_float(bet.get("dec"))
    if dec is None:
        _odds, dec = parse_odds(bet.get("odds"), bet.get("dec"))
    if dec is None:
        return None
    return units * (dec - 1.0)


def header_map(
    headers: Iterable[Any],
    aliases: dict[str, tuple[str, ...]] | None = None,
) -> dict[str, int]:
    """Map canonical field names to column indexes by header text, not order."""
    spec = aliases or _HEADER_ALIASES
    index: dict[str, int] = {}
    normalized = [_norm_key(h) for h in headers]
    for field, names in spec.items():
        for i, name in enumerate(normalized):
            if name in names:
                index[field] = i
                break
    return index


def _header_map(headers: Iterable[Any]) -> dict[str, int]:
    return header_map(headers, _HEADER_ALIASES)


def locate_header_row(
    rows: list[list[Any]],
    aliases: dict[str, tuple[str, ...]],
    required: Iterable[str],
) -> int | None:
    """Index of the first row whose headers cover ``required`` fields.

    Title / spacer rows above a table are skipped so sections can move.
    """
    needed = tuple(required)
    for i, row in enumerate(rows):
        mapping = header_map(row, aliases)
        if all(key in mapping for key in needed):
            return i
    return None


def cut_header_table(
    rows: list[list[Any]],
    aliases: dict[str, tuple[str, ...]],
    required: Iterable[str],
) -> tuple[list[str], list[list[Any]]]:
    """Split a grid into (header cells, data rows) by header names."""
    idx = locate_header_row(rows, aliases, required)
    if idx is None:
        return [], []
    headers = ["" if h is None else str(h) for h in rows[idx]]
    return headers, rows[idx + 1 :]


def _cell(row: list[Any], mapping: dict[str, int], field: str) -> Any:
    idx = mapping.get(field)
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def normalize_row(row: dict[str, Any] | list[Any], headers: list[Any] | None = None) -> dict[str, Any] | None:
    """Normalize one sheet row or Gamba JSON object. Skip empty / header repeats."""
    if isinstance(row, dict):
        # Already Gamba-shaped (id/who) or a sheet-header dict.
        if "who" in row and "id" in row:
            source = row
        else:
            mapping = _header_map(row.keys())
            if "id" not in mapping:
                return None
            source = {}
            for field, aliases in _HEADER_ALIASES.items():
                for key, val in row.items():
                    if _norm_key(key) in aliases:
                        source[field] = val
                        break
    else:
        mapping = _header_map(headers or [])
        if "id" not in mapping:
            return None
        source = {field: _cell(row, mapping, field) for field in _HEADER_ALIASES}

    bet_id = _sheet_text(source.get("id"))
    if not bet_id or _norm_key(bet_id) in {"bet id", "id"}:
        return None

    odds, dec = parse_odds(
        strip_value_prefix(source.get("odds")),
        strip_value_prefix(source.get("dec")),
    )
    units_raw = strip_value_prefix(source.get("units"))
    units = None if _is_blank(units_raw) else _as_float(units_raw)
    n = _as_int(strip_value_prefix(source.get("n")))
    bet = {
        "id": bet_id,
        "who": normalize_who(source.get("who")),
        "posted": format_posted(source.get("posted")),
        "gd": format_game_date(source.get("gd")),
        "kt": _sheet_text(source.get("kt")) or None,
        "prime": _sheet_text(source.get("prime")) or "",
        "slot": _sheet_text(source.get("slot")),
        "sport": _sheet_text(source.get("sport")) or "Other",
        "lg": _sheet_text(source.get("lg")),
        "bt": _sheet_text(source.get("bt")),
        "legs": _sheet_text(source.get("legs")),
        "n": n,
        "odds": odds,
        "dec": dec,
        "stake": _as_float(strip_value_prefix(source.get("stake"))),
        "units": units,
        "towin": _as_float(strip_value_prefix(source.get("towin"))),
        "book": _sheet_text(source.get("book")),
        "res": normalize_result(strip_value_prefix(source.get("res"))),
        "src": _sheet_text(source.get("src")),
        "promo": _sheet_text(source.get("promo")) or "N",
        "url": _sheet_text(source.get("url")),
        "notes": _sheet_text(source.get("notes")),
        "ps": _sheet_text(source.get("ps")),
        "pick_class": _sheet_text(source.get("pick_class")),
    }
    if not bet["ps"]:
        bet["ps"] = "Parlay/multi-leg" if classify_parlay(bet) == "multi" else "Single"
    return bet


def normalize_rows(rows: Iterable[Any], headers: list[Any] | None = None) -> list[dict[str, Any]]:
    bets: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        bet = normalize_row(row, headers)
        if bet is None or bet["id"] in seen:
            continue
        seen.add(bet["id"])
        bets.append(bet)
    return bets


def _ratio(num: float, den: float) -> float | None:
    if den == 0:
        return None
    return num / den


def bettor_kpis(bets: Iterable[dict[str, Any]], who: str | None = None) -> dict[str, Any]:
    rows = [b for b in bets if who is None or b.get("who") == who]
    wins = losses = pushes = pending = unknown = 0
    stake = pl = 0.0
    stake_n = 0
    units_staked = units_profit = 0.0
    units_n = 0
    for bet in rows:
        res = normalize_result(bet.get("res"))
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
        dollar = dollar_pl(bet)
        if dollar is not None:
            stake_amt = _as_float(bet.get("stake")) or 0.0
            stake += stake_amt
            pl += dollar
            stake_n += 1
        u_pl = units_pl(bet)
        units_amt = _as_float(bet.get("units"))
        if u_pl is not None and units_amt is not None:
            units_staked += units_amt
            units_profit += u_pl
            units_n += 1
    decided = wins + losses
    return {
        "who": who,
        "bets": len(rows),
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "pending": pending,
        "unknown": unknown,
        "record": f"{wins}-{losses}-{pushes}",
        "win_pct": _ratio(float(wins), float(decided)),
        "stake": stake if stake_n else None,
        "pl": pl if stake_n else None,
        "roi": _ratio(pl, stake) if stake_n else None,
        "units_staked": units_staked if units_n else None,
        "units_pl": units_profit if units_n else None,
        "units_roi": _ratio(units_profit, units_staked) if units_n else None,
    }


def filter_bets(
    bets: Iterable[dict[str, Any]],
    *,
    window: str = "all",
    sport: str | None = None,
    who: str | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    sport_key = _norm_key(sport) if sport else ""
    for bet in bets:
        if who and bet.get("who") != who:
            continue
        if not in_window(bet, window):
            continue
        if sport_key and _norm_key(bet.get("sport")) != sport_key:
            continue
        out.append(bet)
    return out


def breakdown(
    bets: Iterable[dict[str, Any]],
    key_fn,
) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for bet in bets:
        label = str(key_fn(bet) or "—")
        groups.setdefault(label, []).append(bet)
    rows = []
    for label, items in groups.items():
        kpi = bettor_kpis(items)
        rows.append({"key": label, **kpi, "who": None})
    rows.sort(key=lambda row: (-row["bets"], str(row["key"])))
    return rows


def build_document(
    bets: list[dict[str, Any]],
    *,
    synced_at: str | None = None,
    source: str = "sheet",
) -> dict[str, Any]:
    stamp = synced_at or datetime.now(timezone.utc).isoformat()
    ordered = sorted(
        bets,
        key=lambda b: (b.get("posted") or "", b.get("id") or ""),
        reverse=True,
    )
    return {
        "synced_at": stamp,
        "source": source,
        "sheet_id": DEFAULT_SHEET_ID,
        "tab": DEFAULT_SHEET_TAB,
        "bet_count": len(ordered),
        "bets": ordered,
    }


def build_summary(document: dict[str, Any]) -> dict[str, Any]:
    bets = list(document.get("bets") or [])
    names = unique_bettors(bets)
    return {
        "synced_at": document.get("synced_at"),
        "source": document.get("source"),
        "bet_count": len(bets),
        # Stable keys from P.11 — empty KPI objects when that name is absent.
        "trent": bettor_kpis(bets, "Trent"),
        "steve": bettor_kpis(bets, "Steve"),
        "all": bettor_kpis(bets),
        "bettors": [bettor_kpis(bets, who) for who in names],
    }


def _col_index(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _xlsx_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    out: list[str] = []
    for si in root.findall("m:si", _SSML):
        out.append("".join(t.text or "" for t in si.findall(".//m:t", _SSML)))
    return out


def _xlsx_cell_value(cell: ET.Element, shared: list[str]) -> Any:
    kind = cell.get("t")
    value = cell.find("m:v", _SSML)
    inline = cell.find("m:is", _SSML)
    if kind == "s" and value is not None and value.text:
        return shared[int(value.text)]
    if kind == "inlineStr" and inline is not None:
        return "".join(t.text or "" for t in inline.findall(".//m:t", _SSML))
    if value is None or value.text is None:
        return ""
    text = value.text
    if kind == "n" or kind is None:
        try:
            num = float(text)
            return int(num) if num.is_integer() else num
        except ValueError:
            return text
    return text


def list_xlsx_sheets(source: Path | str | bytes | zipfile.ZipFile) -> list[str]:
    """Worksheet names in workbook order."""
    own = False
    if isinstance(source, zipfile.ZipFile):
        zf = source
    else:
        own = True
        zf_src: Path | str | BytesIO
        if isinstance(source, (bytes, bytearray)):
            zf_src = BytesIO(source)
        else:
            zf_src = source
        zf = zipfile.ZipFile(zf_src)
    try:
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        return [sheet.get("name") or "" for sheet in wb.findall("m:sheets/m:sheet", _SSML)]
    finally:
        if own:
            zf.close()


def sheet_a1_range(tab: str) -> str:
    """Quote a worksheet name for the Sheets API (whole used range)."""
    if re.fullmatch(r"[A-Za-z0-9_]+", tab):
        return tab
    return "'" + tab.replace("'", "''") + "'"


def read_xlsx_grid(
    source: Path | str | bytes | zipfile.ZipFile,
    sheet_name: str = DEFAULT_SHEET_TAB,
) -> list[list[Any]]:
    """Read one worksheet as a raw grid (every used row, no header assumption)."""
    label = "xlsx"
    own = False
    if isinstance(source, zipfile.ZipFile):
        zf = source
    else:
        own = True
        zf_src: Path | str | BytesIO
        if isinstance(source, (bytes, bytearray)):
            zf_src = BytesIO(source)
        else:
            zf_src = source
            label = str(source)
        zf = zipfile.ZipFile(zf_src)
    try:
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rels = {rel.get("Id"): rel.get("Target") for rel in rels_root}
        ns_r = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
        target = None
        for sheet in wb.findall("m:sheets/m:sheet", _SSML):
            if sheet.get("name") == sheet_name:
                rid = sheet.get(f"{ns_r}id")
                target = rels.get(rid or "")
                break
        if not target:
            raise FileNotFoundError(
                f"sheet {sheet_name!r} not in {label}; have {list_xlsx_sheets(zf)}"
            )
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = f"xl/{target}"
        shared = _xlsx_shared_strings(zf)
        ws = ET.fromstring(zf.read(target))
        rows_out: list[list[Any]] = []
        for row in ws.findall("m:sheetData/m:row", _SSML):
            cells: dict[int, Any] = {}
            max_idx = -1
            for cell in row.findall("m:c", _SSML):
                idx = _col_index(cell.get("r") or "A")
                cells[idx] = _xlsx_cell_value(cell, shared)
                max_idx = max(max_idx, idx)
            if max_idx < 0:
                continue
            rows_out.append([cells.get(i, "") for i in range(max_idx + 1)])
        return rows_out
    finally:
        if own:
            zf.close()


def _tab_header_spec(tab: str) -> tuple[dict[str, tuple[str, ...]], tuple[str, ...]] | None:
    """Header aliases + required keys for a raw tracker tab. None = keep grid."""
    if tab == RECORD_SPLITS_TAB:
        return None
    if tab == PARLAY_TAB:
        from sj.bets_parlay import _HEADER_ALIASES as aliases

        return aliases, ("id", "who")
    if tab == PUBLIC_TAB:
        from sj.bets_public import _HEADER_ALIASES as aliases

        return aliases, ("id",)
    return _HEADER_ALIASES, ("id", "who")


def sheet_as_table(
    grid: list[list[Any]],
    tab: str = DEFAULT_SHEET_TAB,
) -> tuple[list[str], list[list[Any]]]:
    """Cut a grid at the header row for ``tab``. Record Splits stays a raw grid."""
    spec = _tab_header_spec(tab)
    if spec is None:
        return [], list(grid)
    aliases, required = spec
    headers, rows = cut_header_table(grid, aliases, required)
    if headers:
        return headers, rows
    if not grid:
        return [], []
    return ["" if h is None else str(h) for h in grid[0]], grid[1:]


def read_xlsx_rows(
    source: Path | str | bytes,
    sheet_name: str = DEFAULT_SHEET_TAB,
) -> tuple[list[str], list[list[Any]]]:
    """Read one worksheet as header + row lists (stdlib; no openpyxl).

    Headers are found by name, so title rows above the table are skipped.
    """
    return sheet_as_table(read_xlsx_grid(source, sheet_name), sheet_name)


def load_local_rows(path: Path | str) -> list[dict[str, Any]]:
    file = Path(path)
    if file.suffix.lower() == ".json":
        payload = json.loads(file.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            payload = payload.get("bets") or payload.get("rows") or []
        return normalize_rows(payload)
    headers, rows = read_xlsx_rows(file)
    return normalize_rows(rows, headers)


def load_local_workbook(
    path: Path | str,
) -> dict[str, tuple[list[str], list[list[Any]]]]:
    """Read every named tracker tab that exists in an xlsx (missing tabs omitted)."""
    file = Path(path)
    names = set(list_xlsx_sheets(file))
    out: dict[str, tuple[list[str], list[list[Any]]]] = {}
    for tab in TRACKER_TABS:
        if tab in names:
            out[tab] = sheet_as_table(read_xlsx_grid(file, tab), tab)
    return out


def _adc_token(scopes: Iterable[str] = READONLY_SCOPES) -> str:
    try:
        import google.auth
        from google.auth.transport.requests import Request
    except ImportError as exc:  # pragma: no cover - image always has GCS extra
        raise RuntimeError(
            "google-auth is required to read the tracker (sync image has it)"
        ) from exc

    creds, _project = google.auth.default(scopes=list(scopes))
    if not creds.valid:
        creds.refresh(Request())
    return creds.token


def _http_get(url: str, *, token: str | None = None, opener=None, timeout: int = 30) -> bytes:
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    fetch = opener or urllib.request.urlopen
    try:
        with fetch(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"Google API {exc.code}: {body}") from exc


def lookup_drive_mime(
    file_id: str,
    *,
    opener=None,
    token: str | None = None,
) -> str:
    """Drive ``files.get`` mimeType (read-only)."""
    token = token or _adc_token()
    quoted = urllib.parse.quote(file_id, safe="")
    qs = urllib.parse.urlencode({"fields": "id,name,mimeType", "supportsAllDrives": "true"})
    url = f"{DRIVE_FILE_URL.format(file_id=quoted)}?{qs}"
    payload = json.loads(_http_get(url, token=token, opener=opener).decode("utf-8"))
    mime = str(payload.get("mimeType") or "").strip()
    if not mime:
        raise RuntimeError(f"Drive files.get returned no mimeType for {file_id}")
    return mime


def download_drive_file(
    file_id: str,
    *,
    opener=None,
    token: str | None = None,
) -> bytes:
    """Drive ``files.get?alt=media`` (read-only)."""
    token = token or _adc_token()
    quoted = urllib.parse.quote(file_id, safe="")
    qs = urllib.parse.urlencode({"alt": "media", "supportsAllDrives": "true"})
    url = f"{DRIVE_FILE_URL.format(file_id=quoted)}?{qs}"
    return _http_get(url, token=token, opener=opener)


def fetch_sheet_values(
    sheet_id: str,
    tab: str,
    *,
    opener=None,
    token: str | None = None,
) -> tuple[list[str], list[list[Any]]]:
    """One worksheet via Sheets ``values.get`` — whole used range, headers by name."""
    token = token or _adc_token()
    range_ = urllib.parse.quote(sheet_a1_range(tab), safe="")
    url = SHEETS_VALUES_URL.format(sheet_id=sheet_id, range_=range_)
    url += "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER"
    payload = json.loads(_http_get(url, token=token, opener=opener).decode("utf-8"))
    values = payload.get("values") or []
    if not values:
        return [], []
    return sheet_as_table(values, tab)


def list_remote_tabs(
    sheet_id: str,
    *,
    opener=None,
    token: str | None = None,
) -> list[str]:
    """Native-Sheet tab titles (readonly)."""
    token = token or _adc_token()
    qs = urllib.parse.urlencode({"fields": "sheets.properties.title"})
    url = f"{SHEETS_SPREADSHEET_URL.format(sheet_id=sheet_id)}?{qs}"
    payload = json.loads(_http_get(url, token=token, opener=opener).decode("utf-8"))
    names: list[str] = []
    for sheet in payload.get("sheets") or []:
        title = ((sheet.get("properties") or {}).get("title") or "").strip()
        if title:
            names.append(title)
    return names


def fetch_sheet_workbook(
    sheet_id: str = DEFAULT_SHEET_ID,
    tabs: Iterable[str] = TRACKER_TABS,
    *,
    opener=None,
    token: str | None = None,
) -> dict[str, tuple[list[str], list[list[Any]]]]:
    """Fetch named tabs that exist on a native Sheet (missing tabs omitted)."""
    token = token or _adc_token()
    present = set(list_remote_tabs(sheet_id, opener=opener, token=token))
    wanted = [tab for tab in tabs if tab in present]
    out: dict[str, tuple[list[str], list[list[Any]]]] = {}
    if not wanted:
        return out
    # One batchGet so added columns on any tab are included (no A:AD cap).
    params = [("valueRenderOption", "UNFORMATTED_VALUE"), ("dateTimeRenderOption", "SERIAL_NUMBER")]
    params.extend(("ranges", sheet_a1_range(tab)) for tab in wanted)
    url = SHEETS_BATCH_URL.format(sheet_id=sheet_id) + "?" + urllib.parse.urlencode(params)
    payload = json.loads(_http_get(url, token=token, opener=opener).decode("utf-8"))
    for tab, vr in zip(wanted, payload.get("valueRanges") or []):
        values = vr.get("values") or []
        if not values:
            out[tab] = ([], [])
            continue
        out[tab] = sheet_as_table(values, tab)
    return out


def fetch_sheet_rows(
    sheet_id: str = DEFAULT_SHEET_ID,
    tab: str = DEFAULT_SHEET_TAB,
    *,
    opener=None,
    token: str | None = None,
) -> list[dict[str, Any]]:
    """Read one tab via the Sheets API and normalize as Bets rows."""
    headers, rows = fetch_sheet_values(sheet_id, tab, opener=opener, token=token)
    return normalize_rows(rows, headers)


def fetch_xlsx_workbook(
    file_id: str = DEFAULT_SHEET_ID,
    tabs: Iterable[str] = TRACKER_TABS,
    *,
    opener=None,
    token: str | None = None,
) -> dict[str, tuple[list[str], list[list[Any]]]]:
    """Download an uploaded .xlsx once and parse every named tracker tab."""
    data = download_drive_file(file_id, opener=opener, token=token)
    names = set(list_xlsx_sheets(data))
    out: dict[str, tuple[list[str], list[list[Any]]]] = {}
    for tab in tabs:
        if tab in names:
            out[tab] = read_xlsx_rows(data, tab)
    return out


def fetch_xlsx_rows(
    file_id: str = DEFAULT_SHEET_ID,
    tab: str = DEFAULT_SHEET_TAB,
    *,
    opener=None,
    token: str | None = None,
) -> list[dict[str, Any]]:
    """Download an uploaded .xlsx and parse the Bets tab."""
    data = download_drive_file(file_id, opener=opener, token=token)
    headers, rows = read_xlsx_rows(data, tab)
    return normalize_rows(rows, headers)


def fetch_remote_workbook(
    file_id: str = DEFAULT_SHEET_ID,
    tabs: Iterable[str] = TRACKER_TABS,
    *,
    opener=None,
    mime_type: str | None = None,
) -> tuple[dict[str, tuple[list[str], list[list[Any]]]], str]:
    """Dispatch on Drive mimeType: native Sheet vs uploaded xlsx (all tracker tabs)."""
    mime = mime_type or lookup_drive_mime(file_id, opener=opener)
    if mime == SHEET_MIME:
        return fetch_sheet_workbook(file_id, tabs, opener=opener), "sheets"
    if mime == XLSX_MIME:
        return fetch_xlsx_workbook(file_id, tabs, opener=opener), "drive-xlsx"
    raise RuntimeError(
        f"Unsupported Drive mimeType {mime!r} for {file_id}. "
        "Share a native Google Sheet or an uploaded .xlsx as Viewer; "
        "no conversion is required."
    )


def fetch_remote_rows(
    file_id: str = DEFAULT_SHEET_ID,
    tab: str = DEFAULT_SHEET_TAB,
    *,
    opener=None,
    mime_type: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """Dispatch on Drive mimeType and normalize one tab as Bets rows."""
    mime = mime_type or lookup_drive_mime(file_id, opener=opener)
    if mime == SHEET_MIME:
        return fetch_sheet_rows(file_id, tab, opener=opener), "sheets"
    if mime == XLSX_MIME:
        return fetch_xlsx_rows(file_id, tab, opener=opener), "drive-xlsx"
    raise RuntimeError(
        f"Unsupported Drive mimeType {mime!r} for {file_id}. "
        "Share a native Google Sheet or an uploaded .xlsx as Viewer; "
        "no conversion is required."
    )


def export_bets(
    *,
    sheet_id: str = DEFAULT_SHEET_ID,
    tab: str = DEFAULT_SHEET_TAB,
    from_path: Path | str | None = None,
    store_dir: Path | str | None = None,
    source: str | None = None,
) -> dict[str, Any]:
    """Normalize tracker tabs and write bets / summary / parlay / public / splits."""
    from sj.bets_parlay import build_parlay_document, normalize_parlay_rows
    from sj.bets_public import build_public_document, normalize_public_rows
    from sj.bets_splits import build_splits_document, parse_splits_grid

    book: dict[str, tuple[list[str], list[list[Any]]]] = {}
    bets: list[dict[str, Any]]
    if from_path:
        src = source or f"fixture:{Path(from_path).name}"
        if Path(from_path).suffix.lower() == ".json":
            bets = load_local_rows(from_path)
        else:
            book = load_local_workbook(from_path)
            headers, rows = book.get(tab, book.get(DEFAULT_SHEET_TAB, ([], [])))
            bets = normalize_rows(rows, headers)
    else:
        book, detected = fetch_remote_workbook(sheet_id)
        src = source or detected
        headers, rows = book.get(tab, book.get(DEFAULT_SHEET_TAB, ([], [])))
        bets = normalize_rows(rows, headers)

    document = build_document(bets, source=src)
    document["sheet_id"] = sheet_id
    document["tab"] = tab
    summary = build_summary(document)

    parlay_headers, parlay_rows = book.get(PARLAY_TAB, ([], []))
    parlay_doc = build_parlay_document(
        normalize_parlay_rows(parlay_rows, parlay_headers),
        synced_at=document["synced_at"],
        source=src,
        sheet_id=sheet_id,
    )
    public_headers, public_rows = book.get(PUBLIC_TAB, ([], []))
    public_doc = build_public_document(
        normalize_public_rows(public_rows, public_headers),
        synced_at=document["synced_at"],
        source=src,
        sheet_id=sheet_id,
    )
    _split_headers, split_grid = book.get(RECORD_SPLITS_TAB, ([], []))
    splits_doc = build_splits_document(
        parse_splits_grid(split_grid),
        synced_at=document["synced_at"],
        source=src,
        sheet_id=sheet_id,
    )

    write_bets(document, "bets", store_dir=store_dir)
    write_bets(summary, "summary", store_dir=store_dir)
    write_bets(parlay_doc, "parlay_legs", store_dir=store_dir)
    write_bets(public_doc, "public_warnings", store_dir=store_dir)
    write_bets(splits_doc, "record_splits", store_dir=store_dir)
    return {
        "bets": document,
        "summary": summary,
        "parlay_legs": parlay_doc,
        "public_warnings": public_doc,
        "record_splits": splits_doc,
    }


def dumps_bets(document: dict[str, Any]) -> str:
    return dumps_snapshot(document)
