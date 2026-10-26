"""Beta-Bayesian per-signal weights + a weekly plain-English note."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sj.bot import BOT_KIND_PREFIX, SCHEMA_VERSION, SIGNAL_LABELS
from sj.bot.signals import DECAY, default_weights, normalize_weights


def update_weights(
    weights: dict[str, dict[str, Any]],
    pick: dict[str, Any],
    *,
    decay: bool = False,
) -> dict[str, dict[str, Any]]:
    """Update alphas/betas from one graded pick.

    A signal that supported the pick (value > 0) gets alpha on a win and
    beta on a loss. A signal that opposed it is inverted. Near-zero values
    are skipped so unused signals stay at the prior.
    """
    result = str(pick.get("result") or "").upper()
    if result not in {"W", "L"}:
        return weights
    win = result == "W"
    next_w = {sid: dict(row) for sid, row in normalize_weights({"signals": weights}).items()}
    if decay:
        for row in next_w.values():
            row["alpha"] = max(0.5, float(row["alpha"]) * DECAY)
            row["beta"] = max(0.5, float(row["beta"]) * DECAY)
    for sig in pick.get("signals") or []:
        if not isinstance(sig, dict):
            continue
        sid = str(sig.get("id") or "")
        if sid not in next_w:
            continue
        value = float(sig.get("value") or 0)
        if abs(value) < 0.05:
            continue
        supported = value > 0
        row = next_w[sid]
        if (supported and win) or (not supported and not win):
            row["alpha"] = float(row["alpha"]) + 1.0
            row["hits"] = int(row.get("hits") or 0) + 1
        else:
            row["beta"] = float(row["beta"]) + 1.0
            row["misses"] = int(row.get("misses") or 0) + 1
        row["weight"] = float(row["alpha"]) / (float(row["alpha"]) + float(row["beta"]))
    return next_w


def update_scorecard(scorecard: dict[str, Any], pick: dict[str, Any]) -> dict[str, Any]:
    result = str(pick.get("result") or "").upper()
    if result not in {"W", "L", "P"}:
        return scorecard
    sport = str(pick.get("sport") or "")
    market = str(pick.get("market") or "")
    rows = [dict(r) for r in (scorecard.get("rows") or []) if isinstance(r, dict)]
    row = None
    for item in rows:
        if item.get("sport") == sport and item.get("market") == market:
            row = item
            break
    if row is None:
        row = {
            "sport": sport,
            "market": market,
            "wins": 0,
            "losses": 0,
            "pushes": 0,
            "n": 0,
            "avg_clv": 0.0,
            "clv_n": 0,
        }
        rows.append(row)
    if result == "W":
        row["wins"] = int(row.get("wins") or 0) + 1
    elif result == "L":
        row["losses"] = int(row.get("losses") or 0) + 1
    else:
        row["pushes"] = int(row.get("pushes") or 0) + 1
    row["n"] = int(row.get("wins") or 0) + int(row.get("losses") or 0) + int(row.get("pushes") or 0)
    clv = pick.get("clv")
    if isinstance(clv, (int, float)):
        prev_n = int(row.get("clv_n") or 0)
        prev = float(row.get("avg_clv") or 0)
        row["avg_clv"] = round((prev * prev_n + float(clv)) / (prev_n + 1), 4)
        row["clv_n"] = prev_n + 1
    return {"rows": rows}


def weights_document(weights: dict[str, dict[str, Any]], *, simulated: bool) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_weights",
        "simulated": simulated,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "signals": normalize_weights({"signals": weights}),
    }


def note_document(
    *,
    week: str,
    before: dict[str, dict[str, Any]],
    after: dict[str, dict[str, Any]],
    graded: int,
    simulated: bool,
) -> dict[str, Any]:
    changes = []
    lines = []
    for sid in SIGNAL_LABELS:
        old = float((before.get(sid) or {}).get("weight") or 0.5)
        new = float((after.get(sid) or {}).get("weight") or 0.5)
        delta = new - old
        if abs(delta) < 0.005:
            continue
        direction = "more" if delta > 0 else "less"
        label = SIGNAL_LABELS[sid]
        changes.append(
            {
                "signal": sid,
                "label": label,
                "from": round(old, 4),
                "to": round(new, 4),
                "delta": round(delta, 4),
            }
        )
        lines.append(
            f"{label} now carries {new:.0%} of the vote "
            f"({direction} than last week's {old:.0%})."
        )
    if not lines:
        body = (
            f"Week {week}: graded {graded} paper bet"
            f"{'' if graded == 1 else 's'}. Signal weights held steady."
        )
    else:
        body = (
            f"Week {week}: graded {graded} paper bet"
            f"{'' if graded == 1 else 's'}. " + " ".join(lines)
        )
    note = {
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_note",
        "simulated": simulated,
        "week": week,
        "title": "What I learned",
        "body": body,
        "changes": changes,
        "written_at": datetime.now(timezone.utc).isoformat(),
    }
    note["markdown"] = note_markdown(note)
    return note


def note_markdown(note: dict[str, Any]) -> str:
    lines = [
        f"# {note.get('title') or 'What I learned'}",
        "",
        f"Week {note.get('week')}",
        "",
        str(note.get("body") or ""),
        "",
    ]
    changes = note.get("changes") or []
    if changes:
        lines.append("| Signal | From | To |")
        lines.append("|---|---|---|")
        for row in changes:
            lines.append(
                f"| {row.get('label')} | {float(row.get('from') or 0):.0%} "
                f"| {float(row.get('to') or 0):.0%} |"
            )
            lines.append("")
    if note.get("simulated"):
        lines.append("_Sample / simulated data. Not live paper results._")
        lines.append("")
    return "\n".join(lines)


def iso_week(dt: datetime | None = None) -> str:
    when = dt or datetime.now(timezone.utc)
    iso = when.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def empty_scorecard() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_scorecard",
        "rows": [],
    }


def empty_weights(*, simulated: bool = False) -> dict[str, Any]:
    return weights_document(default_weights(), simulated=simulated)
