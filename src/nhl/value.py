"""Per-game player value (HOCKEY-PORT.md H2) + ROS with durability (H3).

Ported from Rinkside ``recommend.value_parts`` / ``evaluate`` / ``adjust``.
Value is a weighted blend of every usable input; each input's weight shrinks
with small samples. Every input ships in ``parts`` with its kind, per-game
value, games, base weight and games factor, so the hub can re-blend for a
different recent-form setting without recomputing anything else:

====================  ==============================================
kind                  weight at recent-form ``r`` (default 0.5)
====================  ==============================================
trailing (L7/15/30)   base (0.10 / 0.15 / 0.15) × r × games factor
season                0.35 × min(GP / 25, 1)
projection (ESPN)     0.15 + 0.30 × (1 − r)
history (NHL)         (0.15 + 0.30 × (1 − r)) × min(total GP / 120, 1)
prospect              0.15
role                  1.0, only when nothing else exists (flagged)
====================  ==============================================

Rules from Rinkside: a zero projection or a zero past season is a data gap,
not a forecast (skaters need > 0, goalies ≠ 0); current-season zeros are
real. Missing data is null, never 0. The role adjustment multiplies the blend
and is capped at ±25%.
"""

from __future__ import annotations

import datetime as dt
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from nhl.aging import age_project, season_age
from nhl.durability import goalie_rate, skater_rate
from nhl.match import grp
from nhl.nhl_api import season_id
from nhl.prospects import prospect_fpg
from nhl.scoring import score_line
from nhl.teams import nhl_abbrev

RECENT_DEFAULT = 0.25  # H2b-tuned (was 0.5)
SCHEMA_VERSION = 1

TRAILING = (("7", 0.10, 3), ("15", 0.15, 6), ("30", 0.15, 12))
SEASON_BASE, SEASON_FULL_GP = 0.5, 40  # H2b-tuned (was 0.35, 25)
HISTORY_FULL_GP = 80  # H2b-tuned (was 120)
PROSPECT_BASE = 0.15
ROOKIE_MAX_PRIOR_GP = 25  # NHL rookie eligibility
PROJECTED_GP_DEFAULT = {"F": 78, "D": 78, "G": 55}

# Rough FP/G from role alone (SJ scoring), for players with nothing else.
ROLE_BASE = {
    "F": {"Line 1": 2.3, "Line 2": 1.9, "Line 3": 1.4, "Line 4": 1.0},
    "D": {"Pair 1": 1.9, "Pair 2": 1.5, "Pair 3": 1.1},
    "G": {"Starter": 4.3, "1A/1B": 3.8, "Backup": 3.3},
}
ROLE_DEFAULT = {"F": 1.3, "D": 1.2, "G": 3.5}
ROLE_PP_BONUS = {"PP1": 0.3, "PP2": 0.1}

LINE_ADJ = {"Line 1": (0.06, "top line"), "Line 2": (0.03, "top-6"),
            "Line 3": (-0.05, "third line"), "Line 4": (-0.10, "fourth line"),
            "Pair 1": (0.04, "top pair"), "Pair 3": (-0.06, "third pair")}
# SJ pays PP bonuses (PPG +1, PPA +0.5), so PP1 matters more than usual.
PP_ADJ = {"PP1": (0.10, "PP1"), "PP2": (0.02, "PP2"), "No PP": (-0.05, "no PP time")}
GOALIE_ADJ = {"Starter": (0.05, "starter"), "1A/1B": (-0.06, "splitting starts"),
              "Backup": (-0.25, "backup")}
TREND_ADJ = 0.04
ADJ_FLOOR, ADJ_CEILING = 0.75, 1.25


@dataclass(frozen=True)
class ValueConfig:
    """The model's tunable knobs (H2b backtest). Defaults are the shipped model.

    Only knobs whose effect is baked into exported ``parts`` (``base``,
    ``games_factor``, per-game values) or the exported ``recent_default`` are
    tunable, so the hub's re-blend (``lib/hockey-values.ts``) stays a mirror of
    :func:`part_weight` without changes.
    """

    # H2b-tuned (HOCKEY-BACKTEST.md): beat Rinkside's originals on every
    # held-out season (2022–23 … 2025–26), −15% error on average. Originals in
    # comments. The ESPN-projection weight could not be measured (no history).
    recent: float = RECENT_DEFAULT  # was 0.5
    trailing_scale: float = 0.5  # was 1.0 — streaks predict less than assumed
    season_base: float = SEASON_BASE  # was 0.35
    season_full_gp: float = SEASON_FULL_GP  # was 25
    history_full_gp: float = HISTORY_FULL_GP  # was 120
    history_decay: tuple[float, float, float] = (1.0, 0.5, 0.25)  # was 1.0/0.6/0.35
    prospect_base: float = PROSPECT_BASE
    aging: bool = True
    role_adjust: bool = False  # was True — PP1/line boosts double-counted history
    durability_pull: float = 0.4  # best of 0.0–0.8

    def as_dict(self) -> dict[str, Any]:
        out = asdict(self)
        out["history_decay"] = list(self.history_decay)
        return out


