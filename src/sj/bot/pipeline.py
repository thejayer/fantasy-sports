"""Snapshot / pick / grade / learn / board. Called from ``sj bot`` and ``sj bets``."""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from sj.bot import (
    BOT_KIND_PREFIX,
    BOT_WHO,
    SCHEMA_VERSION,
    SPORTS,
    env_float,
)
from sj.bot.grade import apply_grade, closing_market, grade_result, parse_iso
from sj.bot.learn import (
    empty_scorecard,
    empty_weights,
    iso_week,
    note_document,
    update_scorecard,
    update_weights,
    weights_document,
)
from sj.bot.odds import (
    EspnOddsProvider,
    OddsProvider,
    parse_espn_scoreboard,
    stamp_for,
    utcnow,
)
from sj.bot.paths import (
    BANKROLL,
    BOARD,
    LINES_INDEX,
    NOTE_LATEST,
    PICKS,
    SCORECARD,
    WEIGHTS,
    read_named,
    write_lines_snapshot,
    write_named,
    write_note_week,
)
from sj.bot.picks import propose_picks
from sj.bot.signals import normalize_weights
from sj.bot.staking import StakeConfig
from sj.store import read_bets

CHICAGO = ZoneInfo("America/Chicago")
MAX_LINE_HISTORY = 90


def slate_date(now: datetime | None = None) -> date:
    when = now or datetime.now(CHICAGO)
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc).astimezone(CHICAGO)
    else:
        when = when.astimezone(CHICAGO)
    return when.date()


def snapshot_lines(
    *,
    store_dir: Path | str | None = None,
    provider: OddsProvider | None = None,
    day: date | None = None,
    now: datetime | None = None,
    sports: tuple[str, ...] = SPORTS,
    simulated: bool = False,
) -> dict[str, Any]:
    feed = provider or EspnOddsProvider()
    when = now or utcnow()
    day = day or slate_date(when)
    games: list[dict[str, Any]] = []
    errors: list[str] = []
    for sport in sports:
        try:
            payload = feed.scoreboard(sport, day)
            games.extend(parse_espn_scoreboard(payload, sport))
        except Exception as exc:  # noqa: BLE001 — one sport must not kill the others
            errors.append(f"{sport}: {exc}")
    stamp = stamp_for(when)
    document = {
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_lines",
        "simulated": simulated,
        "captured_at": when.isoformat(),
        "slate_date": day.isoformat(),
        "source": getattr(feed, "name", "odds"),
        "sports": list(sports),
        "game_count": len(games),
        "games": games,
        "errors": errors,
    }
    write_lines_snapshot(document, stamp, store_dir=store_dir)
    write_named(document, "bot/lines/latest", store_dir=store_dir)
    index = read_named(LINES_INDEX, store_dir=store_dir) or {
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_lines_index",
        "stamps": [],
    }
    stamps = [s for s in (index.get("stamps") or []) if s != stamp]
    stamps.append(stamp)
    stamps = stamps[-MAX_LINE_HISTORY:]
    index.update({"stamps": stamps, "latest": stamp, "simulated": simulated})
    write_named(index, LINES_INDEX, store_dir=store_dir)
    return document


def load_line_history(store_dir: Path | str | None = None) -> list[dict[str, Any]]:
    index = read_named(LINES_INDEX, store_dir=store_dir) or {}
    snaps: list[dict[str, Any]] = []
    for stamp in index.get("stamps") or []:
        row = read_named(f"bot/lines/{stamp}", store_dir=store_dir)
        if row:
            snaps.append(row)
    latest = read_named("bot/lines/latest", store_dir=store_dir)
    if latest and latest not in snaps:
        snaps.append(latest)
    snaps.sort(key=lambda row: str(row.get("captured_at") or ""))
    return snaps


