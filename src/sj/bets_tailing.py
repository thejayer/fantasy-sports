"""Tailing parlay legs — join Parlay Legs to Bets (roadmap P.11).

Computes a flat 1u tail / fade at −110 plus splits (sport, pick group,
over/under, stat, platform, ticket size, month). Leg odds are usually
blank or a ``Value`` placeholder, so −110 P&L is labeled approximate.
When the parent ticket has a price, that price is split evenly across
its legs as an estimated per-leg breakeven.

Reads columns by header name via the shared ``header_map`` (key columns
preferred). Never writes to the sheet.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from typing import Any

from sj.bets import (
    DEFAULT_SHEET_ID,
    FADE_AMERICAN,
    PARLAY_TAB,
    _as_int,
    _as_text,
    _norm_key,
    _ratio,
    _sheet_text,
    american_to_decimal,
    format_game_date,
    is_graded,
    is_hypothetical_1u,
    normalize_result,
    parse_odds,
    unique_bettors,
)
from sj.bets_parlay import ou_bucket, pick_bucket

ALL_WHO = "*"
SMALL_SAMPLE = 20
ASSUMED_AMERICAN = FADE_AMERICAN
ODDS_NOTE = (
    "Leg odds are mostly missing (blank or a Value placeholder), so the "
    "flat −110 tail / fade P&L is an approximation. Where the parent "
    "parlay has a posted price, that price is split evenly across its "
    "legs as an estimated per-leg breakeven."
)

SIZE_ORDER = ("2-3 legs", "4-5 legs", "6+ legs")
MONTH_ORDER = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)
_MONTH_LABEL = {
    1: "Jan",
    2: "Feb",
    3: "Mar",
    4: "Apr",
    5: "May",
    6: "Jun",
    7: "Jul",
    8: "Aug",
    9: "Sep",
    10: "Oct",
    11: "Nov",
    12: "Dec",
}

# League / sport tokens that the Parlay Legs tab sometimes parks in Other.
_SPORT_ALIASES = {
    "mlb": "MLB",
    "nfl": "NFL",
    "nba": "NBA",
    "nhl": "NHL",
    "hockey": "NHL",
    "cfb": "CFB",
    "ncaaf": "CFB",
    "college football": "CFB",
    "cbb": "CBB",
    "ncaab": "CBB",
    "tennis": "Tennis",
    "atp": "Tennis",
    "wta": "Tennis",
    "kbo": "KBO/NPB",
    "npb": "KBO/NPB",
    "kbo npb": "KBO/NPB",
    "kbo/npb": "KBO/NPB",
}

_AMERICAN_TOKEN = re.compile(r"(?<![A-Za-z0-9./])([+-]\d{3,4})(?!\d)")


def assumed_decimal() -> float:
    dec = american_to_decimal(ASSUMED_AMERICAN)
    assert dec is not None
    return dec


def assumed_breakeven() -> float:
    return 1.0 / assumed_decimal()


def parse_american_odds(raw: Any) -> int | None:
    """American odds from a cell. Blank / ``Value`` / non-prices → None."""
    text = _sheet_text(raw)
    if not text:
        return None
    _odds, dec = parse_odds(text)
    if dec is None:
        return None
    compact = text.replace(",", "").replace(" ", "")
    if compact.startswith(("+", "-")) or (
        re.fullmatch(r"-?\d+", compact) and abs(int(compact)) >= 100
    ):
        num = round(float(compact))
        if abs(num) >= 100:
            return num
    return None


def ticket_implied_decimal(parent_dec: float | None, n: int | None) -> float | None:
    """Even split of a parent ticket price: ``dec ** (1/n)``. Estimate only."""
    if parent_dec is None or n is None:
        return None
    if n < 2 or parent_dec <= 1.0 or not math.isfinite(parent_dec):
        return None
    implied = parent_dec ** (1.0 / n)
    if not math.isfinite(implied) or implied <= 1.0:
        return None
    return implied


def ticket_size_bucket(n: int | None) -> str:
    if n is None or n < 2:
        return "Unknown"
    if n <= 3:
        return "2-3 legs"
    if n <= 5:
        return "4-5 legs"
    return "6+ legs"


def month_bucket(gd: Any, posted: Any = None) -> str:
    for raw in (gd, posted):
        text = format_game_date(raw) or _sheet_text(raw)
        if not text:
            continue
        match = re.match(r"^(\d{4})-(\d{2})", text)
        if match:
            return _MONTH_LABEL.get(int(match.group(2)), match.group(2))
    return "Unknown"


def platform_bucket(bet_type: Any, book: Any = None) -> str:
    key = _norm_key(f"{_sheet_text(bet_type)} {_sheet_text(book)}")
    if "surgical" in key:
        return "Surgical Six (PrizePicks)"
    if "prizepicks" in key or "prize picks" in key or "dfs" in key:
        return "PrizePicks"
    if "future" in key:
        return "Season futures"
    if "kalshi" in key:
        return "Kalshi"
    if "parlay" in key or "sportsbook" in key or key in {"sgp", "s"}:
        return "Sportsbook parlay"
    text = _sheet_text(bet_type) or _sheet_text(book)
    return text or "Other"


def normalize_leg_sport(sport: Any, league: Any = None) -> str:
    """Prefer the Sport column; remap Other+league (NHL, KBO/NPB, tennis)."""
    sport_text = _sheet_text(sport) or "Other"
    league_text = _sheet_text(league)
    sport_key = _norm_key(sport_text)
    if sport_key in _SPORT_ALIASES:
        return _SPORT_ALIASES[sport_key]
    if sport_key not in {"", "other"}:
        return sport_text
    league_key = _norm_key(league_text)
    if league_key in _SPORT_ALIASES:
        return _SPORT_ALIASES[league_key]
    blob = f"{sport_key} {league_key}"
    for token, label in _SPORT_ALIASES.items():
        if token in blob:
            return label
    return sport_text or "Other"


def normalize_leg_type(value: Any) -> str:
    key = _norm_key(_sheet_text(value))
    if key in {"m", "ml", "moneyline"} or "moneyline" in key:
        return "Moneyline"
    if key in {"p", "prop", "player prop"} or "prop" in key:
        return "Prop"
    if key in {"t", "total", "totals"} or "total" in key:
        return "Total"
    if key in {"s", "spread", "ats"} or "spread" in key:
        return "Spread"
    if not key:
        return ""
    return _sheet_text(value) or "Other"


def team_type_label(leg: dict[str, Any]) -> str:
    if pick_bucket(leg.get("pick")) != "Team pick":
        return ""
    kind = normalize_leg_type(leg.get("leg_type"))
    if kind == "Moneyline":
        am = leg.get("odds_american")
        if isinstance(am, (int, float)):
            return (
                "ML favorite (odds known)"
                if am < 0
                else "ML underdog (odds known)"
            )
        return "ML (odds not shown)"
    return kind or "Other"


def extract_selection_odds(text: Any) -> list[tuple[str, int]]:
    """``(nearby text, american)`` pairs from a parent Selection/legs cell."""
    raw = _sheet_text(text)
    if not raw:
        return []
    out: list[tuple[str, int]] = []
    for match in _AMERICAN_TOKEN.finditer(raw):
        am = int(match.group(1))
        if abs(am) < 100:
            continue
        start = max(0, match.start() - 48)
        ctx = raw[start : match.end()]
        out.append((ctx, am))
    return out


def _parent_decimal(parent: dict[str, Any] | None) -> float | None:
    if not parent:
        return None
    dec = parent.get("dec")
    if isinstance(dec, (int, float)) and math.isfinite(dec) and dec > 1:
        return float(dec)
    _odds, parsed = parse_odds(parent.get("odds"), parent.get("dec"))
    if parsed is not None and parsed > 1:
        return parsed
    return None


def _parent_n(leg: dict[str, Any], parent: dict[str, Any] | None) -> int | None:
    if parent and parent.get("n") is not None:
        return _as_int(parent.get("n"))
    return _as_int(leg.get("parent_n")) or _as_int(leg.get("n"))


def assign_selection_odds(group: list[dict[str, Any]], parent: dict[str, Any]) -> None:
    """Fill missing leg American odds from the parent Selection/legs text."""
    pairs = extract_selection_odds(parent.get("legs"))
    if not pairs:
        return
    unused = list(pairs)
    for leg in group:
        if leg.get("odds_american") is not None:
            continue
        hay = " ".join(
            part
            for part in (
                _sheet_text(leg.get("sel")),
                _sheet_text(leg.get("player")),
            )
            if part
        ).casefold()
        if not hay:
            continue
        tokens = [tok for tok in re.split(r"[^a-z0-9]+", hay) if len(tok) >= 4]
        for i, (ctx, am) in enumerate(unused):
            ctx_key = ctx.casefold()
            if any(tok in ctx_key for tok in tokens):
                leg["odds_american"] = am
                unused.pop(i)
                break
    pending = [leg for leg in group if leg.get("odds_american") is None]
    if pending and len(unused) == len(pending):
        for leg, (_ctx, am) in zip(pending, unused, strict=False):
            leg["odds_american"] = am


def enrich_leg(leg: dict[str, Any], parent: dict[str, Any] | None) -> dict[str, Any]:
    """Join one Parlay Legs row to its parent Bets row (header-derived fields)."""
    ticket_n = _parent_n(leg, parent)
    parent_bt = ""
    parent_book = ""
    parent_dec = None
    if parent:
        parent_bt = _sheet_text(parent.get("bt"))
        parent_book = _sheet_text(parent.get("book"))
        parent_dec = _parent_decimal(parent)
    if not parent_bt:
        parent_bt = _sheet_text(leg.get("parent_bt"))
    sport = normalize_leg_sport(leg.get("sport"), leg.get("lg"))
    pick = pick_bucket(leg.get("pick"))
    ou = ou_bucket(leg.get("dir")) if pick == "Player prop" else ""
    res = normalize_result(leg.get("res"))
    odds_am = parse_american_odds(leg.get("odds"))
    implied = ticket_implied_decimal(parent_dec, ticket_n)
    row = {
        "id": _sheet_text(leg.get("id")),
        "who": _sheet_text(leg.get("who")) or "Unknown",
        "parent": _sheet_text(leg.get("parent")),
        "gd": format_game_date(leg.get("gd")) or _sheet_text(leg.get("gd")),
        "posted": _sheet_text(leg.get("posted")),
        "sport": sport,
        "lg": _sheet_text(leg.get("lg")),
        "pick": pick,
        "leg_type": normalize_leg_type(leg.get("leg_type")),
        "stat": _sheet_text(leg.get("stat")) or "—",
        "dir": _sheet_text(leg.get("dir")),
        "ou": ou,
        "sel": _sheet_text(leg.get("sel")),
        "player": _sheet_text(leg.get("player")),
        "res": res,
        "platform": platform_bucket(parent_bt, parent_book),
        "ticket_n": ticket_n,
        "ticket_size": ticket_size_bucket(ticket_n),
        "month": month_bucket(leg.get("gd"), leg.get("posted")),
        "odds_american": odds_am,
        "ticket_implied_dec": implied,
        "parent_dec": parent_dec,
        "parent_bt": parent_bt,
    }
    row["team_type"] = team_type_label(row)
    return row


def join_legs(
    legs: Iterable[dict[str, Any]],
    bets: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Attach parent-bet context to every parlay leg (id join, not row index)."""
    parents = {_sheet_text(bet.get("id")): bet for bet in bets if bet.get("id")}
    enriched = [enrich_leg(leg, parents.get(_sheet_text(leg.get("parent")))) for leg in legs]
    by_parent: dict[str, list[dict[str, Any]]] = {}
    for row in enriched:
        if row["parent"]:
            by_parent.setdefault(row["parent"], []).append(row)
    for parent_id, group in by_parent.items():
        parent = parents.get(parent_id)
        if parent:
            assign_selection_odds(group, parent)
            for row in group:
                row["team_type"] = team_type_label(row)
    return enriched


