"""Prospect estimate — ported from Rinkside ``nhl.prospect_fpg``.

NHL-equivalency (NHLe) factors translate minor / college / junior / European
scoring to NHL rates, scaled up for players who did it young, then regressed
toward what rookies drafted in that range typically produce in this league's
scoring. Goalies translate save % instead. An estimate, labeled as such.
"""

from __future__ import annotations

from typing import Any

from nhl.aging import season_age

# Share of a scoring rate that typically carries to the NHL (published NHLe
# research, rounded). Unknown leagues get a conservative default.
NHLE = {
    "KHL": 0.77, "SHL": 0.57, "NL": 0.46, "LIIGA": 0.44, "SM-LIIGA": 0.44, "DEL": 0.40,
    "CZECHIA": 0.40, "ELH": 0.40, "AHL": 0.39, "ALLSVENSKAN": 0.30, "HOCKEYALLSVENSKAN": 0.30,
    "VHL": 0.28, "ICEHL": 0.25, "NCAA": 0.19, "MESTIS": 0.20, "ECHL": 0.15, "OHL": 0.14,
    "WHL": 0.14, "QMJHL": 0.11, "USHL": 0.11, "MHL": 0.10, "USDP": 0.10, "USNTDP": 0.10,
    "J20 NATIONELL": 0.08, "U20 SM-SARJA": 0.08,
}
DEFAULT_NHLE = 0.10
# The same numbers mean more from a younger player.
AGE_MULTIPLIER = {16: 2.0, 17: 1.8, 18: 1.5, 19: 1.25, 20: 1.1}
# NHL save % runs below minor-league save %: AHL .910 ≈ NHL .902, etc.
MINOR_SV_ADJ = {"AHL": 0.008, "KHL": 0.006, "SHL": 0.008}
DEFAULT_SV_ADJ = 0.015


def _league_key(abbrev: Any) -> str:
    return str(abbrev or "").upper().replace(".", "").strip()


def draft_prior(pick: int | None, is_d: bool) -> tuple[float, float]:
    """(prior FP/G, share of the NHLe estimate kept) by draft slot."""
    if pick and pick <= 3:
        return 2.3, 0.8
    if pick and pick <= 10:
        return 1.7, 0.75
    if pick and pick <= 32:
        return 1.35, 0.7
    return (1.2 if is_d else 1.1), 0.7


def prospect_fpg(
    minors: list[dict[str, Any]],
    *,
    birth: Any,
    position: Any,
    draft_pick: int | None,
    weights: dict[str, float],
) -> tuple[float | None, str | None]:
    """(estimated NHL FP per game, explanation) or (None, None) without data.

    ``minors`` rows are ``nhl_context`` shape: ``season`` ("20242025"),
    ``league``, ``gp``, ``g``, ``a``, ``pts``, ``sv_pct``; newest first.
    """
    seasons = [m for m in minors or [] if (m.get("gp") or 0) > 0]
    if not seasons:
        return None, None
    is_goalie = str(position or "").upper().startswith("G")
    if is_goalie:
        best = seasons[0]
        sv = best.get("sv_pct")
        if not sv:
            return None, None
        nhl_sv = float(sv) - MINOR_SV_ADJ.get(_league_key(best.get("league")), DEFAULT_SV_ADJ)
        shots, base = 28.0, 4.3  # a typical NHL start in this league's scoring
        per_shot = weights.get("SV", 0) - weights.get("GA", 0)  # a save instead of a goal
        est = base + (nhl_sv - 0.900) * shots * per_shot
        est = 0.7 * est + 0.3 * base
        return round(est, 2), f"{best.get('league')} sv% {float(sv):.3f}"

    wsum = g_pg = a_pg = 0.0
    used: list[str] = []
    for i, row in enumerate(seasons):
        factor = NHLE.get(_league_key(row.get("league")), DEFAULT_NHLE)
        age = season_age(birth, int(str(row.get("season") or "0")[:4] or 0) or 0)
        factor *= AGE_MULTIPLIER.get(age, 1.0) if age else 1.0
        gp = float(row["gp"])
        w = (2 if i == 0 else 1) * min(gp / 40, 1)
        g_pg += w * factor * (row.get("g") or 0) / gp
        a_pg += w * factor * (row.get("a") or 0) / gp
        wsum += w
        used.append(f"{row.get('league')} {row.get('pts') or 0}pts/{int(gp)}gp")
    if not wsum:
        return None, None
    g_pg, a_pg = g_pg / wsum, a_pg / wsum
    is_d = str(position or "").upper().startswith("D")
    shots = max(0.9, min(g_pg / (0.05 if is_d else 0.10), 2.6 if is_d else 3.2))
    blocks, hits, pp_share = (1.1 if is_d else 0.35), 0.8, 0.25
    fp = (weights.get("G", 0) * g_pg + weights.get("A", 0) * a_pg
          + weights.get("PPG", 0) * g_pg * pp_share + weights.get("PPA", 0) * a_pg * pp_share
          + weights.get("SOG", 0) * shots + weights.get("HIT", 0) * hits
          + weights.get("BLK", 0) * blocks)
    prior, keep = draft_prior(draft_pick, is_d)
    fp = keep * fp + (1 - keep) * prior
    if draft_pick:
        used.append(f"#{draft_pick} overall pick")
    return round(fp, 2), "; ".join(used)
