"""Backtest the hockey value model (HOCKEY-PORT.md H2b).

Replays past NHL seasons as of a date using only data available then, runs
the real model (:func:`nhl.value.value_parts` / ``blend`` / ``adjust`` and
:func:`nhl.durability.skater_rate`), and compares the prediction with what
happened, scored under the league's rules.

Checkpoints per holdout season:

* ``preseason`` — NHL history, aging, prospect estimate, last season's roles.
  Actual = full-season FP per game.
* ``dec1`` / ``feb1`` — adds season-to-date, last 7/15/30 days, and ice-time
  roles as of that date. Actual = rest-of-season FP per game.

ESPN's historical projections are not available, so the ESPN-projection input
(30% of the live blend) cannot be measured here; everything NHL-based can.
Population: every NHL skater and goalie with enough games in the scored window.
Durability (H3) is scored at the preseason checkpoint (predicted share of the
season vs. actual). Metrics follow ``ffa backtest``: MAE / RMSE of FP per
game, bias (predicted − actual), Spearman, by group and by projected tier.

Tuning is coordinate descent over :class:`nhl.value.ValueConfig`, judged
leave-one-season-out; a tuned config is only recommended when it beats the
shipped defaults on held-out seasons.

Team membership inside a date range is not reported by the NHL stats API, so
in-season roles use each player's team for that season (last listed club) —
a small leak for players traded mid-season, noted in the report.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from nhl.durability import goalie_rate, skater_rate
from nhl.export import goalie_shares
from nhl.match import grp
from nhl.nhl_api import (
    NHLClient,
    http_fetch,
    parse_bios,
    parse_goalie_lines,
    parse_skater_lines,
    parse_toi_rows,
    summarize_landing,
)
from nhl.roles import skater_roles
from nhl.teams import last_team
from nhl.value import DEFAULT_CONFIG, ValueConfig, adjust, blend, value_parts

CHECKPOINTS = ("preseason", "dec1", "feb1")
# Minimum games in the scored window for a player to count.
MIN_ACTUAL_GP = {"preseason": 20, "dec1": 20, "feb1": 15}
TIERS = ((1, 50, "top 50"), (51, 150, "51–150"), (151, 10_000, "151+"))
DEFAULT_SEASONS = ("20222023", "20232024", "20242025", "20252026")
# Durability history spans COVID seasons; score it only where history is clean.
DURABILITY_MIN_SEASON = "20232024"
DURABILITY_MIN_LAST_GP = 40  # skaters: established regulars only
ADOPT_MIN_GAIN = 0.02  # tuned config must cut held-out MAE by 2%+


# ---------------------------------------------------------------------------
# cached fetch
# ---------------------------------------------------------------------------
class CachedFetch:
    """``fetch(url, params)`` that stores each JSON response on disk.

    Past seasons never change, so reruns (and tuning) are offline and fast.
    """

    def __init__(self, cache_dir: Path | str, inner: Callable[..., Any] | None = None) -> None:
        self.dir = Path(cache_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.inner = inner or http_fetch
        self.hits = self.misses = 0

    def __call__(self, url: str, params: dict[str, Any] | None = None) -> Any:
        key = hashlib.sha1(
            json.dumps([url, params or {}], sort_keys=True).encode("utf-8")
        ).hexdigest()
        path = self.dir / f"{key}.json"
        if path.exists():
            self.hits += 1
            return json.loads(path.read_text(encoding="utf-8"))
        self.misses += 1
        doc = self.inner(url, params)
        path.write_text(json.dumps(doc), encoding="utf-8")
        return doc


# ---------------------------------------------------------------------------
# data
# ---------------------------------------------------------------------------
def prev_season(sid: str, back: int = 1) -> str:
    start = int(sid[:4]) - back
    return f"{start}{start + 1}"


def _lines(client: NHLClient, fetch_rows: Callable[[str, str], list[dict]]) -> dict[int, dict]:
    """Skater + goalie stat lines keyed by NHL id (GP-bearing, league-scoring names)."""
    skaters = parse_skater_lines(fetch_rows("skater", "summary"), fetch_rows("skater", "realtime"))
    goalies = parse_goalie_lines(fetch_rows("goalie", "summary"))
    return {**skaters, **goalies}


@dataclass
class SeasonData:
    sid: str
    start: dt.date
    end: dt.date
    games: int
    lines: dict[int, dict[str, Any]]  # full regular season
    toi: dict[int, dict[str, Any]]  # full-season per-game TOI (with teams)
    bios: dict[int, dict[str, Any]]


class BacktestData:
    """Everything the checkpoints need, fetched once through ``client``."""

    def __init__(self, client: NHLClient) -> None:
        self.client = client
        self._seasons: dict[str, SeasonData] = {}
        self._ranges: dict[tuple[str, str], dict[int, dict[str, Any]]] = {}
        self._toi_ranges: dict[tuple[str, str], dict[int, dict[str, Any]]] = {}
        self._landing: dict[int, dict[str, Any] | None] = {}
        self._season_list = client.seasons()

    def season(self, sid: str) -> SeasonData:
        if sid not in self._seasons:
            info = self._season_list.get(sid) or {}
            c = self.client
            bios = parse_bios(c.season_report("skater", "bios", sid))
            bios.update(parse_bios(c.season_report("goalie", "bios", sid)))
            self._seasons[sid] = SeasonData(
                sid=sid,
                start=dt.date.fromisoformat(info["start"]),
                end=dt.date.fromisoformat(info["end"]),
                games=int(info.get("games") or 82),
                lines=_lines(c, lambda kind, rep: c.season_report(kind, rep, sid)),
                toi=parse_toi_rows(c.season_report("skater", "timeonice", sid)),
                bios=bios,
            )
        return self._seasons[sid]

    def range_lines(self, start: dt.date, end: dt.date) -> dict[int, dict[str, Any]]:
        key = (start.isoformat(), end.isoformat())
        if key not in self._ranges:
            c = self.client
            self._ranges[key] = _lines(c, lambda kind, rep: c.range_report(kind, rep, start, end))
        return self._ranges[key]

    def range_toi(self, start: dt.date, end: dt.date) -> dict[int, dict[str, Any]]:
        key = (start.isoformat(), end.isoformat())
        if key not in self._toi_ranges:
            self._toi_ranges[key] = self.client.toi_window(start, end)
        return self._toi_ranges[key]

    def landing(self, nhl_id: int) -> dict[str, Any] | None:
        if nhl_id not in self._landing:
            try:
                self._landing[nhl_id] = self.client.player_landing(nhl_id)
            except Exception:  # noqa: BLE001 - a missing page is a gap, not a crash
                self._landing[nhl_id] = None
        return self._landing[nhl_id]


# ---------------------------------------------------------------------------
# samples
# ---------------------------------------------------------------------------
@dataclass
class Sample:
    season: str
    checkpoint: str
    nhl_id: int
    group: str
    row: dict[str, Any]
    ctx: dict[str, Any]
    actual_fpg: float
    actual_gp: float


@dataclass
class DurabilitySample:
    season: str
    nhl_id: int
    group: str
    history_gp: list[tuple[int, int]]
    history_games: dict[int, int]
    start_share: float | None
    actual_share: float
    season_games: int


@dataclass
class SeasonSamples:
    season: str
    values: list[Sample] = field(default_factory=list)
    durability: list[DurabilitySample] = field(default_factory=list)


def checkpoint_date(sid: str, checkpoint: str) -> dt.date | None:
    first = int(sid[:4])
    return {"dec1": dt.date(first, 12, 1), "feb1": dt.date(first + 1, 2, 1)}.get(checkpoint)


def _fpg(line: dict[str, Any] | None, weights: dict[str, float]) -> tuple[float, float] | None:
    from nhl.scoring import score_line

    if not line:
        return None
    games = float(line.get("GP") or 0)
    points = score_line(line, weights)
    if not games or points is None:
        return None
    return points / games, games


def build_season_samples(
    data: BacktestData,
    sid: str,
    weights: dict[str, float],
    *,
    checkpoints: Iterable[str] = CHECKPOINTS,
    rookie_landing_max: int = 150,
) -> SeasonSamples:
    """Model inputs as of each checkpoint + what actually happened after it."""
    season = data.season(sid)
    prior_ids = [prev_season(sid, k) for k in (1, 2, 3)]
    priors = {p: data.season(p) for p in prior_ids}
    out = SeasonSamples(season=sid)

    team = {pid: last_team(r.get("teams")) for pid, r in season.lines.items()}
    pool = {
        pid: {"pos": (season.bios.get(pid) or {}).get("pos"), "team": team.get(pid)}
        for pid in season.lines
        if (season.bios.get(pid) or {}).get("pos")
    }

    def history(pid: int) -> list[dict[str, Any]]:
        rows = []
        for p in prior_ids:
            line = priors[p].lines.get(pid)
            if line and line.get("GP"):
                rows.append({"season": p, **{k: v for k, v in line.items() if k != "teams"}})
        return rows

    rookies_left = rookie_landing_max
    base_ctx: dict[int, dict[str, Any]] = {}
    for pid, player in pool.items():
        bio = season.bios.get(pid) or {}
        hist = history(pid)
        ctx: dict[str, Any] = {
            "nhl_id": pid,
            "group": grp(player["pos"]),
            "position": player["pos"],
            "team": player["team"],
            "birth_date": bio.get("birth"),
            "history": hist,
        }
        if not hist and rookies_left > 0:
            rookies_left -= 1
            doc = data.landing(pid)
            if doc:
                land = summarize_landing(doc, sid)
                ctx["prior_nhl_gp"] = land.get("prior_nhl_gp")
                ctx["draft"] = land.get("draft")
                ctx["minors"] = land.get("minors")
        base_ctx[pid] = ctx

    prior_toi = priors[prior_ids[0]].toi
    prior_starts = {pid: {"GS": line.get("GS", 0)} for pid, line in priors[prior_ids[0]].lines.items()
                    if "GS" in line}

    for checkpoint in checkpoints:
        as_of = checkpoint_date(sid, checkpoint)
        if checkpoint == "preseason":
            actual = season.lines
            to_date: dict[int, dict[str, Any]] = {}
            trailing: dict[str, dict[int, dict[str, Any]]] = {}
            roles = skater_roles(pool, {}, {}, prior_toi)
            cur_starts: dict[int, dict[str, Any]] = {}
        else:
            assert as_of is not None
            actual = data.range_lines(as_of + dt.timedelta(days=1), season.end)
            to_date = data.range_lines(season.start, as_of)
            trailing = {
                w: data.range_lines(as_of - dt.timedelta(days=int(w) - 1), as_of)
                for w in ("7", "15", "30")
            }
            roles = skater_roles(
                pool,
                data.range_toi(as_of - dt.timedelta(days=13), as_of),
                data.range_toi(season.start, as_of),
                prior_toi,
            )
            cur_starts = {pid: {"GS": line.get("GS", 0)} for pid, line in to_date.items()
                          if "GS" in line}
        shares = goalie_shares(pool, cur_starts, prior_starts)
        for pid, ctx0 in base_ctx.items():
            got = _fpg(actual.get(pid), weights)
            if not got or got[1] < MIN_ACTUAL_GP[checkpoint]:
                continue
            ctx = dict(ctx0)
            if ctx["group"] == "G":
                ctx["goalie"] = shares.get(pid) or {}
            else:
                role = roles.get(pid) or {}
                ctx["role"] = {"line": role.get("line"), "pp": role.get("pp"),
                               "trend": role.get("trend") or []}
            row: dict[str, Any] = {"position": ctx["position"]}
            if to_date.get(pid):
                row["season_stats"] = to_date[pid]
            windows = {w: t[pid] for w, t in trailing.items() if t.get(pid)}
            if windows:
                row["trailing_stats"] = windows
            out.values.append(Sample(sid, checkpoint, pid, ctx["group"], row, ctx,
                                     actual_fpg=got[0], actual_gp=got[1]))

    if sid >= DURABILITY_MIN_SEASON:
        lengths = {k: priors[p].games for k, p in zip((1, 2, 3), prior_ids, strict=True)}
        for pid, ctx in base_ctx.items():
            line = season.lines.get(pid)
            if not line or not line.get("GP"):
                continue
            hist_gp = [(int(h.get("GP") or 0), int(sid[:4]) - int(h["season"][:4]))
                       for h in ctx["history"]]
            last_gp = next((gp for gp, ago in hist_gp if ago == 1), 0)
            if ctx["group"] != "G" and last_gp < DURABILITY_MIN_LAST_GP:
                # Rookies default to 90%, and call-ups sit on the 50% floor; the
                # durability question is about established regulars.
                continue
            share = None
            if ctx["group"] == "G":
                share = (goalie_shares(pool, {}, prior_starts).get(pid) or {}).get("start_share")
                if share is None:
                    continue
            out.durability.append(DurabilitySample(
                season=sid, nhl_id=pid, group=ctx["group"], history_gp=hist_gp,
                history_games=lengths, start_share=share,
                actual_share=min(float(line["GP"]) / season.games, 1.0),
                season_games=season.games,
            ))
    return out


# ---------------------------------------------------------------------------
# evaluation
# ---------------------------------------------------------------------------
def predict(sample: Sample, weights: dict[str, float], config: ValueConfig) -> float | None:
    parts, facts = value_parts(sample.row, sample.ctx, weights,
                               cur_nhl_season=sample.season, config=config)
    base = blend(parts, config.recent)
    if base is None:
        return None
    mult, _ = adjust(facts["group"], sample.ctx, config)
    return base * mult


def _ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def spearman(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 3:
        return None
    rx, ry = _ranks(xs), _ranks(ys)
    mx, my = math.fsum(rx) / len(rx), math.fsum(ry) / len(ry)
    cov = math.fsum((a - mx) * (b - my) for a, b in zip(rx, ry, strict=True))
    vx = math.fsum((a - mx) ** 2 for a in rx)
    vy = math.fsum((b - my) ** 2 for b in ry)
    return round(cov / math.sqrt(vx * vy), 4) if vx and vy else None


def metrics(pairs: list[tuple[float, float, float]]) -> dict[str, Any]:
    """``pairs`` of (predicted, actual, games). MAE is games-weighted."""
    if not pairs:
        return {"n": 0, "mae": None, "rmse": None, "bias": None, "spearman": None}
    w = math.fsum(g for _, _, g in pairs)
    err = [(p - a, g) for p, a, g in pairs]
    return {
        "n": len(pairs),
        "mae": round(math.fsum(abs(e) * g for e, g in err) / w, 4),
        "rmse": round(math.sqrt(math.fsum(e * e * g for e, g in err) / w), 4),
        "bias": round(math.fsum(e * g for e, g in err) / w, 4),
        "spearman": spearman([p for p, _, _ in pairs], [a for _, a, _ in pairs]),
    }


def evaluate(
    samples: list[Sample], weights: dict[str, float], config: ValueConfig
) -> dict[str, Any]:
    """Metrics overall, by checkpoint, by group, and by projected tier."""
    scored = []
    for s in samples:
        pred = predict(s, weights, config)
        if pred is not None:
            scored.append((s, pred))
    out: dict[str, Any] = {"overall": metrics([(p, s.actual_fpg, s.actual_gp) for s, p in scored])}
    out["by_checkpoint"] = {
        c: metrics([(p, s.actual_fpg, s.actual_gp) for s, p in scored if s.checkpoint == c])
        for c in CHECKPOINTS
    }
    out["by_group"] = {
        g: metrics([(p, s.actual_fpg, s.actual_gp) for s, p in scored if s.group == g])
        for g in ("F", "D", "G")
    }
    tiers: dict[str, list[tuple[float, float, float]]] = {label: [] for *_, label in TIERS}
    for key in {(s.season, s.checkpoint) for s, _ in scored}:
        bucket = sorted(((s, p) for s, p in scored if (s.season, s.checkpoint) == key),
                        key=lambda sp: -sp[1])
        for rank, (s, p) in enumerate(bucket, start=1):
            label = next(lbl for lo, hi, lbl in TIERS if lo <= rank <= hi)
            tiers[label].append((p, s.actual_fpg, s.actual_gp))
    out["by_tier"] = {label: metrics(rows) for label, rows in tiers.items()}
    return out


def durability_metrics(samples: list[DurabilitySample], pull: float) -> dict[str, Any]:
    pairs = []
    for s in samples:
        if s.group == "G":
            pred = goalie_rate(s.start_share, None).rate
        else:
            pred = skater_rate(None, s.history_gp, pull=pull, season_games=s.season_games,
                               history_games=s.history_games).rate
        pairs.append((pred, s.actual_share, 1.0))
    return metrics(pairs)


# ---------------------------------------------------------------------------
# tuning
# ---------------------------------------------------------------------------
GRID: dict[str, list[Any]] = {
    "recent": [0.0, 0.25, 0.5, 0.75, 1.0],
    "trailing_scale": [0.5, 1.0, 1.5, 2.0],
    "season_base": [0.25, 0.35, 0.5],
    "season_full_gp": [15, 25, 40],
    "history_full_gp": [80, 120, 180],
    "history_decay": [(1.0, 0.6, 0.35), (1.0, 0.5, 0.25), (1.0, 0.7, 0.5), (1.0, 0.8, 0.6)],
    "prospect_base": [0.10, 0.15, 0.25],
    "aging": [True, False],
    "role_adjust": [True, False],
}
DURABILITY_PULLS = [0.0, 0.2, 0.4, 0.6, 0.8]


def objective(samples: list[Sample], weights: dict[str, float], config: ValueConfig) -> float:
    mae = evaluate(samples, weights, config)["overall"]["mae"]
    return mae if mae is not None else math.inf


def tune(
    samples: list[Sample],
    weights: dict[str, float],
    start: ValueConfig = DEFAULT_CONFIG,
    grid: dict[str, list[Any]] | None = None,
    rounds: int = 2,
) -> tuple[ValueConfig, float]:
    """Coordinate descent: best value per knob in turn, ``rounds`` passes."""
    grid = grid or GRID
    best, best_score = start, objective(samples, weights, start)
    for _ in range(rounds):
        improved = False
        for knob, options in grid.items():
            for option in options:
                if getattr(best, knob) == option:
                    continue
                candidate = replace(best, **{knob: option})
                score = objective(samples, weights, candidate)
                if score < best_score - 1e-9:
                    best, best_score, improved = candidate, score, True
        if not improved:
            break
    return best, best_score


def tune_durability(samples: list[DurabilitySample]) -> tuple[float, float]:
    scored = [(pull, durability_metrics(samples, pull)["mae"] or math.inf) for pull in DURABILITY_PULLS]
    return min(scored, key=lambda x: (x[1], abs(x[0] - DEFAULT_CONFIG.durability_pull)))


def leave_one_season_out(
    by_season: dict[str, list[Sample]], weights: dict[str, float]
) -> list[dict[str, Any]]:
    """Tune on every other season, score the held-out one; default vs tuned."""
    rows = []
    for held, test in by_season.items():
        train = [s for sid, ss in by_season.items() if sid != held for s in ss]
        tuned, _ = tune(train, weights)
        rows.append({
            "held_out": held,
            "default_mae": objective(test, weights, DEFAULT_CONFIG),
            "tuned_mae": objective(test, weights, tuned),
            "tuned": tuned.as_dict(),
        })
    return rows


def decide(loso: list[dict[str, Any]]) -> dict[str, Any]:
    """Adopt tuning only if held-out MAE improves 2%+ on average and in most seasons."""
    if not loso:
        return {"adopt": False, "reason": "no seasons"}
    gains = [(r["default_mae"] - r["tuned_mae"]) / r["default_mae"] for r in loso]
    avg = math.fsum(gains) / len(gains)
    wins = sum(1 for g in gains if g > 0)
    adopt = avg >= ADOPT_MIN_GAIN and wins >= math.ceil(0.75 * len(gains))
    return {"adopt": adopt, "avg_gain": round(avg, 4), "seasons_improved": wins,
            "seasons": len(gains)}


# ---------------------------------------------------------------------------
# run + report
# ---------------------------------------------------------------------------
def run_backtest(
    client: NHLClient,
    weights: dict[str, float],
    seasons: Iterable[str] = DEFAULT_SEASONS,
    *,
    on_event: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    emit = on_event or (lambda _msg: None)
    data = BacktestData(client)
    by_season: dict[str, SeasonSamples] = {}
    for sid in seasons:
        emit(f"building {sid}")
        by_season[sid] = build_season_samples(data, sid, weights)
        emit(f"  {len(by_season[sid].values)} player-checkpoints, "
             f"{len(by_season[sid].durability)} durability samples")
    values = {sid: s.values for sid, s in by_season.items()}
    everything = [s for ss in values.values() for s in ss]
    dur = [d for s in by_season.values() for d in s.durability]

    emit("scoring shipped defaults")
    default_eval = evaluate(everything, weights, DEFAULT_CONFIG)
    emit("leave-one-season-out tuning")
    loso = leave_one_season_out(values, weights)
    verdict = decide(loso)
    emit("tuning on all seasons")
    tuned, _ = tune(everything, weights)
    tuned_eval = evaluate(everything, weights, tuned)
    pull, _ = tune_durability(dur)

    return {
        "schema_version": 1,
        "seasons": list(values),
        "checkpoints": list(CHECKPOINTS),
        "min_actual_gp": MIN_ACTUAL_GP,
        "weights": weights,
        "default": {"config": DEFAULT_CONFIG.as_dict(), "eval": default_eval},
        "tuned": {"config": tuned.as_dict(), "eval": tuned_eval},
        "leave_one_season_out": loso,
        "decision": verdict,
        "durability": {
            "n": len(dur),
            "default_pull": DEFAULT_CONFIG.durability_pull,
            "default": durability_metrics(dur, DEFAULT_CONFIG.durability_pull),
            "best_pull": pull,
            "best": durability_metrics(dur, pull),
            "by_pull": {str(p): durability_metrics(dur, p)["mae"] for p in DURABILITY_PULLS},
        },
    }


def _fmt(v: Any, digits: int = 3) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:.{digits}f}"
    return str(v)


def report_markdown(report: dict[str, Any]) -> str:
    """Human-readable summary of :func:`run_backtest` output."""
    d, t = report["default"]["eval"], report["tuned"]["eval"]
    gp = report["min_actual_gp"]
    lines = [
        "# Hockey value model backtest (HOCKEY-PORT.md H2b)",
        "",
        (f"Seasons: {', '.join(report['seasons'])} · checkpoints: "
         f"{', '.join(report['checkpoints'])} · scored under SJ Hockey rules."),
        (f"Every NHL player with enough games in the scored window (preseason/Dec 1: "
         f"{gp['preseason']}+ GP, Feb 1: {gp['feb1']}+). Errors are fantasy points per "
         "game, games-weighted. Bias = predicted − actual (positive = optimistic)."),
        "",
        "ESPN's historical projections are not available, so the ESPN-projection",
        "input (30% of the live blend) is not measured here.",
        "",
        "## Shipped defaults vs tuned",
        "",
        ("| slice | n | MAE (default) | MAE (tuned) | bias (default) | bias (tuned) "
         "| Spearman (default) | Spearman (tuned) |"),
        "|---|---|---|---|---|---|---|---|",
    ]

    def row(label: str, a: dict[str, Any], b: dict[str, Any]) -> str:
        return (f"| {label} | {a['n']} | {_fmt(a['mae'])} | {_fmt(b['mae'])} | "
                f"{_fmt(a['bias'])} | {_fmt(b['bias'])} | {_fmt(a['spearman'])} | "
                f"{_fmt(b['spearman'])} |")

    lines.append(row("all", d["overall"], t["overall"]))
    for key in report["checkpoints"]:
        lines.append(row(key, d["by_checkpoint"][key], t["by_checkpoint"][key]))
    for key in ("F", "D", "G"):
        lines.append(row(key, d["by_group"][key], t["by_group"][key]))
    for key in d["by_tier"]:
        lines.append(row(f"tier {key}", d["by_tier"][key], t["by_tier"][key]))

    lines += ["", "## Leave-one-season-out", "",
              "| held-out season | MAE (default) | MAE (tuned on the others) |", "|---|---|---|"]
    for r in report["leave_one_season_out"]:
        lines.append(f"| {r['held_out']} | {_fmt(r['default_mae'])} | {_fmt(r['tuned_mae'])} |")
    v = report["decision"]
    verdict = "adopt tuned config" if v["adopt"] else "keep shipped defaults"
    lines += [
        "",
        (f"**Decision:** {verdict} (average held-out gain {v.get('avg_gain', 0):.1%}, "
         f"improved {v.get('seasons_improved', 0)}/{v.get('seasons', 0)} seasons; needs "
         f"{ADOPT_MIN_GAIN:.0%}+ and 3 of 4)."),
        "",
    ]

    lines += ["## Config", "", "| knob | shipped | tuned |", "|---|---|---|"]
    tuned_config = report["tuned"]["config"]
    for knob, shipped in report["default"]["config"].items():
        lines.append(f"| `{knob}` | {_fmt(shipped, 2)} | {_fmt(tuned_config[knob], 2)} |")

    dur = report["durability"]
    lines += [
        "",
        "## Durability (H3, preseason)",
        "",
        (f"{dur['n']} player-seasons (2023–24 on; skaters with {DURABILITY_MIN_LAST_GP}+ GP "
         "last season, goalies with a prior start share). Error is share of the season "
         "played."),
        "",
        "| pull toward 90% | MAE |",
        "|---|---|",
    ]
    for pull, mae in dur["by_pull"].items():
        tags = [t for t, hit in (("shipped", float(pull) == dur["default_pull"]),
                                 ("best", float(pull) == dur["best_pull"])) if hit]
        lines.append(f"| {pull}{' (' + ', '.join(tags) + ')' if tags else ''} | {_fmt(mae)} |")
    lines += [
        "",
        (f"Bias at the shipped pull: {_fmt(dur['default']['bias'])} "
         "(positive = expects more games than were played)."),
        "",
        "In-season roles use each player's team for that season (the stats API does not",
        "report team inside a date range), a small leak for players traded mid-season.",
        "",
    ]
    return "\n".join(lines)


def hub_summary(report: dict[str, Any]) -> dict[str, Any]:
    """Compact accuracy summary of the *shipped* config, for the projections board.

    Saved to ``configs/hockey_backtest.json`` and copied into ``values.json`` by
    :func:`nhl.value.build_values`, so the hub never reads a separate file.
    """
    ev = report["default"]["eval"]
    return {
        "seasons": report["seasons"],
        "checkpoints": report["checkpoints"],
        "mae_by_group": {g: ev["by_group"][g]["mae"] for g in ("F", "D", "G")},
        "bias": ev["overall"]["bias"],
        "spearman": ev["overall"]["spearman"],
        "n": ev["overall"]["n"],
        "config": report["default"]["config"],
    }
