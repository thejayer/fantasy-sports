"""Skater roles from ice time — ported from Rinkside ``nhl.skater_roles``.

Line / pair comes from each club's even-strength ice-time ranking and PP unit
from power-play ice time, using the best sample available: last 14 days (3+
GP), this season (3+ GP), else last season (10+ GP) when he was on the same
club. Trends compare the last 14 days with the longer baseline. H4 (Daily
Faceoff lines) will override these estimates when it lands.
"""

from __future__ import annotations

from typing import Any

from nhl.match import grp
from nhl.teams import last_team

# (label, min GP) in preference order.
_SAMPLES = (("last 14 days", 3), ("this season", 3), ("last season", 10))


def skater_roles(
    nhl_players: dict[int, dict[str, Any]],
    recent: dict[int, dict[str, Any]],
    season: dict[int, dict[str, Any]],
    last: dict[int, dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    """``{nhl_id: {basis, line, pp, ev_min, pp_min, trend}}`` for every skater."""
    info: dict[int, dict[str, Any]] = {}
    by_team: dict[str, list[tuple[int, str, dict[str, Any]]]] = {}
    tables = {"last 14 days": recent, "this season": season, "last season": last}
    for pid, p in nhl_players.items():
        group = grp(p.get("pos"))
        if group == "G":
            continue
        basis, row = "no NHL ice time", None
        for label, min_gp in _SAMPLES:
            r = tables[label].get(pid)
            if r and r["gp"] >= min_gp and r.get("ev") is not None:
                if label == "last season" and last_team(r.get("teams")) not in (None, p.get("team")):
                    basis = "new team, no games yet"
                    break
                basis, row = label, r
                break
        info[pid] = {"basis": basis, "line": None, "pp": None, "ev_min": None,
                     "pp_min": None, "trend": []}
        if row is not None and p.get("team"):
            info[pid].update(ev_min=round(row["ev"], 1), pp_min=round(row.get("pp") or 0.0, 1))
            by_team.setdefault(p["team"], []).append((pid, group, row))

        # Promotions / demotions: last 14 days vs the longer baseline.
        now = recent.get(pid)
        base = season.get(pid) if (season.get(pid) or {}).get("gp", 0) >= 8 else None
        prior = last.get(pid) or {}
        if base is None and prior.get("gp", 0) >= 20 and last_team(prior.get("teams")) == p.get("team"):
            base = prior
        if now and now["gp"] >= 3 and base and now.get("ev") is not None and base.get("ev") is not None:
            d_ev = now["ev"] - base["ev"]
            d_pp = (now.get("pp") or 0.0) - (base.get("pp") or 0.0)
            if d_ev >= 1.5:
                info[pid]["trend"].append(f"even-strength time up {d_ev:.1f} min")
            elif d_ev <= -1.5:
                info[pid]["trend"].append(f"even-strength time down {abs(d_ev):.1f} min")
            if d_pp >= 0.75:
                info[pid]["trend"].append(f"PP time up {d_pp:.1f} min")
            elif d_pp <= -0.75:
                info[pid]["trend"].append(f"PP time down {abs(d_pp):.1f} min")

    for players in by_team.values():
        forwards = sorted((x for x in players if x[1] == "F"), key=lambda x: -x[2]["ev"])
        for i, (pid, _, _) in enumerate(forwards):
            info[pid]["line"] = f"Line {min(i // 3 + 1, 4)}"
        dmen = sorted((x for x in players if x[1] == "D"), key=lambda x: -x[2]["ev"])
        for i, (pid, _, _) in enumerate(dmen):
            info[pid]["line"] = f"Pair {min(i // 2 + 1, 3)}"

        # Power-play units: usually 4 forwards + 1 defenseman (the quarterback).
        pp_f = sorted((x for x in players if x[1] == "F"), key=lambda x: -(x[2].get("pp") or 0))
        pp_d = sorted((x for x in players if x[1] == "D"), key=lambda x: -(x[2].get("pp") or 0))
        for pid, _, _ in players:
            info[pid]["pp"] = "No PP"
        pp1_f = [x for x in pp_f[:4] if (x[2].get("pp") or 0) >= 1.0]
        pp1_d = [x for x in pp_d[:1] if (x[2].get("pp") or 0) >= 1.0]
        # A second D makes PP1 only on a genuine 2-D unit: close to the top D's
        # PP time AND more than the 4th forward's.
        if len(pp_d) > 1 and pp1_d and len(pp1_f) == 4:
            d2, top_d, f4 = (pp_d[1][2].get("pp") or 0), (pp_d[0][2].get("pp") or 0), (
                pp1_f[-1][2].get("pp") or 0
            )
            if d2 >= 0.85 * top_d and d2 > f4:
                pp1_d.append(pp_d[1])
                pp1_f = pp1_f[:3]
        pp1 = {x[0] for x in pp1_f + pp1_d}
        rest_f = [x for x in pp_f if x[0] not in pp1]
        rest_d = [x for x in pp_d if x[0] not in pp1]
        pp2 = {x[0] for x in rest_f[:4] + rest_d[:1] if (x[2].get("pp") or 0) >= 0.4}
        for pid in pp1:
            info[pid]["pp"] = "PP1"
        for pid in pp2:
            info[pid]["pp"] = "PP2"
    return info
