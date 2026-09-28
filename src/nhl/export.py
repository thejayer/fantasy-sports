"""Build and write the H1 NHL artifacts (HOCKEY-PORT.md H1).

Per hockey league-season, under ``{league}/{season}/nhl/``:

* ``player_map.json`` — ESPN id → NHL id, match method, coverage
* ``nhl_context.json`` — age, ht/wt, team, prior team, TOI (EV/PP), goalie
  start share, recent NHL stat lines, draft/minors for rookies
* ``schedule.json`` — every club's regular season, back-to-backs flagged
* ``team_strength.json`` — GF/GA/SF/SA per game, PK%, PP%, blended with last
  season until ~15 games in

Sync-time only. Values are what the NHL reports; missing data is ``null``,
never 0. Partial NHL failures (one roster, one schedule) are recorded in each
document's ``errors`` instead of failing the ESPN sync.
"""

from __future__ import annotations

import datetime as dt
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from nhl.match import Matcher, grp, norm, pick_search_hit
from nhl.nhl_api import (
    NHLClient,
    age_on,
    parse_goalie_lines,
    parse_skater_lines,
    parse_team_summary,
    parse_toi_rows,
    prior_season_ids,
    season_id,
    summarize_landing,
)
from nhl.teams import NHL_ABBREVS, NHL_NAMES, last_team

ARTIFACTS = ("player_map", "nhl_context", "schedule", "team_strength")
SCHEMA_VERSION = 1

DEFAULT_SEARCH_MAX = 80
DEFAULT_LANDING_MAX = 60
# Rinkside thresholds: trust a TOI sample at 3+ GP this season, 10+ last season.
MIN_TOI_GP_CURRENT = 3
MIN_TOI_GP_PRIOR = 10
# Goalie start share: this season once a team's goalies have 6+ starts.
MIN_TEAM_STARTS_CURRENT = 6
# Team strength: this season's rate earns full weight at 15 GP.
TEAM_BLEND_GAMES = 15


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def nhl_sync_enabled() -> bool:
    """``SJ_NHL_SYNC=0`` turns the post-sync NHL export off."""
    return os.environ.get("SJ_NHL_SYNC", "1").strip().lower() not in {"0", "false", "no", "off"}


