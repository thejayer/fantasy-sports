"""Explainable learning signals. Each returns a value in [-1, 1] plus a note."""

from __future__ import annotations

from typing import Any

from sj.bot import SIGNAL_IDS, SIGNAL_LABELS

PRIOR_ALPHA = 4.0
PRIOR_BETA = 4.0
DECAY = 0.97


def default_weights() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for sid in SIGNAL_IDS:
        out[sid] = {
            "id": sid,
            "label": SIGNAL_LABELS[sid],
            "alpha": PRIOR_ALPHA,
            "beta": PRIOR_BETA,
            "weight": PRIOR_ALPHA / (PRIOR_ALPHA + PRIOR_BETA),
            "hits": 0,
            "misses": 0,
        }
    return out


def normalize_weights(doc: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    base = default_weights()
    incoming = (doc or {}).get("signals") if isinstance(doc, dict) else None
    if not isinstance(incoming, dict):
        return base
    for sid, row in incoming.items():
        if sid not in base or not isinstance(row, dict):
            continue
        alpha = _num(row.get("alpha"), PRIOR_ALPHA)
        beta = _num(row.get("beta"), PRIOR_BETA)
        alpha = max(0.5, alpha)
        beta = max(0.5, beta)
        base[sid] = {
            "id": sid,
            "label": SIGNAL_LABELS.get(sid, sid),
            "alpha": alpha,
            "beta": beta,
            "weight": alpha / (alpha + beta),
            "hits": int(row.get("hits") or 0),
            "misses": int(row.get("misses") or 0),
        }
    return base


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clip(value: float) -> float:
    return max(-1.0, min(1.0, value))


def line_move_value(open_line: float | None, current_line: float | None) -> tuple[float, str]:
    """Steam toward this side is positive (we got a worse number → money arrived)."""
    if open_line is None or current_line is None:
        return 0.0, "no open/current line to compare"
    delta = current_line - open_line
    # Favorite got shorter (e.g. -3 → -4.5): current more negative, delta < 0.
    # For the side we are evaluating, ``current_line`` is already that side's number.
    # Money onto this side makes the number worse for us (favorite lays more,
    # dog gets fewer points). That is a negative delta for this side's line.
    if abs(delta) < 0.25:
        return 0.0, f"line unchanged ({current_line:+g})"
    # Steam onto this side: line moved against us.
    steam = -delta
    value = _clip(steam / 3.0)
    direction = "toward" if value > 0 else "away from"
    return value, f"opened {open_line:+g}, now {current_line:+g} ({direction} this side)"


def clv_hist_value(scorecard: dict[str, Any], sport: str, market: str) -> tuple[float, str]:
    row = _scorecard_row(scorecard, sport, market)
    avg = _num(row.get("avg_clv"), 0.0) if row else 0.0
    n = int(row.get("n") or 0) if row else 0
    if n < 3:
        return 0.0, "not enough of our own CLV yet"
    return _clip(avg / 1.5), f"own {sport} {market} CLV avg {avg:+.2f} over {n}"


def group_hot_value(
    splits: dict[str, Any] | None, sport: str, market: str
) -> tuple[float, str]:
    """Who's hot by sport / kind from record_splits. Never names a person."""
    if not splits:
        return 0.0, "no record_splits sidecar"
    kind = _market_kind(market)
    rows = list(splits.get("sports") or []) + list(splits.get("splits") or [])
    best: dict[str, Any] | None = None
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("who") or "") != "*":
            continue
        row_sport = str(row.get("sport") or "").upper()
        if row_sport and row_sport != sport.upper():
            continue
        row_kind = str(row.get("kind") or "")
        if kind and row_kind not in {kind, ""} and not row_sport:
            continue
        wins = int(row.get("wins") or 0)
        losses = int(row.get("losses") or 0)
        if wins + losses < 4:
            continue
        if best is None or wins + losses > int(best.get("wins") or 0) + int(best.get("losses") or 0):
            best = row
    if not best:
        # Fall back to all-sport * row for this kind.
        for row in splits.get("splits") or []:
            if isinstance(row, dict) and row.get("who") == "*" and row.get("kind") == kind:
                best = row
                break
    if not best:
        return 0.0, "no group split for this market"
    wins = int(best.get("wins") or 0)
    losses = int(best.get("losses") or 0)
    n = wins + losses
    if n < 4:
        return 0.0, f"group sample too small ({n})"
    rate = wins / n
    value = _clip((rate - 0.5) / 0.2)
    return value, f"group {sport} {kind or 'all'} is {wins}-{losses} ({rate:.0%})"


def tail_fade_values(tailing: dict[str, Any] | None, sport: str) -> dict[str, tuple[float, str]]:
    empty = {
        "tail": (0.0, "no tailing_legs sidecar"),
        "fade": (0.0, "no tailing_legs sidecar"),
    }
    if not tailing:
        return empty
    view = None
    for row in tailing.get("views") or []:
        if isinstance(row, dict) and row.get("who") == "*":
            view = row
            break
    if not view:
        return empty
    bucket = view.get("overall") if isinstance(view.get("overall"), dict) else {}
    for split in (view.get("splits") or {}).get("sport") or []:
        if isinstance(split, dict) and str(split.get("key") or "").upper() == sport.upper():
            bucket = split
            break
    tail_pl = _num(bucket.get("tail_110"), 0.0)
    fade_pl = _num(bucket.get("fade_110"), 0.0)
    n = int(bucket.get("n") or 0)
    if n < 4:
        note = f"tail sample too small ({n})"
        return {"tail": (0.0, note), "fade": (0.0, note)}
    tail_v = _clip(tail_pl / 5.0)
    fade_v = _clip(fade_pl / 5.0)
    return {
        "tail": (tail_v, f"tail @ −110 is {tail_pl:+.1f}u over {n} legs"),
        "fade": (fade_v, f"fade @ −110 is {fade_pl:+.1f}u over {n} legs"),
    }