def is_settled(res: Any) -> bool:
    return is_graded(normalize_result(res))


def settled_legs(legs: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [leg for leg in legs if is_settled(leg.get("res"))]


def _units_at(dec: float, wins: int, losses: int) -> float:
    return wins * (dec - 1.0) - losses


def bucket_record(rows: Iterable[dict[str, Any]], *, assumed: float | None = None) -> dict[str, Any]:
    """W-L-P, hit %, flat tail / fade at the assumed price (default −110)."""
    dec = assumed if assumed is not None else assumed_decimal()
    wins = losses = pushes = 0
    known = 0
    pl_known = 0.0
    be_sum = 0.0
    ti_n = 0
    ti_wins = 0
    ti_pl = 0.0
    ti_be = 0.0
    for row in rows:
        res = normalize_result(row.get("res"))
        if res == "W":
            wins += 1
        elif res == "L":
            losses += 1
        elif res == "Push":
            pushes += 1
        else:
            continue
        am = row.get("odds_american")
        if res in {"W", "L"} and isinstance(am, (int, float)):
            priced = american_to_decimal(float(am))
            if priced is not None:
                known += 1
                be_sum += 1.0 / priced
                pl_known += (priced - 1.0) if res == "W" else -1.0
        implied = row.get("ticket_implied_dec")
        if res in {"W", "L"} and isinstance(implied, (int, float)) and implied > 1:
            ti_n += 1
            ti_be += 1.0 / float(implied)
            ti_pl += (float(implied) - 1.0) if res == "W" else -1.0
            if res == "W":
                ti_wins += 1
    decided = wins + losses
    hit = _ratio(float(wins), float(decided))
    tail = _units_at(dec, wins, losses)
    fade = _units_at(dec, losses, wins)
    be = 1.0 / dec if dec else None
    small = decided < SMALL_SAMPLE
    signal = "small_sample"
    if not small and hit is not None and be is not None:
        if hit >= be + 0.03:
            signal = "tail"
        elif hit < be:
            signal = "avoid"
        else:
            signal = "marginal"
    return {
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "n": decided,
        "record": f"{wins}-{losses}-{pushes}",
        "hit": hit,
        "tail_110": tail,
        "fade_110": fade,
        "small_sample": small,
        "signal": signal,
        "known_odds": known,
        "pl_known": pl_known if known else None,
        "be_known": (be_sum / known) if known else None,
        "ticket_implied_n": ti_n,
        "ticket_implied_wins": ti_wins,
        "ticket_implied_pl": ti_pl if ti_n else None,
        "ticket_implied_be": (ti_be / ti_n) if ti_n else None,
        "ticket_implied_tail_110": _units_at(dec, ti_wins, ti_n - ti_wins) if ti_n else None,
    }


def group_buckets(
    rows: Iterable[dict[str, Any]],
    key_fn: Callable[[dict[str, Any]], str],
    *,
    order: Iterable[str] | None = None,
    min_n: int | None = None,
) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        key = key_fn(row)
        if not key:
            continue
        groups.setdefault(key, []).append(row)
    if order:
        keys = [key for key in order if key in groups]
        keys.extend(sorted((key for key in groups if key not in set(order)), key=str))
    else:
        keys = sorted(groups, key=lambda k: (-len(groups[k]), k))
    out: list[dict[str, Any]] = []
    leftover: list[dict[str, Any]] = []
    for key in keys:
        items = groups[key]
        rec = bucket_record(items)
        if min_n is not None and rec["n"] < min_n:
            leftover.extend(items)
            continue
        out.append({"key": key, **rec})
    if leftover:
        rec = bucket_record(leftover)
        out.append({"key": f"Other (each under {min_n} legs)", **rec})
    return out


def _slim_leg(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "who": row.get("who"),
        "parent": row.get("parent"),
        "gd": row.get("gd"),
        "sport": row.get("sport"),
        "pick": row.get("pick"),
        "leg_type": row.get("leg_type"),
        "stat": row.get("stat"),
        "ou": row.get("ou"),
        "sel": row.get("sel"),
        "res": row.get("res"),
        "platform": row.get("platform"),
        "ticket_n": row.get("ticket_n"),
        "ticket_size": row.get("ticket_size"),
        "month": row.get("month"),
        "odds_american": row.get("odds_american"),
        "ticket_implied_dec": row.get("ticket_implied_dec"),
        "team_type": row.get("team_type"),
    }


def build_view(rows: list[dict[str, Any]], who: str) -> dict[str, Any]:
    overall = bucket_record(rows)
    props = [row for row in rows if row.get("pick") == "Player prop"]
    teams = [row for row in rows if row.get("pick") == "Team pick"]
    ml = [row for row in teams if row.get("leg_type") == "Moneyline"]
    return {
        "who": who,
        "hypothetical_1u": is_hypothetical_1u(who) if who != ALL_WHO else False,
        "overall": overall,
        "ml": bucket_record(ml) if ml else None,
        "splits": {
            "sport": group_buckets(rows, lambda r: _as_text(r.get("sport")) or "Other"),
            "pick_group": group_buckets(
                rows,
                lambda r: _as_text(r.get("pick")) or "—",
                order=("Team pick", "Player prop"),
            ),
            "direction": group_buckets(
                props,
                lambda r: _as_text(r.get("ou")) or "Other",
                order=("Over", "Under"),
            ),
            "stat": group_buckets(props, lambda r: _as_text(r.get("stat")) or "—"),
            "platform": group_buckets(rows, lambda r: _as_text(r.get("platform")) or "Other"),
            "ticket_size": group_buckets(
                rows,
                lambda r: _as_text(r.get("ticket_size")) or "Unknown",
                order=SIZE_ORDER,
            ),
            "month": group_buckets(
                rows,
                lambda r: _as_text(r.get("month")) or "Unknown",
                order=MONTH_ORDER,
            ),
            "leg_type": group_buckets(
                teams,
                lambda r: _as_text(r.get("team_type")) or "Other",
            ),
        },
    }


def filter_tailing_legs(
    legs: Iterable[dict[str, Any]],
    *,
    who: str | None = None,
    sport: str | None = None,
    pick: str | None = None,
    platform: str | None = None,
    size: str | None = None,
    month: str | None = None,
    ou: str | None = None,
) -> list[dict[str, Any]]:
    sport_key = _norm_key(sport) if sport else ""
    pick_key = _norm_key(pick) if pick else ""
    plat_key = _norm_key(platform) if platform else ""
    size_key = _norm_key(size) if size else ""
    month_key = _norm_key(month) if month else ""
    ou_key = _norm_key(ou) if ou else ""
    out: list[dict[str, Any]] = []
    for row in legs:
        if who and who != ALL_WHO and row.get("who") != who:
            continue
        if sport_key and _norm_key(row.get("sport")) != sport_key:
            continue
        if pick_key and _norm_key(row.get("pick")) != pick_key:
            continue
        if plat_key and _norm_key(row.get("platform")) != plat_key:
            continue
        if size_key and _norm_key(row.get("ticket_size")) != size_key:
            continue
        if month_key and _norm_key(row.get("month")) != month_key:
            continue
        if ou_key and _norm_key(row.get("ou")) != ou_key:
            continue
        out.append(row)
    return out


def build_tailing_document(
    legs: list[dict[str, Any]],
    bets: list[dict[str, Any]] | None = None,
    *,
    synced_at: str | None = None,
    source: str = "sheet",
    sheet_id: str = DEFAULT_SHEET_ID,
) -> dict[str, Any]:
    joined = join_legs(legs, bets or [])
    settled = settled_legs(joined)
    stamp = synced_at or datetime.now(timezone.utc).isoformat()
    names = unique_bettors(settled)
    views = [build_view(settled, ALL_WHO)]
    for who in names:
        views.append(build_view([row for row in settled if row.get("who") == who], who))
    slim = sorted(
        (_slim_leg(row) for row in settled),
        key=lambda r: (r.get("gd") or "", r.get("id") or ""),
        reverse=True,
    )
    return {
        "synced_at": stamp,
        "source": source,
        "sheet_id": sheet_id,
        "tab": PARLAY_TAB,
        "joined_tab": "Bets",
        "leg_count": len(joined),
        "settled_count": len(settled),
        "small_sample": SMALL_SAMPLE,
        "assumed_odds": ASSUMED_AMERICAN,
        "breakeven": assumed_breakeven(),
        "odds_note": ODDS_NOTE,
        "views": views,
        "bettors": names,
        "legs": slim,
    }