DEFAULT_CONFIG = ValueConfig()

BACKTEST_SUMMARY = Path(__file__).resolve().parents[2] / "configs" / "hockey_backtest.json"


def load_backtest_summary(path: Path | str | None = None) -> dict[str, Any] | None:
    """Committed H2b accuracy summary (written by ``sj nhl-backtest``), if any."""
    target = Path(path) if path is not None else BACKTEST_SUMMARY
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def part_weight(kind: str, base: float, games_factor: float, recent: float) -> float:
    """Weight of one input at recent-form ``recent`` (0 = track record, 1 = form)."""
    if kind == "trailing":
        return base * recent * games_factor
    if kind == "projection":
        return 0.15 + 0.30 * (1 - recent)
    if kind == "history":
        return (0.15 + 0.30 * (1 - recent)) * games_factor
    if kind == "season":
        return base * games_factor
    return base  # prospect, role


def blend(parts: list[dict[str, Any]], recent: float = RECENT_DEFAULT) -> float | None:
    """Weighted per-game value; equal weights if every weight is 0 at this setting."""
    if not parts:
        return None
    weights = [part_weight(p["kind"], p["base"], p["games_factor"], recent) for p in parts]
    total = math.fsum(weights)
    if total <= 0:
        return round(math.fsum(p["fpg"] for p in parts) / len(parts), 3)
    return round(math.fsum(p["fpg"] * w for p, w in zip(parts, weights, strict=True)) / total, 3)


def _usable(fpg: float, games: float, group: str) -> bool:
    """A skater averaging exactly 0 over real games is a data gap; goalies can be negative."""
    return bool(games) and (fpg != 0 if group == "G" else fpg > 0)


def _per_game(line: dict[str, Any] | None, weights: dict[str, float]) -> tuple[float, float] | None:
    """(FP per game, games) for a stat line with GP, or None."""
    if not line:
        return None
    games = float(line.get("GP") or line.get("GS") or 0)
    if not games:
        return None
    points = score_line(line, weights)
    if points is None:
        return None
    return points / games, games


def _part(kind: str, label: str, fpg: float, games: float | None, base: float,
          games_factor: float = 1.0) -> dict[str, Any]:
    return {"kind": kind, "label": label, "fpg": round(fpg, 3),
            "gp": int(games) if games is not None else None,
            "base": base, "games_factor": round(games_factor, 3)}