def own_form_value(scorecard: dict[str, Any], sport: str, market: str) -> tuple[float, str]:
    row = _scorecard_row(scorecard, sport, market)
    if not row:
        return 0.0, "no graded bets for this sport/market yet"
    wins = int(row.get("wins") or 0)
    losses = int(row.get("losses") or 0)
    n = wins + losses
    if n < 3:
        return 0.0, f"own {sport} {market} sample is {n}"
    rate = wins / n
    return _clip((rate - 0.5) / 0.2), f"own {sport} {market} is {wins}-{losses}"


def team_form_value(
    game: dict[str, Any], market: str, side: str
) -> tuple[float, str]:
    away = game.get("away") or {}
    home = game.get("home") or {}
    if market == "total":
        combined = _combined_win_rate(away, home)
        if combined is None:
            return 0.0, "no team records for the total"
        # Winning teams slightly lean over in this toy model.
        value = _clip((combined - 0.5) / 0.25)
        label = "Over" if side == "over" else "Under"
        signed = value if side == "over" else -value
        return signed, f"{label}: combined win rate {combined:.0%}"
    chosen = away if side == "away" else home
    other = home if side == "away" else away
    c_rate = _win_rate(chosen)
    o_rate = _win_rate(other)
    if c_rate is None or o_rate is None:
        return 0.0, "missing team records"
    value = _clip((c_rate - o_rate) / 0.4)
    name = chosen.get("abbr") or chosen.get("name") or side
    return value, f"{name} {c_rate:.0%} vs opp {o_rate:.0%}"


def evaluate_signals(
    *,
    game: dict[str, Any],
    market: str,
    side: str,
    open_line: float | None,
    current_line: float | None,
    american: float | None,
    weights: dict[str, dict[str, Any]],
    scorecard: dict[str, Any],
    splits: dict[str, Any] | None,
    tailing: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    sport = str(game.get("sport") or "")
    tf = tail_fade_values(tailing, sport)
    pairs: list[tuple[str, tuple[float, str]]] = [
        ("line_move", line_move_value(open_line, current_line)),
        ("clv", clv_hist_value(scorecard, sport, market)),
        ("group_hot", group_hot_value(splits, sport, market)),
        ("tail", tf["tail"]),
        ("fade", tf["fade"]),
        ("own_form", own_form_value(scorecard, sport, market)),
        ("team_form", team_form_value(game, market, side)),
    ]
    # Tail and fade are opposites — keep the historically stronger one,
    # zero the other so we do not double-count the group.
    tail_w = _num((weights.get("tail") or {}).get("weight"), 0.5)
    fade_w = _num((weights.get("fade") or {}).get("weight"), 0.5)
    out: list[dict[str, Any]] = []
    for sid, (value, note) in pairs:
        weight = _num((weights.get(sid) or {}).get("weight"), 0.5)
        adj = value
        if sid == "tail" and fade_w > tail_w:
            adj = 0.0
            note = f"{note} (fade weight leads, tail parked)"
        if sid == "fade" and tail_w >= fade_w:
            adj = 0.0
            note = f"{note} (tail weight leads, fade parked)"
        out.append(
            {
                "id": sid,
                "label": SIGNAL_LABELS[sid],
                "weight": round(weight, 4),
                "value": round(adj, 4),
                "note": note,
            }
        )
    return out


def blended_score(signals: list[dict[str, Any]]) -> float:
    num = 0.0
    den = 0.0
    for row in signals:
        w = _num(row.get("weight"))
        num += w * _num(row.get("value"))
        den += w
    if den <= 0:
        return 0.0
    return _clip(num / den)


def _market_kind(market: str) -> str:
    if market in {"spread", "ml"}:
        return "single_team"
    if market == "total":
        return "single_team"
    return ""


def _scorecard_row(scorecard: dict[str, Any], sport: str, market: str) -> dict[str, Any] | None:
    rows = scorecard.get("rows") if isinstance(scorecard, dict) else None
    if not isinstance(rows, list):
        return None
    for row in rows:
        if (
            isinstance(row, dict)
            and str(row.get("sport") or "").upper() == sport.upper()
            and str(row.get("market") or "") == market
        ):
            return row
    return None


def _win_rate(team: dict[str, Any]) -> float | None:
    rec = team.get("record") if isinstance(team.get("record"), dict) else None
    if not rec:
        return None
    wins = int(rec.get("wins") or 0)
    losses = int(rec.get("losses") or 0)
    n = wins + losses
    if n <= 0:
        return None
    return wins / n


def _combined_win_rate(away: dict[str, Any], home: dict[str, Any]) -> float | None:
    rates = [r for r in (_win_rate(away), _win_rate(home)) if r is not None]
    if not rates:
        return None
    return sum(rates) / len(rates)
