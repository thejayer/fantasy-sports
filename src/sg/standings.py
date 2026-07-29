"""Derive golf season standings from scored weeks (roadmap 6.4e).

Pure functions of ``scoreboard`` + league ``format``. No live tour calls —
call after ``build_scoreboard_payload`` when creating/seeding snapshots.
"""

from __future__ import annotations

from typing import Any, Literal

GolfFormat = Literal["h2h", "season_points"]


def _win_pct(wins: int, losses: int, ties: int) -> float:
    games = wins + losses + ties
    if games <= 0:
        return 0.0
    return (wins + 0.5 * ties) / games


def apply_standings_from_scoreboard(
    teams: list[dict[str, Any]],
    scoreboard: dict[str, Any] | None,
    format: str,
) -> list[dict[str, Any]]:
    """Mutate and return ``teams`` with season aggregates from scored events.

    * **h2h** — accumulate W/L/T from pairings; PF/PA from week totals.
    * **season_points** — sum ``week_total`` into ``points_for``; record stays 0.
    """
    fmt: GolfFormat = "season_points" if format == "season_points" else "h2h"
    by_id: dict[int, dict[str, Any]] = {}
    for team in teams:
        tid = int(team["team_id"])
        team["wins"] = 0
        team["losses"] = 0
        team["ties"] = 0
        team["points_for"] = 0.0
        team["points_against"] = 0.0
        team["win_pct"] = 0.0
        by_id[tid] = team

    events = list((scoreboard or {}).get("events") or [])
    if fmt == "h2h":
        for event in events:
            for pair in event.get("pairings") or []:
                try:
                    home_id = int(pair["home_team_id"])
                    away_id = int(pair["away_team_id"])
                except (KeyError, TypeError, ValueError):
                    continue
                home = by_id.get(home_id)
                away = by_id.get(away_id)
                if not home or not away:
                    continue
                home_total = float(pair.get("home_total") or 0.0)
                away_total = float(pair.get("away_total") or 0.0)
                outcome = str(pair.get("outcome") or "T")
                home["points_for"] = float(home["points_for"]) + home_total
                home["points_against"] = float(home["points_against"]) + away_total
                away["points_for"] = float(away["points_for"]) + away_total
                away["points_against"] = float(away["points_against"]) + home_total
                if outcome == "W":
                    home["wins"] = int(home["wins"]) + 1
                    away["losses"] = int(away["losses"]) + 1
                elif outcome == "L":
                    home["losses"] = int(home["losses"]) + 1
                    away["wins"] = int(away["wins"]) + 1
                else:
                    home["ties"] = int(home["ties"]) + 1
                    away["ties"] = int(away["ties"]) + 1
    else:
        for event in events:
            for tid_str, week in (event.get("teams") or {}).items():
                try:
                    tid = int(tid_str)
                except (TypeError, ValueError):
                    continue
                team = by_id.get(tid)
                if not team:
                    continue
                team["points_for"] = float(team["points_for"]) + float(
                    (week or {}).get("week_total") or 0.0
                )

    for team in teams:
        team["win_pct"] = _win_pct(int(team["wins"]), int(team["losses"]), int(team["ties"]))

    if fmt == "h2h":
        ranked = sorted(
            teams,
            key=lambda t: (
                -float(t["win_pct"]),
                -float(t["points_for"]),
                int(t["team_id"]),
            ),
        )
    else:
        ranked = sorted(
            teams,
            key=lambda t: (-float(t["points_for"]), int(t["team_id"])),
        )
    for index, team in enumerate(ranked):
        team["standing"] = index + 1

    # Keep payload order by team_id so draft/roster defaults stay stable;
    # Standings UI sorts by ``standing``.
    teams.sort(key=lambda t: int(t["team_id"]))
    return teams


def apply_matchups_from_scoreboard(
    teams: list[dict[str, Any]],
    scoreboard: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Fill ESPN-shaped ``schedule`` / ``scores`` / ``outcomes`` from pairings.

    Lets History Records + H2H reuse the shared archive helpers (roadmap 6.5).
    Outcome is from each team's perspective (home ``W`` → away ``L``).
    """
    by_id: dict[int, dict[str, Any]] = {int(t["team_id"]): t for t in teams}
    for team in teams:
        team["schedule"] = []
        team["scores"] = []
        team["outcomes"] = []

    for event in (scoreboard or {}).get("events") or []:
        seen: set[int] = set()
        for pair in event.get("pairings") or []:
            try:
                home_id = int(pair["home_team_id"])
                away_id = int(pair["away_team_id"])
            except (KeyError, TypeError, ValueError):
                continue
            home = by_id.get(home_id)
            away = by_id.get(away_id)
            if not home or not away:
                continue
            home_total = float(pair.get("home_total") or 0.0)
            away_total = float(pair.get("away_total") or 0.0)
            outcome = str(pair.get("outcome") or "T")
            home_out = outcome if outcome in ("W", "L", "T") else "T"
            if home_out == "W":
                away_out = "L"
            elif home_out == "L":
                away_out = "W"
            else:
                away_out = "T"
            home["schedule"].append(away_id)
            home["scores"].append(home_total)
            home["outcomes"].append(home_out)
            away["schedule"].append(home_id)
            away["scores"].append(away_total)
            away["outcomes"].append(away_out)
            seen.add(home_id)
            seen.add(away_id)
        # Bye / unpaired teams: keep period alignment with a self bye.
        for tid, team in by_id.items():
            if tid in seen:
                continue
            week = (event.get("teams") or {}).get(str(tid)) or {}
            team["schedule"].append(tid)
            team["scores"].append(float(week.get("week_total") or 0.0))
            team["outcomes"].append("U")

    return teams