def value_parts(
    row: dict[str, Any],
    ctx: dict[str, Any] | None,
    weights: dict[str, float],
    *,
    cur_nhl_season: str,
    config: ValueConfig = DEFAULT_CONFIG,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Every usable input for one ESPN player, plus facts the caller reuses."""
    ctx = ctx or {}
    group = grp(ctx.get("group") or row.get("position"))
    parts: list[dict[str, Any]] = []
    facts: dict[str, Any] = {"group": group, "cur_gp": 0}

    for window, base, full in TRAILING:
        got = _per_game((row.get("trailing_stats") or {}).get(window), weights)
        if got:
            fpg, games = got
            parts.append(_part("trailing", f"last {window} days", fpg, games,
                               round(base * config.trailing_scale, 4),
                               min(games / full, 1.0)))

    history = [h for h in ctx.get("history") or [] if isinstance(h, dict)]
    nhl_cur = next((h for h in history if h.get("season") == cur_nhl_season), None)
    got = _per_game(row.get("season_stats"), weights)
    if got:
        fpg, games = got
        parts.append(_part("season", "this season", fpg, games, config.season_base,
                           min(games / config.season_full_gp, 1.0)))
        facts["cur_gp"] = games
    elif (got := _per_game(nhl_cur, weights)) is not None:
        fpg, games = got
        parts.append(_part("season", "this season (NHL)", fpg, games, config.season_base,
                           min(games / config.season_full_gp, 1.0)))
        facts["cur_gp"] = games

    projected = row.get("projected_stats") or None
    if projected:
        games = float(
            projected.get("GP") or projected.get("GS") or PROJECTED_GP_DEFAULT[group]
        )
        points = score_line(projected, weights)
        facts["espn_proj"] = {"total": None, "gp": games, "per_game": None}
        if points is not None and _usable(points / games, games, group):
            parts.append(_part("projection", "ESPN projection", points / games, games, 0.0))
            facts["espn_proj"] = {"total": round(points, 1), "gp": games,
                                  "per_game": round(points / games, 3)}

    # NHL track record: prior seasons carried to current age, 1.0 / 0.6 / 0.35.
    cur_start = int(cur_nhl_season[:4])
    birth = ctx.get("birth_date")
    now_age = season_age(birth, cur_start)
    seasons = []
    for h in history:
        sid = str(h.get("season") or "")
        if sid == cur_nhl_season or len(sid) != 8:
            continue
        got = _per_game(h, weights)
        if not got or got[1] < 3 or not _usable(got[0], got[1], group):
            continue
        start = int(sid[:4])
        adjusted = (
            age_project(got[0], season_age(birth, start), now_age, group)
            if config.aging
            else got[0]
        )
        seasons.append((adjusted, got[1], cur_start - start))
    facts["history_gp"] = [(int(float(h.get("GP") or 0)), cur_start - int(str(h["season"])[:4]))
                           for h in history
                           if str(h.get("season") or "") != cur_nhl_season
                           and len(str(h.get("season") or "")) == 8]
    if seasons:
        decay = dict(zip((1, 2, 3), config.history_decay, strict=True))
        wts = [g * decay.get(ago, 0.3) for _, g, ago in seasons]
        hv = math.fsum(v * w for (v, _, _), w in zip(seasons, wts, strict=True)) / math.fsum(wts)
        total_gp = math.fsum(g for _, g, _ in seasons)
        n = len(seasons)
        label = (f"NHL history, age-adjusted ({n} season{'s' if n > 1 else ''}, "
                 f"{int(total_gp)} GP)")
        parts.append(_part("history", label, hv, total_gp, 0.0,
                           min(total_gp / config.history_full_gp, 1.0)))

    prior_seasons = [s for s in seasons] or [h for h in facts["history_gp"] if h[0] > 0]
    rookie = bool(ctx) and not prior_seasons and (ctx.get("prior_nhl_gp") or 0) < ROOKIE_MAX_PRIOR_GP
    facts["rookie"] = rookie
    if rookie and ctx.get("minors"):
        est, why = prospect_fpg(
            ctx["minors"],
            birth=birth,
            position=ctx.get("position") or group,
            draft_pick=(ctx.get("draft") or {}).get("overall"),
            weights=weights,
        )
        if est is not None and _usable(est, 1, group):
            parts.append(_part("prospect", f"prospect estimate ({why})", est, None,
                               config.prospect_base))

    if not parts:
        base, why = role_baseline(group, ctx)
        parts.append(_part("role", f"role estimate from {why} (no stats found)", base, None, 1.0))
    return parts, facts


def _role(ctx: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    role = ctx.get("role") or {}
    goalie = (ctx.get("goalie") or {}).get("role")
    return role.get("line"), role.get("pp"), goalie


def role_baseline(group: str, ctx: dict[str, Any]) -> tuple[float, str]:
    line, pp, goalie = _role(ctx)
    if group == "G":
        return ROLE_BASE["G"].get(goalie or "", ROLE_DEFAULT["G"]), goalie or "goalie"
    base = ROLE_BASE[group].get(line or "", ROLE_DEFAULT[group]) + ROLE_PP_BONUS.get(pp or "", 0.0)
    why = ", ".join(x for x in (line, pp) if x) or ("defenseman" if group == "D" else "forward")
    return base, why


def adjust(
    group: str, ctx: dict[str, Any] | None, config: ValueConfig = DEFAULT_CONFIG
) -> tuple[float, list[str]]:
    """Role multiplier (line/pair, PP unit, ice-time trend, goalie role), ±25% cap."""
    ctx = ctx or {}
    if not config.role_adjust:
        return 1.0, []
    total, reasons = 0.0, []

    def add(delta: float, why: str | None) -> None:
        nonlocal total
        if delta and why:
            total += delta
            reasons.append(f"{'+' if delta > 0 else '−'}{why}")

    line, pp, goalie = _role(ctx)
    if group == "G":
        add(*GOALIE_ADJ.get(goalie or "", (0.0, None)))
    else:
        add(*LINE_ADJ.get(line or "", (0.0, None)))
        add(*PP_ADJ.get(pp or "", (0.0, None)))
        for trend in (ctx.get("role") or {}).get("trend") or []:
            add(TREND_ADJ if " up " in trend else -TREND_ADJ, trend)
    if ctx.get("prior_team"):
        reasons.append(f"new team (from {ctx['prior_team']})")
    return round(max(ADJ_FLOOR, min(ADJ_CEILING, 1 + total)), 3), reasons


def data_source(parts: list[dict[str, Any]], facts: dict[str, Any]) -> str:
    """current / history / rookie / rookie_playing / estimate (UI color)."""
    if facts.get("rookie"):
        return "rookie_playing" if facts.get("cur_gp") else "rookie"
    if (facts.get("cur_gp") or 0) >= 5:
        return "current"
    if len(parts) == 1 and parts[0]["kind"] == "role":
        return "estimate"
    return "history"


def remaining_games(team: str | None, schedule: dict[str, Any] | None,
                    as_of: dt.date) -> int | None:
    games = ((schedule or {}).get("teams") or {}).get(team or "")
    if not team or games is None:
        return None
    today = as_of.isoformat()
    return sum(1 for g in games if str(g.get("date") or "") >= today)


def player_value(
    row: dict[str, Any],
    ctx: dict[str, Any] | None,
    weights: dict[str, float],
    *,
    cur_nhl_season: str,
    schedule: dict[str, Any] | None,
    as_of: dt.date,
    config: ValueConfig = DEFAULT_CONFIG,
    season_games: int = 82,
) -> dict[str, Any]:
    parts, facts = value_parts(row, ctx, weights, cur_nhl_season=cur_nhl_season, config=config)
    group = facts["group"]
    base = blend(parts, config.recent)
    mult, reasons = adjust(group, ctx, config)
    value = round(base * mult, 3) if base is not None else None

    projected_gp = (facts.get("espn_proj") or {}).get("gp")
    if group == "G":
        goalie = (ctx or {}).get("goalie") or {}
        durable = goalie_rate(goalie.get("start_share"), goalie.get("basis"))
    elif facts.get("rookie"):
        durable = skater_rate(projected_gp, [], pull=config.durability_pull,
                              season_games=season_games)
    else:
        durable = skater_rate(projected_gp, facts["history_gp"], pull=config.durability_pull,
                              season_games=season_games)
    team = (ctx or {}).get("team") or nhl_abbrev(row.get("pro_team"))
    left = remaining_games(team, schedule, as_of)
    ros = round(value * left * durable.rate, 1) if value is not None and left is not None else None
    return {
        "espn_id": row.get("id"),
        "name": row.get("name"),
        "position": row.get("position"),
        "group": group,
        "pro_team": row.get("pro_team"),
        "nhl_id": (ctx or {}).get("nhl_id"),
        "nhl_team": team,
        "fantasy_team_id": row.get("_team_id"),
        "rostered": bool(row.get("_rostered")),
        "injury_status": row.get("injury_status"),
        # H7: ESPN-wide % rostered and its 7-day change (None when not synced).
        "percent_owned": _owned(row.get("percent_owned")),
        "percent_change": row.get("percent_change"),
        "age": (ctx or {}).get("age"),
        "value": value,
        "base": base,
        "mult": mult,
        "adjustments": reasons,
        "parts": parts,
        "source": data_source(parts, facts),
        "durability": durable.as_dict(),
        "remaining_games": left,
        "ros": ros,
        "espn_proj": facts.get("espn_proj"),
    }


def _owned(raw: Any) -> float | None:
    """espn-api uses -1 when ESPN omitted ownership: treat it as unknown."""
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


def build_values(
    snapshot: dict[str, Any],
    *,
    player_map: dict[str, Any],
    context: dict[str, Any],
    schedule: dict[str, Any] | None,
    weights: dict[str, float],
    scoring_source: str,
    as_of: dt.date,
    generated_at: str,
    config: ValueConfig = DEFAULT_CONFIG,
    season_games: int = 82,
) -> dict[str, Any]:
    """``values.json`` for every rostered player and free agent (keyed by ESPN id)."""
    from nhl.export import espn_players

    season = int(snapshot["season"])
    cur = season_id(season)
    mapped = player_map.get("players") or {}
    ctx_by_nhl = context.get("players") or {}
    players: dict[str, dict[str, Any]] = {}
    for row in espn_players(snapshot):
        entry = mapped.get(str(row.get("id")))
        ctx = ctx_by_nhl.get(str(entry["nhl_id"])) if entry else None
        players[str(row["id"])] = player_value(
            row, ctx, weights, cur_nhl_season=cur, schedule=schedule, as_of=as_of,
            config=config, season_games=season_games,
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "league_id": str(snapshot["league_id"]),
        "season": season,
        "sport": "hockey",
        "nhl_season": cur,
        "generated_at": generated_at,
        "as_of": as_of.isoformat(),
        "recent_default": config.recent,
        "season_games": season_games,
        "model": config.as_dict(),
        # H2b accuracy of this model on past seasons (null until backtested).
        "backtest": load_backtest_summary(),
        "scoring_source": scoring_source,
        "weights": weights,
        "players": players,
    }
