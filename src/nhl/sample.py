"""Synthetic NHL API for fixtures and ``sj seed`` (offline, deterministic).

Builds NHL-API-shaped JSON from a hockey snapshot's own ESPN players and
serves it through :class:`nhl.nhl_api.NHLClient`, so committed fixtures run
the same parsers, matcher, and exporter as a live sync. Everything here is
fabricated — names come from the synthetic snapshot, numbers from a seeded
RNG. Some players are deliberately hard to match (abbreviated first names,
off-roster players only the search finds, a few with no NHL record) so the
fixture exercises every match method and a non-empty ``unmatched`` list.
"""

from __future__ import annotations

import datetime as dt
import random
import re
from typing import Any

from nhl.export import build_nhl_documents, espn_players
from nhl.match import grp, norm
from nhl.nhl_api import SEARCH, STATS, WEB, NHLClient, prior_season_ids, season_id
from nhl.teams import NHL_ABBREVS, NHL_NAMES, nhl_abbrev

_NHL_POS = {"C": "C", "LW": "L", "RW": "R", "F": "C", "D": "D", "G": "G"}
_SEASON_START = {"month": 10, "day": 7}
_SCHEDULE_DAYS = 14


def _position_code(espn_position: Any) -> str:
    raw = str(espn_position or "").upper()
    if raw in _NHL_POS:
        return _NHL_POS[raw]
    group = grp(raw)
    return {"G": "G", "D": "D"}.get(group, "C")


