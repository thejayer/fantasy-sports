"""Trent & Steve public-bet tracker — sheet ingest + KPI math (roadmap P.11).

Reads the Bets tab (Google Sheets or a local xlsx/JSON fixture), normalizes
each row into the Gamba-shaped JSON the portal stores at ``bets/bets.json``,
and computes records / ROI from those rows. Formula tabs and helper columns
are ignored.

Sheets API calls use ADC (the Cloud Run job SA). Tests never hit Google.
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
from collections.abc import Iterable
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from sj.jsonutil import dumps_snapshot
from sj.store import write_bets

DEFAULT_SHEET_ID = "1_F9HCU7uOPH5uo8cgXkxwKrvREolPid_ZoviVVcX3HU"
DEFAULT_SHEET_TAB = "Bets"
SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
SHEETS_VALUES_URL = (
    "https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{range_}"
)

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
}

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
    return text or "Unknown"


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
    dec = _as_float(bet.get("dec"))
    if dec is None:
        _odds, dec = parse_odds(bet.get("odds"), bet.get("dec"))
    if dec is not None:
        return stake * (dec - 1.0)
    towin = _as_float(bet.get("towin"))
    if towin is None:
        return None
    # Sheet mixes "profit" and "total return"; total return is always > stake.
    return towin - stake if towin > stake else towin


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


def _header_map(headers: Iterable[Any]) -> dict[str, int]:
    index: dict[str, int] = {}
    normalized = [_norm_key(h) for h in headers]
    for field, aliases in _HEADER_ALIASES.items():
        for i, name in enumerate(normalized):
            if name in aliases:
                index[field] = i
                break
    return index


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

    bet_id = _as_text(source.get("id"))
    if not bet_id or _norm_key(bet_id) in {"bet id", "id"}:
        return None

    odds, dec = parse_odds(source.get("odds"), source.get("dec"))
    units_raw = source.get("units")
    units = None if _is_blank(units_raw) else _as_float(units_raw)
    n = _as_int(source.get("n"))
    bet = {
        "id": bet_id,
        "who": normalize_who(source.get("who")),
        "posted": format_posted(source.get("posted")),
        "gd": format_game_date(source.get("gd")),
        "kt": _as_text(source.get("kt")) or None,
        "prime": _as_text(source.get("prime")) or "",
        "slot": _as_text(source.get("slot")),
        "sport": _as_text(source.get("sport")) or "Other",
        "lg": _as_text(source.get("lg")),
        "bt": _as_text(source.get("bt")),
        "legs": _as_text(source.get("legs")),
        "n": n,
        "odds": odds,
        "dec": dec,
        "stake": _as_float(source.get("stake")),
        "units": units,
        "towin": _as_float(source.get("towin")),
        "book": _as_text(source.get("book")),
        "res": normalize_result(source.get("res")),
        "src": _as_text(source.get("src")),
        "promo": _as_text(source.get("promo")) or "N",
        "url": _as_text(source.get("url")),
        "notes": _as_text(source.get("notes")),
        "ps": _as_text(source.get("ps")),
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
    return {
        "synced_at": document.get("synced_at"),
        "source": document.get("source"),
        "bet_count": len(bets),
        "trent": bettor_kpis(bets, "Trent"),
        "steve": bettor_kpis(bets, "Steve"),
        "all": bettor_kpis(bets),
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


def read_xlsx_rows(path: Path | str, sheet_name: str = DEFAULT_SHEET_TAB) -> tuple[list[str], list[list[Any]]]:
    """Read one worksheet as header + row lists (stdlib; no openpyxl)."""
    with zipfile.ZipFile(path) as zf:
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rels = {
            rel.get("Id"): rel.get("Target")
            for rel in rels_root
        }
        ns_r = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
        target = None
        for sheet in wb.findall("m:sheets/m:sheet", _SSML):
            if sheet.get("name") == sheet_name:
                rid = sheet.get(f"{ns_r}id")
                target = rels.get(rid or "")
                break
        if not target:
            raise FileNotFoundError(f"sheet {sheet_name!r} not in {path}")
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
    if not rows_out:
        return [], []
    headers = [str(h) for h in rows_out[0]]
    return headers, rows_out[1:]


def load_local_rows(path: Path | str) -> list[dict[str, Any]]:
    file = Path(path)
    if file.suffix.lower() == ".json":
        payload = json.loads(file.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            payload = payload.get("bets") or payload.get("rows") or []
        return normalize_rows(payload)
    headers, rows = read_xlsx_rows(file)
    return normalize_rows(rows, headers)


def fetch_sheet_rows(
    sheet_id: str = DEFAULT_SHEET_ID,
    tab: str = DEFAULT_SHEET_TAB,
    *,
    opener=None,
) -> list[dict[str, Any]]:
    """Read the Bets tab via the Sheets API (readonly scope, ADC)."""
    try:
        import google.auth
        from google.auth.transport.requests import Request
    except ImportError as exc:  # pragma: no cover - image always has GCS extra
        raise RuntimeError(
            "google-auth is required to read the sheet (sync image has it)"
        ) from exc

    creds, _project = google.auth.default(scopes=[SHEETS_READONLY_SCOPE])
    if not creds.valid:
        creds.refresh(Request())
    range_ = urllib.parse.quote(f"{tab}!A:AD", safe="")
    url = SHEETS_VALUES_URL.format(sheet_id=sheet_id, range_=range_)
    url += "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {creds.token}"},
    )
    fetch = opener or urllib.request.urlopen
    try:
        with fetch(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"Sheets API {exc.code}: {body}") from exc
    values = payload.get("values") or []
    if not values:
        return []
    headers, rows = values[0], values[1:]
    return normalize_rows(rows, headers)


def export_bets(
    *,
    sheet_id: str = DEFAULT_SHEET_ID,
    tab: str = DEFAULT_SHEET_TAB,
    from_path: Path | str | None = None,
    store_dir: Path | str | None = None,
    source: str | None = None,
) -> dict[str, Any]:
    """Normalize rows and write ``bets/bets.json`` + ``bets/summary.json``."""
    if from_path:
        bets = load_local_rows(from_path)
        src = source or f"fixture:{Path(from_path).name}"
    else:
        bets = fetch_sheet_rows(sheet_id, tab)
        src = source or "sheets"
    document = build_document(bets, source=src)
    document["sheet_id"] = sheet_id
    document["tab"] = tab
    summary = build_summary(document)
    write_bets(document, "bets", store_dir=store_dir)
    write_bets(summary, "summary", store_dir=store_dir)
    return {"bets": document, "summary": summary}


def dumps_bets(document: dict[str, Any]) -> str:
    return dumps_snapshot(document)