def load_picks(store_dir: Path | str | None = None) -> dict[str, Any]:
    doc = read_named(PICKS, store_dir=store_dir)
    if doc and isinstance(doc.get("picks"), list):
        return doc
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_picks",
        "who": BOT_WHO,
        "simulated": False,
        "picks": [],
    }


def _already_picked_today(picks: list[dict[str, Any]], day: date) -> bool:
    prefix = f"BOT-{day.strftime('%Y%m%d')}-"
    return any(str(p.get("id") or "").startswith(prefix) for p in picks)


def place_picks(
    *,
    store_dir: Path | str | None = None,
    stake: StakeConfig | None = None,
    now: datetime | None = None,
    force: bool = False,
) -> dict[str, Any]:
    when = now or utcnow()
    day = slate_date(when)
    history = load_line_history(store_dir=store_dir)
    latest = history[-1] if history else None
    games = list((latest or {}).get("games") or [])
    picks_doc = load_picks(store_dir=store_dir)
    existing = list(picks_doc.get("picks") or [])
    if not force and _already_picked_today(existing, day):
        return picks_doc
    weights = normalize_weights(read_named(WEIGHTS, store_dir=store_dir))
    scorecard = read_named(SCORECARD, store_dir=store_dir) or empty_scorecard()
    splits = read_bets("record_splits", store_dir=store_dir)
    tailing = read_bets("tailing_legs", store_dir=store_dir)
    cfg = stake or StakeConfig.from_env()
    cfg = StakeConfig(
        mode=cfg.mode,
        unit=cfg.unit,
        bankroll=_current_bankroll(store_dir),
        kelly_fraction=cfg.kelly_fraction,
        kelly_cap=cfg.kelly_cap,
    )
    new_picks = propose_picks(
        games,
        history=history[:-1],
        weights=weights,
        scorecard=scorecard,
        splits=splits,
        tailing=tailing,
        stake=cfg,
        existing_ids={str(p.get("id") or "") for p in existing},
        now=when,
    )
    if not new_picks:
        return picks_doc
    picks_doc = {
        **picks_doc,
        "who": BOT_WHO,
        "simulated": bool(picks_doc.get("simulated") or latest and latest.get("simulated")),
        "staking": cfg.mode,
        "updated_at": when.isoformat(),
        "picks": existing + new_picks,
    }
    write_named(picks_doc, PICKS, store_dir=store_dir)
    return picks_doc


def _game_index(games: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(g.get("id") or ""): g for g in games if isinstance(g, dict) and g.get("id")}