class SampleNhl:
    """In-memory NHL built from one snapshot. Call as a ``fetch(url, params)``."""

    def __init__(self, snapshot: dict[str, Any]) -> None:
        self.season = int(snapshot["season"])
        self.cur = season_id(self.season)
        self.prior = prior_season_ids(self.season, 3)
        rng = random.Random(f"{snapshot.get('league_id')}:{self.season}:nhl")
        self.players: dict[int, dict[str, Any]] = {}
        self.roster_ids: set[int] = set()
        self.lines: dict[str, dict[int, dict[str, Any]]] = {s: {} for s in self.prior}
        for index, row in enumerate(espn_players(snapshot)):
            if index % 37 == 13:
                continue  # no NHL record at all → stays unmatched
            nhl_id = 8_470_000 + index
            first, _, last = str(row.get("name") or "").partition(" ")
            if index % 11 == 5 and first:
                first = f"{first[0]}."  # "J. Smith" → initial + last name match
            pos = _position_code(row.get("position"))
            team = nhl_abbrev(row.get("pro_team")) or rng.choice(NHL_ABBREVS)
            born = dt.date(rng.randint(1992, 2006), rng.randint(1, 12), rng.randint(1, 28))
            player = {
                "id": nhl_id,
                "first": first,
                "last": last,
                "pos": pos,
                "birth": born.isoformat(),
                "team": team,
                "height": rng.randint(68, 79),
                "weight": rng.randint(170, 232),
                "rookie": index % 9 == 4,
                "draft_pick": rng.randint(1, 200),
            }
            self.players[nhl_id] = player
            if index % 17 != 8:  # off-roster players are only reachable by search
                self.roster_ids.add(nhl_id)
            if not player["rookie"]:
                for depth, sid in enumerate(self.prior):
                    if depth and rng.random() < 0.25:
                        continue
                    self.lines[sid][nhl_id] = self._line(rng, player, depth)
        self.team_rows = {
            sid: [self._team_row(rng, abbrev) for abbrev in NHL_ABBREVS] for sid in self.prior
        }
        self.slate = self._slate(rng)

    # --- fabricated tables --------------------------------------------------
    @staticmethod
    def _line(rng: random.Random, player: dict[str, Any], depth: int) -> dict[str, Any]:
        moved = depth == 0 and rng.random() < 0.12
        teams = f"{rng.choice(NHL_ABBREVS)},{player['team']}" if moved else player["team"]
        gp = rng.randint(30, 82)
        if player["pos"] == "G":
            starts = rng.randint(max(1, gp // 3), gp)
            shots = starts * rng.randint(25, 31)
            ga = int(shots * rng.uniform(0.085, 0.115))
            wins = rng.randint(starts // 4, max(starts // 4, starts * 3 // 5))
            return {"gamesPlayed": gp, "gamesStarted": starts, "wins": wins,
                    "losses": max(0, starts - wins - rng.randint(0, 5)), "goalsAgainst": ga,
                    "saves": shots - ga, "shutouts": rng.randint(0, 5), "teamAbbrevs": teams}
        defense = player["pos"] == "D"
        goals = rng.randint(1, 12 if defense else 40)
        assists = rng.randint(4, 45 if defense else 55)
        ppg = rng.randint(0, goals // 3)
        shg = rng.randint(0, 2)
        return {
            "gamesPlayed": gp, "goals": goals, "assists": assists,
            "ppGoals": ppg, "ppPoints": ppg + rng.randint(0, assists // 3),
            "shGoals": shg, "shPoints": shg + rng.randint(0, 2),
            "gameWinningGoals": rng.randint(0, max(1, goals // 6)),
            "shots": rng.randint(goals * 5, goals * 9 + 40),
            "hits": rng.randint(10, 220), "blockedShots": rng.randint(5, 160 if defense else 50),
            "timeOnIcePerGame": rng.randint(12 * 60, 26 * 60 if defense else 22 * 60),
            "evTimeOnIcePerGame": rng.randint(10 * 60, 20 * 60 if defense else 17 * 60),
            "ppTimeOnIcePerGame": rng.choice((0, 30, 70, 120, 170, 210)),
            "shTimeOnIcePerGame": rng.choice((0, 15, 60, 110)),
            "teamAbbrevs": teams,
        }

    @staticmethod
    def _team_row(rng: random.Random, abbrev: str) -> dict[str, Any]:
        return {
            "teamFullName": NHL_NAMES[abbrev],
            "gamesPlayed": 82,
            "goalsForPerGame": round(rng.uniform(2.5, 3.7), 3),
            "goalsAgainstPerGame": round(rng.uniform(2.5, 3.7), 3),
            "shotsForPerGame": round(rng.uniform(26.0, 33.5), 2),
            "shotsAgainstPerGame": round(rng.uniform(26.0, 33.5), 2),
            "penaltyKillPct": round(rng.uniform(0.74, 0.86), 4),
            "powerPlayPct": round(rng.uniform(0.15, 0.28), 4),
        }

    def _slate(self, rng: random.Random) -> list[dict[str, Any]]:
        start = dt.date(self.season - 1, _SEASON_START["month"], _SEASON_START["day"])
        games = []
        for offset in range(_SCHEDULE_DAYS):
            day = start + dt.timedelta(days=offset)
            teams = list(NHL_ABBREVS)
            rng.shuffle(teams)
            playing = teams[: rng.choice((8, 10, 12, 16))]
            for home, away in zip(playing[::2], playing[1::2], strict=True):
                games.append({"gameDate": day.isoformat(), "gameType": 2,
                              "homeTeam": {"abbrev": home}, "awayTeam": {"abbrev": away},
                              "startTimeUTC": f"{day.isoformat()}T23:00:00Z"})
        return games

    # --- fetch --------------------------------------------------------------
    def __call__(self, url: str, params: dict[str, Any] | None = None) -> Any:
        params = params or {}
        if url.startswith(f"{WEB}/roster/"):
            team = url.split("/")[-2]
            return self._roster(team)
        if url.startswith(f"{WEB}/club-schedule-season/"):
            team = url.split("/")[-2]
            return {"games": [g for g in self.slate
                              if team in (g["homeTeam"]["abbrev"], g["awayTeam"]["abbrev"])]}
        if url.startswith(f"{WEB}/player/"):
            return self._landing(int(url.split("/")[-2]))
        if url == f"{STATS}/season":
            return {"data": [{"id": int(self.cur), "numberOfGames": 82,
                              "startDate": f"{self.season - 1}-10-07T00:00:00",
                              "regularSeasonEndDate": f"{self.season}-04-15T00:00:00"}]}
        if url.startswith(STATS):
            kind, report = url[len(STATS) + 1:].split("/")[:2]
            match = re.search(r"seasonId=(\d{8})", str(params.get("cayenneExp", "")))
            return {"data": self._report(kind, report, match.group(1) if match else "")}
        if url == SEARCH:
            return self._search(str(params.get("q", "")), active=params.get("active") == "true")
        raise KeyError(f"sample NHL has no route for {url}")

    def _roster(self, team: str) -> dict[str, Any]:
        out: dict[str, list[dict[str, Any]]] = {"forwards": [], "defensemen": [], "goalies": []}
        for pid in sorted(self.roster_ids):
            p = self.players[pid]
            if p["team"] != team:
                continue
            section = {"G": "goalies", "D": "defensemen"}.get(p["pos"], "forwards")
            out[section].append({
                "id": pid, "firstName": {"default": p["first"]}, "lastName": {"default": p["last"]},
                "positionCode": p["pos"], "birthDate": p["birth"],
                "heightInInches": p["height"], "weightInPounds": p["weight"],
            })
        return out

    def _report(self, kind: str, report: str, sid: str) -> list[dict[str, Any]]:
        if kind == "team":
            return self.team_rows.get(sid, [])
        out = []
        for pid, line in sorted(self.lines.get(sid, {}).items()):
            is_goalie = self.players[pid]["pos"] == "G"
            if (kind == "goalie") != is_goalie:
                continue
            out.append({"playerId": pid, **line})
        return out

    def _landing(self, pid: int) -> dict[str, Any]:
        p = self.players[pid]
        pick = p["draft_pick"]
        birth_year = int(p["birth"][:4])
        totals = []
        if p["rookie"]:
            for back in (1, 2):
                start = self.season - 1 - back
                totals.append({
                    "season": int(f"{start}{start + 1}"), "gameTypeId": 2,
                    "leagueAbbrev": ("AHL", "OHL")[back - 1],
                    "teamName": {"default": "Sample Juniors"},
                    "gamesPlayed": 40 + 10 * back, "goals": 18 - 4 * back,
                    "assists": 25 - 5 * back, "points": 43 - 9 * back,
                })
        return {
            "birthDate": p["birth"], "heightInInches": p["height"], "weightInPounds": p["weight"],
            "position": p["pos"], "currentTeamAbbrev": p["team"],
            "draftDetails": {"year": birth_year + 18, "round": (pick - 1) // 32 + 1,
                             "pickInRound": (pick - 1) % 32 + 1, "overallPick": pick,
                             "teamAbbrev": p["team"]},
            "seasonTotals": totals,
        }

    def _search(self, q: str, *, active: bool) -> list[dict[str, Any]]:
        wanted = norm(q)
        hits = []
        for pid, p in sorted(self.players.items()):
            name = f"{p['first']} {p['last']}"
            if norm(name) != wanted:
                continue
            on_roster = pid in self.roster_ids
            if active and not on_roster:
                continue
            hits.append({
                "playerId": pid, "name": name, "positionCode": p["pos"],
                "teamAbbrev": p["team"] if on_roster else None,
                "lastTeamAbbrev": p["team"], "active": on_roster, "birthDate": p["birth"],
                "heightInInches": p["height"], "weightInPounds": p["weight"],
            })
        return hits


def sample_nhl_documents(
    snapshot: dict[str, Any], *, generated_at: str
) -> dict[str, dict[str, Any]]:
    """The four H1 documents for a synthetic hockey snapshot."""
    as_of = dt.datetime.fromisoformat(generated_at.replace("Z", "+00:00")).date()
    result = build_nhl_documents(
        snapshot,
        NHLClient(fetch=SampleNhl(snapshot), throttle=0.0),
        as_of=as_of,
        generated_at=generated_at,
        search_max=200,
        landing_max=200,
    )
    return result.documents
