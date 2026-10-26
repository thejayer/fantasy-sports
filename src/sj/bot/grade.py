"""Grade paper bets from final scores and compute CLV vs the last pre-kick line."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sj.bets import american_to_decimal
from sj.bot.odds import implied_prob


def parse_iso(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def grade_result(
    *,
    market: str,
    side: str,
    line: float | None,
    away_score: float | None,
    home_score: float | None,
) -> str:
    """Return W / L / P. Caller must only invoke this on a final game."""
    if away_score is None or home_score is None:
        return "Pending"
    away = float(away_score)
    home = float(home_score)
    if market == "ml":
        if away == home:
            return "P"
        winner = "away" if away > home else "home"
        return "W" if side == winner else "L"
    if market == "total":
        if line is None:
            return "Pending"
        total = away + home
        if total == line:
            return "P"
        went_over = total > line
        if side == "over":
            return "W" if went_over else "L"
        return "W" if not went_over else "L"
    if market == "spread":
        if line is None:
            return "Pending"
        selected = away if side == "away" else home
        other = home if side == "away" else away
        margin = selected - other
        cover_by = margin + line
        if cover_by == 0:
            return "P"
        return "W" if cover_by > 0 else "L"
    return "Pending"


def units_pl(result: str, units: float, american: float | None) -> float | None:
    key = (result or "").strip().upper()
    if key == "P":
        return 0.0
    if key == "L":
        return -float(units)
    if key != "W":
        return None
    dec = american_to_decimal(float(american)) if american is not None else None
    if dec is None:
        return None
    return round(float(units) * (dec - 1.0), 4)


def spread_clv(our_line: float, close_line: float) -> float:
    """Positive when we got a better number on the same side."""
    return round(our_line - close_line, 4)


def total_clv(side: str, our_line: float, close_line: float) -> float:
    if side == "over":
        return round(close_line - our_line, 4)
    return round(our_line - close_line, 4)


def ml_clv(our_american: float, close_american: float) -> float | None:
    ours = implied_prob(our_american)
    close = implied_prob(close_american)
    if ours is None or close is None:
        return None
    return round(close - ours, 6)


def closing_market(
    snapshots: list[dict[str, Any]],
    *,
    game_id: str,
    market: str,
    side: str,
    kickoff: str | None,
) -> dict[str, Any] | None:
    """Last snapshot captured strictly before kickoff that still has this market."""
    kick = parse_iso(kickoff)
    best: tuple[datetime, dict[str, Any]] | None = None
    for snap in snapshots:
        captured = parse_iso(snap.get("captured_at"))
        if captured is None:
            continue
        if kick and captured >= kick:
            continue
        game = _game(snap, game_id)
        if not game:
            continue
        row = _market(game, market, side)
        if not row:
            continue
        if best is None or captured > best[0]:
            best = (captured, row)
    return best[1] if best else None


def compute_clv(
    pick: dict[str, Any],
    close: dict[str, Any] | None,
) -> dict[str, Any]:
    if not close:
        return {"clv": None, "closing_line": None, "closing_american": None}
    market = str(pick.get("market") or "")
    side = str(pick.get("side") or "")
    our_line = pick.get("line")
    close_line = close.get("line")
    our_amer = pick.get("american")
    close_amer = close.get("american")
    clv: float | None = None
    try:
        if market == "spread" and our_line is not None and close_line is not None:
            clv = spread_clv(float(our_line), float(close_line))
        elif market == "total" and our_line is not None and close_line is not None:
            clv = total_clv(side, float(our_line), float(close_line))
        elif market == "ml" and our_amer is not None and close_amer is not None:
            clv = ml_clv(our_amer, close_amer)
    except (TypeError, ValueError):
        clv = None
    return {
        "clv": clv,
        "closing_line": close_line,
        "closing_american": close_amer,
    }


def apply_grade(pick: dict[str, Any], result: str, close: dict[str, Any] | None) -> dict[str, Any]:
    updated = dict(pick)
    updated["result"] = result
    updated["units_pl"] = units_pl(result, float(pick.get("units") or 0), pick.get("american"))
    updated.update(compute_clv(pick, close))
    updated["graded_at"] = datetime.now(timezone.utc).isoformat()
    return updated


def _game(snap: dict[str, Any], game_id: str) -> dict[str, Any] | None:
    for game in snap.get("games") or []:
        if isinstance(game, dict) and str(game.get("id") or "") == game_id:
            return game
    return None


def _market(game: dict[str, Any], market: str, side: str) -> dict[str, Any] | None:
    for row in game.get("markets") or []:
        if isinstance(row, dict) and row.get("type") == market and row.get("side") == side:
            return row
    return None