@dataclass
class NhlExport:
    documents: dict[str, dict[str, Any]]
    coverage: float | None
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# ESPN side
# ---------------------------------------------------------------------------
def espn_players(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """Rostered players (with fantasy team) then free agents, one row per ESPN id."""
    out: list[dict[str, Any]] = []
    seen: set[Any] = set()
    for team in snapshot.get("teams") or []:
        for player in team.get("roster") or []:
            pid = player.get("id")
            if pid is None or pid in seen:
                continue
            seen.add(pid)
            out.append({**player, "_rostered": True, "_team_id": team.get("team_id")})
    for player in snapshot.get("free_agents") or []:
        pid = player.get("id")
        if pid is None or pid in seen:
            continue
        seen.add(pid)
        out.append({**player, "_rostered": False, "_team_id": None})
    return out


# ---------------------------------------------------------------------------
# derived values
# ---------------------------------------------------------------------------
def toi_context(
    nhl_id: int,
    team: str | None,
    current: dict[int, dict[str, Any]],
    prior: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    """Per-game ice time from the best sample (Rinkside ``skater_roles`` rules)."""
    row, basis = None, None
    cur = current.get(nhl_id)
    if cur and cur["gp"] >= MIN_TOI_GP_CURRENT:
        row, basis = cur, "this season"
    else:
        last = prior.get(nhl_id)
        if last and last["gp"] >= MIN_TOI_GP_PRIOR:
            moved = last_team(last.get("teams")) not in (None, team)
            row, basis = last, ("last season, other team" if moved else "last season")
    if row is None:
        return {"basis": None, "gp": None, "toi_min": None, "ev_min": None, "pp_min": None,
                "sh_min": None}
    return {
        "basis": basis,
        "gp": row["gp"],
        "toi_min": row.get("toi"),
        "ev_min": row.get("ev"),
        "pp_min": row.get("pp"),
        "sh_min": row.get("sh"),
    }


def goalie_shares(
    nhl_players: dict[int, dict[str, Any]],
    current: dict[int, dict[str, Any]],
    prior: dict[int, dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    """Share of a club's starts among its current goalies (Rinkside ``goalie_roles``)."""
    by_team: dict[str, list[int]] = {}
    for pid, p in nhl_players.items():
        if grp(p.get("pos")) == "G" and p.get("team"):
            by_team.setdefault(p["team"], []).append(pid)
    out: dict[int, dict[str, Any]] = {}
    for gids in by_team.values():
        cur_total = sum((current.get(g) or {}).get("GS", 0) for g in gids)
        basis, table = (
            ("this season", current) if cur_total >= MIN_TEAM_STARTS_CURRENT else ("last season", prior)
        )
        total = sum((table.get(g) or {}).get("GS", 0) for g in gids)
        for g in gids:
            gs = (table.get(g) or {}).get("GS", 0)
            share = round(gs / total, 3) if total else None
            role = None
            if share is not None:
                role = "Starter" if share >= 0.55 else ("1A/1B" if share >= 0.38 else "Backup")
            out[g] = {"basis": basis if total else None, "gs": gs if total else None,
                      "start_share": share, "role": role}
    return out


def team_strength(
    current: dict[str, dict[str, Any]], prior: dict[str, dict[str, Any]]
) -> tuple[dict[str, dict[str, Any]], dict[str, float | None]]:
    """Blend this season into last season by games played (Rinkside ``team_ratings``)."""
    teams: dict[str, dict[str, Any]] = {}
    for abbrev in NHL_ABBREVS:
        cur, prev = current.get(abbrev) or {}, prior.get(abbrev) or {}
        if not cur and not prev:
            continue
        gp = cur.get("gp") or 0
        weight = round(min(gp / TEAM_BLEND_GAMES, 1.0), 3) if gp else 0.0

        def blend(key: str, *, cur: dict = cur, prev: dict = prev, weight: float = weight):
            c, p = cur.get(key), prev.get(key)
            if c is None and p is None:
                return None
            if c is None:
                return p
            if p is None:
                return c
            return round(weight * c + (1 - weight) * p, 4)

        teams[abbrev] = {
            "name": cur.get("name") or prev.get("name") or NHL_NAMES.get(abbrev),
            "gp": gp,
            "weight_current": weight,
            **{key: blend(key) for key in ("gf", "ga", "sf", "sa", "pk", "pp")},
        }
    avg: dict[str, float | None] = {}
    for key in ("gf", "ga", "sf", "sa", "pk", "pp"):
        vals = [t[key] for t in teams.values() if t[key] is not None]
        avg[key] = round(sum(vals) / len(vals), 4) if vals else None
    return teams, avg


def _stat_line(line: dict[str, Any] | None) -> dict[str, Any] | None:
    if not line:
        return None
    return {k: v for k, v in line.items() if k != "teams"}


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
def build_nhl_documents(
    snapshot: dict[str, Any],
    client: NHLClient,
    *,
    as_of: dt.date,
    generated_at: str,
    search_max: int | None = None,
    landing_max: int | None = None,
) -> NhlExport:
    """Fetch everything H1 needs and assemble the four documents."""
    league_id = str(snapshot["league_id"])
    season = int(snapshot["season"])
    cur_id = season_id(season)
    prior_ids = prior_season_ids(season, 3)
    search_cap = _env_int("SJ_NHL_SEARCH_MAX", DEFAULT_SEARCH_MAX) if search_max is None else search_max
    landing_cap = (
        _env_int("SJ_NHL_LANDING_MAX", DEFAULT_LANDING_MAX) if landing_max is None else landing_max
    )
    errors: list[str] = []

    def attempt(label: str, fn: Any, default: Any) -> Any:
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - record and keep going
            errors.append(f"{label}: {exc}")
            return default

    # --- NHL player pool (current rosters) --------------------------------
    nhl_players: dict[int, dict[str, Any]] = {}
    for team in NHL_ABBREVS:
        for p in attempt(f"roster {team}", lambda team=team: client.roster(team), []):
            nhl_players[p["id"]] = p
    if not nhl_players:
        raise RuntimeError("NHL rosters unavailable: " + "; ".join(errors[:3]))

    # --- bulk season tables -----------------------------------------------
    seasons = [cur_id, *prior_ids]
    skaters: dict[str, dict[int, dict[str, Any]]] = {}
    goalies: dict[str, dict[int, dict[str, Any]]] = {}
    toi: dict[str, dict[int, dict[str, Any]]] = {}
    for sid in seasons:
        summary = attempt(f"skater summary {sid}",
                          lambda sid=sid: client.season_report("skater", "summary", sid), [])
        realtime = attempt(f"skater realtime {sid}",
                           lambda sid=sid: client.season_report("skater", "realtime", sid), [])
        skaters[sid] = parse_skater_lines(summary, realtime)
        goalies[sid] = parse_goalie_lines(
            attempt(f"goalie summary {sid}",
                    lambda sid=sid: client.season_report("goalie", "summary", sid), [])
        )
        if sid in (cur_id, prior_ids[0]):
            toi[sid] = parse_toi_rows(
                attempt(f"skater timeonice {sid}",
                        lambda sid=sid: client.season_report("skater", "timeonice", sid), [])
            )
    team_now = parse_team_summary(
        attempt(f"team summary {cur_id}", lambda: client.season_report("team", "summary", cur_id), [])
    )
    team_prev = parse_team_summary(
        attempt(f"team summary {prior_ids[0]}",
                lambda: client.season_report("team", "summary", prior_ids[0]), [])
    )

    # --- ESPN → NHL map ----------------------------------------------------
    matcher = Matcher(nhl_players)
    rows = espn_players(snapshot)
    mapped: dict[str, dict[str, Any]] = {}
    unmatched: list[dict[str, Any]] = []
    searched_ids: set[int] = set()
    searches = 0
    for row in rows:
        group = grp(row.get("position"))
        hit, method = matcher.match(row.get("name"), group, row.get("pro_team"))
        if hit is None and searches < search_cap and row.get("name"):
            searches += 1
            hits = attempt(f"search {row.get('name')}",
                           lambda row=row: client.search_player(str(row["name"])), [])
            found = pick_search_hit(hits, row.get("name"), group, row.get("pro_team"))
            if found is not None and found.get("playerId") is not None:
                nid = int(found["playerId"])
                hit = nhl_players.get(nid)
                if hit is None:
                    first, _, last = str(found.get("name", "")).partition(" ")
                    hit = {
                        "id": nid,
                        "first": first,
                        "last": last,
                        "pos": found.get("positionCode"),
                        "birth": found.get("birthDate"),
                        "team": found.get("teamAbbrev") or None,
                        "height": found.get("heightInInches"),
                        "weight": found.get("weightInPounds"),
                        "_from_search": True,
                    }
                    nhl_players[nid] = hit
                searched_ids.add(nid)
                method = "search"
        espn_team = row.get("pro_team")
        if hit is None:
            unmatched.append({
                "espn_id": row.get("id"),
                "name": row.get("name"),
                "position": row.get("position"),
                "pro_team": espn_team,
                "rostered": row["_rostered"],
            })
            continue
        mapped[str(row["id"])] = {
            "nhl_id": hit["id"],
            "espn_name": row.get("name"),
            "nhl_name": f"{hit.get('first') or ''} {hit.get('last') or ''}".strip(),
            "group": group,
            "espn_team": espn_team,
            "nhl_team": hit.get("team"),
            "method": method,
            "rostered": row["_rostered"],
        }

    def rate(subset: list[dict[str, Any]]) -> dict[str, Any]:
        total = len(subset)
        hit = sum(1 for r in subset if str(r.get("id")) in mapped)
        return {"total": total, "matched": hit, "rate": round(hit / total, 4) if total else None}

    rostered = [r for r in rows if r["_rostered"]]
    by_method: dict[str, int] = {}
    for entry in mapped.values():
        by_method[entry["method"]] = by_method.get(entry["method"], 0) + 1
    coverage = {
        "rostered": rate(rostered),
        "free_agents": rate([r for r in rows if not r["_rostered"]]),
        "all": rate(rows),
        "by_method": dict(sorted(by_method.items())),
    }

    # --- context for matched NHL players ------------------------------------
    matched_ids = sorted({entry["nhl_id"] for entry in mapped.values()})
    shares = goalie_shares(nhl_players, goalies[cur_id], goalies[prior_ids[0]])

    def history(nid: int, group: str) -> list[dict[str, Any]]:
        table = goalies if group == "G" else skaters
        out = []
        for sid in seasons:
            line = table[sid].get(nid)
            if line and line.get("GP"):
                out.append({"season": sid, "team": last_team(line.get("teams")),
                            **(_stat_line(line) or {})})
        return out

    # Landing pages: search-only players plus anyone with no NHL games in the
    # fetched seasons (rookies / prospects) — capped so a sync stays polite.
    landing_ids = [nid for nid in matched_ids if nid in searched_ids]
    landing_ids += [
        nid for nid in matched_ids
        if nid not in searched_ids and not history(nid, grp(nhl_players[nid].get("pos")))
    ]
    landings: dict[int, dict[str, Any]] = {}
    for nid in landing_ids[:landing_cap]:
        doc = attempt(f"landing {nid}", lambda nid=nid: client.player_landing(nid), None)
        if doc:
            landings[nid] = summarize_landing(doc, cur_id)
    if len(landing_ids) > landing_cap:
        errors.append(f"landing pages capped at {landing_cap} of {len(landing_ids)}")

    context: dict[str, dict[str, Any]] = {}
    for nid in matched_ids:
        p = nhl_players[nid]
        group = grp(p.get("pos"))
        land = landings.get(nid) or {}
        team = p.get("team") or land.get("team")
        birth = p.get("birth") or land.get("birth")
        seasons_played = history(nid, group)
        prior_line = next((h for h in seasons_played if h["season"] == prior_ids[0]), None)
        prior_team = prior_line.get("team") if prior_line else None
        entry: dict[str, Any] = {
            "nhl_id": nid,
            "name": f"{p.get('first') or ''} {p.get('last') or ''}".strip(),
            "position": p.get("pos"),
            "group": group,
            "team": team,
            "prior_team": prior_team if prior_team and prior_team != team else None,
            "birth_date": birth,
            "age": age_on(birth, as_of),
            "height_in": p.get("height") if p.get("height") is not None else land.get("height"),
            "weight_lb": p.get("weight") if p.get("weight") is not None else land.get("weight"),
            "on_nhl_roster": not p.get("_from_search", False),
            "history": seasons_played,
        }
        if group == "G":
            entry["goalie"] = shares.get(nid) or {
                "basis": None, "gs": None, "start_share": None, "role": None
            }
            entry["toi"] = None
        else:
            entry["toi"] = toi_context(nid, team, toi.get(cur_id, {}), toi.get(prior_ids[0], {}))
        if land:
            entry["prior_nhl_gp"] = land.get("prior_nhl_gp")
            entry["draft"] = land.get("draft")
            entry["minors"] = land.get("minors")
        context[str(nid)] = entry

    # --- schedule -----------------------------------------------------------
    schedule: dict[str, list[dict[str, Any]]] = {}
    for team in NHL_ABBREVS:
        games = attempt(f"schedule {team}",
                        lambda team=team: client.club_schedule(team, cur_id), None)
        if games is not None:
            schedule[team] = games

    strength, league_avg = team_strength(team_now, team_prev)

    def header() -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "league_id": league_id,
            "season": season,
            "sport": "hockey",
            "nhl_season": cur_id,
            "generated_at": generated_at,
            "source": "api-web.nhle.com + api.nhle.com/stats",
        }

    documents = {
        "player_map": {
            **header(),
            "coverage": coverage,
            "players": mapped,
            "unmatched": unmatched,
        },
        "nhl_context": {
            **header(),
            "as_of": as_of.isoformat(),
            "seasons": seasons,
            "players": context,
        },
        "schedule": {
            **header(),
            "teams": schedule,
            "game_count": sum(len(g) for g in schedule.values()) // 2,
        },
        "team_strength": {
            **header(),
            "seasons": [cur_id, prior_ids[0]],
            "blend_games": TEAM_BLEND_GAMES,
            "teams": strength,
            "league_avg": league_avg,
        },
    }
    for doc in documents.values():
        doc["errors"] = list(errors)
    return NhlExport(
        documents=documents,
        coverage=coverage["rostered"]["rate"],
        errors=errors,
    )


def _as_of(snapshot: dict[str, Any]) -> tuple[dt.date, str]:
    stamp = snapshot.get("synced_at")
    if isinstance(stamp, str) and stamp:
        try:
            when = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            return when.date(), when.isoformat()
        except ValueError:
            pass
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    return now.date(), now.isoformat()


def export_nhl(
    snapshot: dict[str, Any],
    *,
    client: NHLClient | None = None,
    store_dir: Path | str | None = None,
    store: Any = None,
    fail_below: float | None = None,
) -> NhlExport:
    """Build the four H1 documents for one hockey snapshot and write them.

    ``store`` (a :class:`sj.store.FileStore` / ``GcsStore``) wins over
    ``store_dir``. Raises ``RuntimeError`` when rostered coverage is under
    ``fail_below`` — after writing, so the unmatched list is inspectable.
    """
    if snapshot.get("sport") != "hockey":
        raise ValueError(f"{snapshot.get('league_id')}: not a hockey snapshot")
    as_of, generated_at = _as_of(snapshot)
    result = build_nhl_documents(
        snapshot, client or NHLClient(), as_of=as_of, generated_at=generated_at
    )
    if store is None:
        from sj.store import resolve_store

        store = resolve_store(store_dir)
    for name in ARTIFACTS:
        store.write_nhl(result.documents[name], name)
    if fail_below is not None and (result.coverage or 0.0) < fail_below:
        raise RuntimeError(
            f"player map coverage {result.coverage!r} below {fail_below} "
            f"({len(result.documents['player_map']['unmatched'])} unmatched)"
        )
    return result


__all__ = [
    "ARTIFACTS",
    "NhlExport",
    "build_nhl_documents",
    "espn_players",
    "export_nhl",
    "goalie_shares",
    "nhl_sync_enabled",
    "norm",
    "team_strength",
    "toi_context",
]