def grade_picks(
    *,
    store_dir: Path | str | None = None,
    provider: OddsProvider | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    when = now or utcnow()
    picks_doc = load_picks(store_dir=store_dir)
    picks = list(picks_doc.get("picks") or [])
    history = load_line_history(store_dir=store_dir)
    live_games: dict[str, dict[str, Any]] = {}
    days: set[date] = set()
    for pick in picks:
        if str(pick.get("result") or "Pending") != "Pending":
            continue
        start = parse_iso(pick.get("start"))
        if start:
            days.add(start.astimezone(CHICAGO).date())
    feed = provider or EspnOddsProvider()
    for day in sorted(days) or [slate_date(when)]:
        for sport in SPORTS:
            try:
                payload = feed.scoreboard(sport, day)
            except RuntimeError:
                payload = None
            if payload:
                for game in parse_espn_scoreboard(payload, sport):
                    live_games[str(game.get("id") or "")] = game
    for snap in history:
        live_games.update(_game_index(list(snap.get("games") or [])))

    graded_ids: list[str] = []
    updated: list[dict[str, Any]] = []
    for pick in picks:
        if str(pick.get("result") or "Pending") != "Pending":
            updated.append(pick)
            continue
        game = live_games.get(str(pick.get("game_id") or ""))
        if not game or not (game.get("status") or {}).get("completed"):
            updated.append(pick)
            continue
        away = (game.get("away") or {}).get("score")
        home = (game.get("home") or {}).get("score")
        result = grade_result(
            market=str(pick.get("market") or ""),
            side=str(pick.get("side") or ""),
            line=pick.get("line"),
            away_score=away,
            home_score=home,
        )
        if result == "Pending":
            updated.append(pick)
            continue
        close = closing_market(
            history,
            game_id=str(pick.get("game_id") or ""),
            market=str(pick.get("market") or ""),
            side=str(pick.get("side") or ""),
            kickoff=str(pick.get("start") or game.get("start") or ""),
        )
        graded = apply_grade(pick, result, close)
        updated.append(graded)
        graded_ids.append(str(graded.get("id") or ""))
    picks_doc = {**picks_doc, "picks": updated, "updated_at": when.isoformat()}
    write_named(picks_doc, PICKS, store_dir=store_dir)
    picks_doc["_newly_graded"] = graded_ids
    return picks_doc


def learn_from_results(
    *,
    store_dir: Path | str | None = None,
    newly_graded: list[str] | None = None,
    now: datetime | None = None,
    force_note: bool = False,
) -> dict[str, Any]:
    when = now or utcnow()
    picks_doc = load_picks(store_dir=store_dir)
    picks = list(picks_doc.get("picks") or [])
    weights_doc = read_named(WEIGHTS, store_dir=store_dir) or empty_weights(
        simulated=bool(picks_doc.get("simulated"))
    )
    scorecard = read_named(SCORECARD, store_dir=store_dir) or empty_scorecard()
    weights = normalize_weights(weights_doc)
    before = {sid: dict(row) for sid, row in weights.items()}
    targets = set(newly_graded or [])
    graded = 0
    first = True
    for pick in picks:
        if str(pick.get("result") or "") not in {"W", "L", "P"}:
            continue
        if targets and str(pick.get("id") or "") not in targets:
            continue
        scorecard = update_scorecard(scorecard, pick)
        if str(pick.get("result") or "") in {"W", "L"}:
            weights = update_weights(weights, pick, decay=first)
            first = False
            graded += 1
    simulated = bool(picks_doc.get("simulated") or weights_doc.get("simulated"))
    new_weights = weights_document(weights, simulated=simulated)
    scorecard = {
        **scorecard,
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_scorecard",
        "simulated": simulated,
        "updated_at": when.isoformat(),
    }
    write_named(new_weights, WEIGHTS, store_dir=store_dir)
    write_named(scorecard, SCORECARD, store_dir=store_dir)
    week = iso_week(when)
    last_note = read_named(NOTE_LATEST, store_dir=store_dir)
    should_note = force_note or graded > 0
    if last_note and last_note.get("week") == week and not force_note:
        should_note = False
    note = last_note
    if should_note:
        note = note_document(
            week=week,
            before=before,
            after=normalize_weights(new_weights),
            graded=graded,
            simulated=simulated,
        )
        write_named(note, NOTE_LATEST, store_dir=store_dir)
        write_note_week(note, week, store_dir=store_dir)
    return {"weights": new_weights, "scorecard": scorecard, "note": note, "graded": graded}


def _current_bankroll(store_dir: Path | str | None) -> float:
    doc = read_named(BANKROLL, store_dir=store_dir)
    if doc and doc.get("current") is not None:
        try:
            return float(doc["current"])
        except (TypeError, ValueError):
            pass
    return env_float("SJ_BOT_BANKROLL", 100.0)


def rebuild_bankroll(picks: list[dict[str, Any]], *, start: float) -> dict[str, Any]:
    series = [{"date": "start", "bankroll": start}]
    running = start
    by_day: dict[str, float] = {}
    for pick in sorted(picks, key=lambda row: str(row.get("graded_at") or row.get("placed_at") or "")):
        pl = pick.get("units_pl")
        if pl is None:
            continue
        running = round(running + float(pl), 4)
        day = str(pick.get("graded_at") or pick.get("placed_at") or "")[:10] or "graded"
        by_day[day] = running
    for day, value in by_day.items():
        series.append({"date": day, "bankroll": value})
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_bankroll",
        "start": start,
        "current": running,
        "series": series,
    }


