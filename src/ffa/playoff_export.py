"""Offline playoff-odds Monte Carlo for the hub (football follow-up).

The hub never runs ``ffa`` at request time. A scheduled/ops job writes::

    {store}/playoff_odds/{league_id}/{season}.json

Each simulation walks remaining regular-season H2H games: independent
typical-week fantasy-point draws per mapped roster player, greedy skill
lineup (QB/RB/WR/TE/FLEX; K/DST omitted), then tallies make-playoffs and
seed frequencies. Season/weekly *quantile* boards must not be dressed as
these probabilities — this artifact is the only playoff-odds surface.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Final

import numpy as np

SCHEMA_VERSION: Final[int] = 1
_SKILL_POS: Final[frozenset[str]] = frozenset({"QB", "RB", "WR", "TE"})


def playoff_odds_path(out_dir: Path, league_id: str, season: int) -> Path:
    """Return ``out_dir/{league_id}/{season}.json``."""
    return out_dir / str(league_id) / f"{int(season)}.json"


def roster_slots_from_settings(settings: dict[str, Any] | None) -> dict[str, int]:
    """Map ESPN ``position_slot_counts`` to skill-slot counts (K/DST ignored)."""
    raw = (settings or {}).get("position_slot_counts") or {}
    return {
        "QB": int(raw.get("QB") or 1),
        "RB": int(raw.get("RB") or 2),
        "WR": int(raw.get("WR") or 2),
        "TE": int(raw.get("TE") or 1),
        "FLEX": int(raw.get("FLEX") or 1),
    }


def greedy_lineup_points(
    players: list[tuple[str, str, float]],
    slots: dict[str, int],
) -> float:
    """Sum FP for a greedy QB/RB/WR/TE/FLEX fill.

    ``players`` is ``(player_key, position, points)``. Unmapped / non-skill
    players should be omitted by the caller.
    """
    ordered = sorted(players, key=lambda row: row[2], reverse=True)
    picked: set[str] = set()
    total = 0.0

    def take(slot: str, n: int, eligible: set[str]) -> None:
        nonlocal total
        for key, pos, pts in ordered:
            if n <= 0:
                break
            if key in picked or pos not in eligible:
                continue
            picked.add(key)
            total += float(pts)
            n -= 1

    take("QB", slots.get("QB", 0), {"QB"})
    take("RB", slots.get("RB", 0), {"RB"})
    take("WR", slots.get("WR", 0), {"WR"})
    take("TE", slots.get("TE", 0), {"TE"})
    take("FLEX", slots.get("FLEX", 0), {"RB", "WR", "TE"})
    return total


def undecided_matchups(
    teams: list[dict[str, Any]],
    *,
    reg_season_count: int,
    as_of_week: int | None = None,
) -> list[tuple[int, int, int]]:
    """Return unique ``(period_1based, team_a_id, team_b_id)`` still to play.

    A matchup is undecided when both sides have outcome ``U`` (or empty), or
    when ``as_of_week`` is set and ``period >= as_of_week`` (what-if / midseason
    export). Byes (opponent == self) are skipped. Periods above
    ``reg_season_count`` are ignored (playoff bracket MC is out of scope).
    """
    by_id = {int(t["team_id"]): t for t in teams}
    seen: set[tuple[int, int, int]] = set()
    out: list[tuple[int, int, int]] = []

    for team in teams:
        tid = int(team["team_id"])
        schedule = team.get("schedule") or []
        outcomes = team.get("outcomes") or []
        for i, opp in enumerate(schedule):
            period = i + 1
            if period > reg_season_count:
                continue
            opp_id = int(opp)
            if opp_id == tid:
                continue
            a, b = (tid, opp_id) if tid < opp_id else (opp_id, tid)
            key = (period, a, b)
            if key in seen:
                continue
            seen.add(key)

            force = as_of_week is not None and period >= int(as_of_week)
            left_out = str(outcomes[i]) if i < len(outcomes) else "U"
            right = by_id.get(opp_id)
            right_outs = (right.get("outcomes") or []) if right else []
            # Opponent's period index should match; fall back to U.
            right_out = str(right_outs[i]) if i < len(right_outs) else "U"
            if force or (left_out in ("U", "", "None") and right_out in ("U", "", "None")):
                out.append((period, a, b))

    out.sort()
    return out


def _standings_key(wins: float, pf: float, team_id: int) -> tuple[float, float, int]:
    # Higher wins, then PF; team_id for stable ties.
    return (wins, pf, -team_id)


def simulate_playoff_odds(
    league: dict[str, Any],
    points_by_key: dict[str, np.ndarray],
    espn_to_key: dict[str, str],
    *,
    n_sims: int = 500,
    seed: int = 0,
    as_of_week: int | None = None,
) -> dict[str, Any]:
    """Run make-playoffs MC; return document fields for ``teams`` + meta.

    ``points_by_key`` maps projection keys (usually GSIS) to ``(n_samples,)``
    weekly fantasy-point draws. ``espn_to_key`` maps ESPN roster id → key.
    """
    settings = league.get("settings") or {}
    reg = int(settings.get("reg_season_count") or 14)
    playoff_n = int(settings.get("playoff_team_count") or 0)
    if playoff_n <= 0:
        playoff_n = max(1, len(league.get("teams") or []) // 2)

    slots = roster_slots_from_settings(settings)
    teams = list(league.get("teams") or [])
    matchups = undecided_matchups(
        teams, reg_season_count=reg, as_of_week=as_of_week
    )
    periods = sorted({p for p, _, _ in matchups})

    # Precompute roster skill players per team.
    roster_skill: dict[int, list[tuple[str, str, str]]] = {}
    mapped_counts: dict[int, tuple[int, int]] = {}
    for team in teams:
        tid = int(team["team_id"])
        rows: list[tuple[str, str, str]] = []
        rostered = 0
        mapped = 0
        for player in team.get("roster") or []:
            rostered += 1
            espn = str(player.get("id") or "")
            if not espn or espn == "None":
                continue
            pos = str(player.get("position") or "").upper()
            if pos not in _SKILL_POS:
                continue
            key = espn_to_key.get(espn)
            if not key or key not in points_by_key:
                continue
            mapped += 1
            rows.append((espn, key, pos))
        roster_skill[tid] = rows
        mapped_counts[tid] = (mapped, rostered)

    n_samples = 0
    for arr in points_by_key.values():
        n_samples = max(n_samples, len(arr))
    n_samples = max(n_samples, 1)

    rng = np.random.default_rng(seed)
    make = {int(t["team_id"]): 0 for t in teams}
    seed_hits = {int(t["team_id"]): np.zeros(playoff_n, dtype=np.int64) for t in teams}
    win_sums = {int(t["team_id"]): 0.0 for t in teams}

    base_wins = {
        int(t["team_id"]): float(t.get("wins") or 0)
        + 0.5 * float(t.get("ties") or 0)
        for t in teams
    }
    base_pf = {int(t["team_id"]): float(t.get("points_for") or 0) for t in teams}

    # When as_of_week forces re-sim of already-played games, strip those W/L
    # from the base record so we don't double-count.
    if as_of_week is not None:
        for team in teams:
            tid = int(team["team_id"])
            outcomes = team.get("outcomes") or []
            scores = team.get("scores") or []
            schedule = team.get("schedule") or []
            for i, out in enumerate(outcomes):
                period = i + 1
                if period < int(as_of_week) or period > reg:
                    continue
                opp = int(schedule[i]) if i < len(schedule) else tid
                if opp == tid:
                    continue
                if str(out) == "W":
                    base_wins[tid] -= 1.0
                elif str(out) == "L":
                    pass  # wins unchanged
                elif str(out) == "T":
                    base_wins[tid] -= 0.5
                if i < len(scores) and scores[i] is not None:
                    try:
                        base_pf[tid] -= float(scores[i])
                    except (TypeError, ValueError):
                        pass

    for sim in range(n_sims):
        wins = dict(base_wins)
        pf = dict(base_pf)
        for period, a, b in matchups:
            sample_idx = int(rng.integers(0, n_samples))
            # Slight week mixing so the same sim doesn't reuse one column.
            sample_b = int((sample_idx + period * 17) % n_samples)

            def team_score(tid: int, idx: int) -> float:
                rows = roster_skill.get(tid) or []
                lined: list[tuple[str, str, float]] = []
                for espn, key, pos in rows:
                    arr = points_by_key.get(key)
                    if arr is None or len(arr) == 0:
                        continue
                    pts = float(arr[idx % len(arr)])
                    lined.append((espn, pos, pts))
                return greedy_lineup_points(lined, slots)

            sa = team_score(a, sample_idx)
            sb = team_score(b, sample_b)
            pf[a] += sa
            pf[b] += sb
            if sa > sb:
                wins[a] += 1.0
            elif sb > sa:
                wins[b] += 1.0
            else:
                wins[a] += 0.5
                wins[b] += 0.5

        ranked = sorted(
            teams,
            key=lambda t: _standings_key(
                wins[int(t["team_id"])], pf[int(t["team_id"])], int(t["team_id"])
            ),
            reverse=True,
        )
        for seed_idx, team in enumerate(ranked[:playoff_n]):
            tid = int(team["team_id"])
            make[tid] += 1
            seed_hits[tid][seed_idx] += 1
        for team in teams:
            tid = int(team["team_id"])
            win_sums[tid] += wins[tid]

    team_rows: list[dict[str, Any]] = []
    for team in sorted(teams, key=lambda t: int(t.get("standing") or 999)):
        tid = int(team["team_id"])
        mapped, rostered = mapped_counts.get(tid, (0, 0))
        probs = {
            str(i + 1): float(seed_hits[tid][i]) / float(n_sims)
            for i in range(playoff_n)
        }
        team_rows.append(
            {
                "team_id": tid,
                "name": team.get("name"),
                "standing_now": team.get("standing"),
                "wins_now": team.get("wins"),
                "losses_now": team.get("losses"),
                "ties_now": team.get("ties") or 0,
                "make_playoffs": float(make[tid]) / float(n_sims),
                "seed_probs": probs,
                "avg_wins": float(win_sums[tid]) / float(n_sims),
                "mapped_roster": mapped,
                "rostered": rostered,
            }
        )

    current_week = league.get("current_week")
    return {
        "reg_season_count": reg,
        "playoff_team_count": playoff_n,
        "as_of_week": int(as_of_week) if as_of_week is not None else current_week,
        "periods_simulated": periods,
        "teams": team_rows,
        "n_matchups": len(matchups),
    }


def build_playoff_odds_document(
    league: dict[str, Any],
    sim_result: dict[str, Any],
    *,
    scoring: str,
    n_sims: int,
    assumptions: dict[str, Any],
    source: dict[str, Any],
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    """Assemble hub-readable playoff odds snapshot."""
    when = generated_at or datetime.now(timezone.utc)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": when.isoformat().replace("+00:00", "Z"),
        "league_id": league.get("league_id"),
        "espn_league_id": league.get("espn_league_id"),
        "season": int(league.get("season")),
        "scoring": scoring,
        "n_sims": int(n_sims),
        "as_of_week": sim_result.get("as_of_week"),
        "reg_season_count": sim_result.get("reg_season_count"),
        "playoff_team_count": sim_result.get("playoff_team_count"),
        "periods_simulated": sim_result.get("periods_simulated"),
        "assumptions": assumptions,
        "source": source,
        "teams": sim_result.get("teams"),
    }


def write_playoff_odds_snapshot(document: dict[str, Any], out_dir: Path) -> Path:
    """Write playoff odds JSON; returns path written."""
    league_id = str(document["league_id"])
    season = int(document["season"])
    path = playoff_odds_path(out_dir, league_id, season)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    return path


def load_playoff_odds_snapshot(path: Path) -> dict[str, Any]:
    """Read a playoff-odds JSON snapshot from disk."""
    return json.loads(path.read_text(encoding="utf-8"))
