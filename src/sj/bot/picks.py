"""Turn today's slate + signals into 3–8 paper bets."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sj.bot import BOT_WHO, MAX_PICKS, MIN_PICKS, env_int
from sj.bot.signals import blended_score, evaluate_signals
from sj.bot.staking import StakeConfig, score_to_p_win, stake_units

SCORE_FLOOR = 0.08


def _open_line(history: list[dict[str, Any]], game_id: str, market: str, side: str) -> float | None:
    for snap in history:
        for game in snap.get("games") or []:
            if not isinstance(game, dict) or str(game.get("id") or "") != game_id:
                continue
            for row in game.get("markets") or []:
                if (
                    isinstance(row, dict)
                    and row.get("type") == market
                    and row.get("side") == side
                    and row.get("line") is not None
                ):
                    try:
                        return float(row["line"])
                    except (TypeError, ValueError):
                        return None
    return None


def candidate_from_market(
    game: dict[str, Any],
    market_row: dict[str, Any],
    *,
    history: list[dict[str, Any]],
    weights: dict[str, dict[str, Any]],
    scorecard: dict[str, Any],
    splits: dict[str, Any] | None,
    tailing: dict[str, Any] | None,
    stake: StakeConfig,
) -> dict[str, Any] | None:
    if str((game.get("status") or {}).get("state") or "") != "pre":
        return None
    market = str(market_row.get("type") or "")
    side = str(market_row.get("side") or "")
    american = market_row.get("american")
    if not market or not side or american is None:
        return None
    current_line = market_row.get("line")
    try:
        current_f = float(current_line) if current_line is not None else None
    except (TypeError, ValueError):
        current_f = None
    opened = _open_line(history, str(game.get("id") or ""), market, side)
    signals = evaluate_signals(
        game=game,
        market=market,
        side=side,
        open_line=opened,
        current_line=current_f,
        american=american,
        weights=weights,
        scorecard=scorecard,
        splits=splits,
        tailing=tailing,
    )
    score = blended_score(signals)
    if score < SCORE_FLOOR:
        return None
    p_win = score_to_p_win(score, american)
    units = stake_units(stake, american, p_win)
    if units <= 0:
        return None
    drivers = sorted(signals, key=lambda row: abs(float(row.get("value") or 0)), reverse=True)
    top = [row for row in drivers if abs(float(row.get("value") or 0)) >= 0.05][:3]
    reason = _reason(game, market_row, score, top)
    return {
        "sport": game.get("sport"),
        "market": market,
        "side": side,
        "selection": market_row.get("selection"),
        "game_id": game.get("id"),
        "start": game.get("start"),
        "away": (game.get("away") or {}).get("abbr"),
        "home": (game.get("home") or {}).get("abbr"),
        "american": int(american),
        "line": current_f,
        "open_line": opened,
        "units": units,
        "p_win": round(p_win, 4),
        "score": round(score, 4),
        "reason": reason,
        "signals": signals,
        "book": market_row.get("book") or "ESPN BET",
    }


def propose_picks(
    games: list[dict[str, Any]],
    *,
    history: list[dict[str, Any]],
    weights: dict[str, dict[str, Any]],
    scorecard: dict[str, Any],
    splits: dict[str, Any] | None,
    tailing: dict[str, Any] | None,
    stake: StakeConfig,
    existing_ids: set[str] | None = None,
    min_picks: int | None = None,
    max_picks: int | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    lo = min_picks if min_picks is not None else env_int("SJ_BOT_MIN_PICKS", MIN_PICKS)
    hi = max_picks if max_picks is not None else env_int("SJ_BOT_MAX_PICKS", MAX_PICKS)
    hi = max(lo, hi)
    seen_game_market: set[tuple[str, str]] = set()
    ranked: list[dict[str, Any]] = []
    for game in games:
        if not isinstance(game, dict):
            continue
        for market_row in game.get("markets") or []:
            if not isinstance(market_row, dict):
                continue
            cand = candidate_from_market(
                game,
                market_row,
                history=history,
                weights=weights,
                scorecard=scorecard,
                splits=splits,
                tailing=tailing,
                stake=stake,
            )
            if cand:
                ranked.append(cand)
    ranked.sort(key=lambda row: float(row.get("score") or 0), reverse=True)
    picked: list[dict[str, Any]] = []
    sports_used: dict[str, int] = {}
    placed = now or datetime.now(timezone.utc)
    day = placed.strftime("%Y%m%d")
    seq = 1
    existing = existing_ids or set()
    for cand in ranked:
        key = (str(cand.get("game_id") or ""), str(cand.get("market") or ""))
        if key in seen_game_market:
            continue
        sport = str(cand.get("sport") or "")
        if sports_used.get(sport, 0) >= 4 and len(picked) >= lo:
            continue
        pick_id = f"BOT-{day}-{seq}"
        while pick_id in existing:
            seq += 1
            pick_id = f"BOT-{day}-{seq}"
        cand = {
            **cand,
            "id": pick_id,
            "who": BOT_WHO,
            "placed_at": placed.isoformat(),
            "result": "Pending",
            "units_pl": None,
            "clv": None,
            "closing_line": None,
            "closing_american": None,
        }
        picked.append(cand)
        seen_game_market.add(key)
        sports_used[sport] = sports_used.get(sport, 0) + 1
        existing.add(pick_id)
        seq += 1
        if len(picked) >= hi:
            break
    return picked


def _reason(
    game: dict[str, Any],
    market_row: dict[str, Any],
    score: float,
    top: list[dict[str, Any]],
) -> str:
    sel = market_row.get("selection") or "this side"
    sport = game.get("sport") or "the slate"
    if not top:
        return f"Paper {sel} on the {sport} board — blended score {score:.2f}."
    bits = []
    for row in top:
        label = row.get("label") or row.get("id")
        note = row.get("note") or ""
        bits.append(f"{label} ({note})" if note else str(label))
    return f"Paper {sel}: " + "; ".join(bits) + "."