def record_tuple(picks: list[dict[str, Any]]) -> tuple[int, int, int, int, float]:
    w = l = p = pending = 0
    units = 0.0
    for pick in picks:
        res = str(pick.get("result") or "Pending")
        if res == "W":
            w += 1
        elif res == "L":
            l += 1
        elif res == "P":
            p += 1
        else:
            pending += 1
        if pick.get("units_pl") is not None:
            units += float(pick["units_pl"])
    return w, l, p, pending, round(units, 4)


def build_board(*, store_dir: Path | str | None = None) -> dict[str, Any]:
    picks_doc = load_picks(store_dir=store_dir)
    picks = list(picks_doc.get("picks") or [])
    weights = normalize_weights(read_named(WEIGHTS, store_dir=store_dir))
    note = read_named(NOTE_LATEST, store_dir=store_dir)
    start = env_float("SJ_BOT_BANKROLL", 100.0)
    bankroll = rebuild_bankroll(picks, start=start)
    write_named(bankroll, BANKROLL, store_dir=store_dir)
    w, l, p, pending, units_pl = record_tuple(picks)
    open_picks = [row for row in picks if str(row.get("result") or "Pending") == "Pending"]
    graded = [row for row in picks if str(row.get("result") or "Pending") != "Pending"]
    graded.sort(key=lambda row: str(row.get("graded_at") or row.get("placed_at") or ""), reverse=True)
    simulated = bool(picks_doc.get("simulated"))
    board = {
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_board",
        "who": BOT_WHO,
        "simulated": simulated,
        "simulated_label": "Simulated sample data" if simulated else None,
        "synced_at": utcnow().isoformat(),
        "staking": picks_doc.get("staking") or StakeConfig.from_env().mode,
        "bankroll_start": start,
        "bankroll": bankroll["current"],
        "record": f"{w}-{l}-{p}",
        "wins": w,
        "losses": l,
        "pushes": p,
        "pending": pending,
        "units_pl": units_pl,
        "bankroll_series": bankroll["series"],
        "open": open_picks,
        "recent": graded[:20],
        "weights": [weights[sid] for sid in weights],
        "note": note,
        "pick_count": len(picks),
    }
    write_named(board, BOARD, store_dir=store_dir)
    return board


def run_bot(
    *,
    store_dir: Path | str | None = None,
    provider: OddsProvider | None = None,
    now: datetime | None = None,
    snapshot: bool = True,
    pick: bool = True,
    grade: bool = True,
    learn: bool = True,
    simulated: bool = False,
) -> dict[str, Any]:
    """One pass used by ``sj bot run`` and as a post-step of ``sj bets``."""
    out: dict[str, Any] = {}
    if snapshot:
        out["snapshot"] = snapshot_lines(
            store_dir=store_dir, provider=provider, now=now, simulated=simulated
        )
    if grade:
        graded = grade_picks(store_dir=store_dir, provider=provider, now=now)
        out["grade"] = {"newly_graded": graded.get("_newly_graded") or []}
        if learn:
            out["learn"] = learn_from_results(
                store_dir=store_dir,
                newly_graded=list(graded.get("_newly_graded") or []),
                now=now,
            )
    if pick:
        out["picks"] = place_picks(store_dir=store_dir, now=now)
    out["board"] = build_board(store_dir=store_dir)
    return out


def maybe_run_after_bets(store_dir: Path | str | None = None) -> str:
    """Best-effort post-step. Failures never fail the human tracker export."""
    try:
        result = run_bot(store_dir=store_dir)
    except Exception as exc:  # noqa: BLE001
        return f"bot skipped: {exc}"
    board = result.get("board") or {}
    return (
        f"bot: {board.get('record', '0-0-0')} "
        f"open={len(board.get('open') or [])} "
        f"simulated={bool(board.get('simulated'))}"
    )

