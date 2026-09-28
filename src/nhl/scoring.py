"""League scoring for hockey (HOCKEY-PORT.md H0).

ESPN is the source of truth: ``sj sync`` stores ``settings.categories`` from
``scoringSettings.scoringItems``, and :func:`league_scoring` reads those.
``configs/hockey_scoring.yaml`` is an override for tests, fixtures, and
sandboxing — never a silent substitute for a league that has real settings.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DEFAULT_OVERRIDE = Path(__file__).resolve().parents[2] / "configs" / "hockey_scoring.yaml"

# espn-api hockey STATS_MAP ids for the stats a points league can weight.
STAT_IDS: dict[str, int] = {
    "GS": 0,
    "W": 1,
    "L": 2,
    "SA": 3,
    "GA": 4,
    "SV": 6,
    "SO": 7,
    "OTL": 9,
    "G": 13,
    "A": 14,
    "+/-": 15,
    "PIM": 17,
    "PPG": 18,
    "PPA": 19,
    "SHG": 20,
    "SHA": 21,
    "GWG": 22,
    "FOW": 23,
    "FOL": 24,
    "HAT": 28,
    "SOG": 29,
    "HIT": 31,
    "BLK": 32,
    "DEF": 33,
    "GP": 34,
    "STPG": 35,
    "STPA": 36,
    "STP": 37,
    "PPP": 38,
    "SHP": 39,
}

LABELS: dict[str, str] = {
    "G": "Goals",
    "A": "Assists",
    "PPG": "Power-Play Goals",
    "PPA": "Power-Play Assists",
    "SHG": "Short-Handed Goals",
    "SHA": "Short-Handed Assists",
    "SHP": "Short-Handed Points",
    "GWG": "Game-Winning Goals",
    "HAT": "Hat Tricks",
    "SOG": "Shots on Goal",
    "HIT": "Hits",
    "BLK": "Blocked Shots",
    "W": "Wins",
    "L": "Losses",
    "GA": "Goals Against",
    "SV": "Saves",
    "SO": "Shutouts",
    "PPP": "Power-Play Points",
    "+/-": "Plus/Minus",
    "PIM": "Penalty Minutes",
    "OTL": "Overtime Losses",
    "GP": "Games Played",
}


@dataclass(frozen=True)
class LeagueScoring:
    """Scoring weights plus lineup shape for one hockey league-season."""

    weights: dict[str, float]
    source: str  # "espn" | "override"
    lineup: dict[str, int] = field(default_factory=dict)
    gp_caps: dict[str, float] = field(default_factory=dict)

    def scoring_items(self) -> list[dict[str, Any]]:
        """ESPN-shaped ``scoringItems`` (fixtures / sample settings)."""
        return [
            {"statId": STAT_IDS[abbr], "statName": LABELS.get(abbr, abbr), "points": pts}
            for abbr, pts in self.weights.items()
            if abbr in STAT_IDS
        ]

    def scoring_format(self) -> list[dict[str, Any]]:
        """Hub ``settings.scoring_format`` rows (id / abbr / label / points)."""
        return [
            {"id": STAT_IDS[abbr], "abbr": abbr, "label": LABELS.get(abbr, abbr), "points": pts}
            for abbr, pts in self.weights.items()
            if abbr in STAT_IDS
        ]


def _float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def load_scoring_override(path: Path | str | None = None) -> LeagueScoring:
    """Read ``configs/hockey_scoring.yaml`` (or ``path``)."""
    target = Path(path) if path is not None else DEFAULT_OVERRIDE
    with target.open(encoding="utf-8") as fh:
        raw: dict[str, Any] = yaml.safe_load(fh) or {}
    weights = {
        str(k): v
        for k, v in ((k, _float(v)) for k, v in (raw.get("scoring") or {}).items())
        if v is not None
    }
    lineup = {str(k): int(v) for k, v in (raw.get("lineup") or {}).items()}
    caps = {
        str(k): v
        for k, v in ((k, _float(v)) for k, v in (raw.get("gp_caps") or {}).items())
        if v is not None
    }
    return LeagueScoring(weights=weights, source="override", lineup=lineup, gp_caps=caps)


def league_scoring(snapshot: dict[str, Any]) -> LeagueScoring | None:
    """Scoring as synced from ESPN, or None when the snapshot has no weights."""
    settings = snapshot.get("settings") or {}
    rows = settings.get("categories") or settings.get("scoring_format") or []
    weights: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        abbr = row.get("abbr")
        pts = _float(row.get("points"))
        if abbr and pts is not None:
            weights[str(abbr)] = pts
    if not weights:
        return None
    lineup = {
        str(k): int(v)
        for k, v in (settings.get("position_slot_counts") or {}).items()
        if isinstance(v, (int, float))
    }
    caps: dict[str, float] = {}
    for row in settings.get("lineup_slot_stat_limits") or []:
        if isinstance(row, dict) and str(row.get("stat")) == "GP":
            limit = _float(row.get("limit"))
            if limit is not None:
                caps[str(row.get("slot"))] = limit
    return LeagueScoring(weights=weights, source="espn", lineup=lineup, gp_caps=caps)


def resolve_scoring(
    snapshot: dict[str, Any] | None,
    *,
    override_path: Path | str | None = None,
    use_override: bool = False,
) -> LeagueScoring:
    """ESPN settings first; the YAML override only when asked or when absent."""
    if not use_override and snapshot is not None:
        synced = league_scoring(snapshot)
        if synced is not None:
            return synced
    return load_scoring_override(override_path)


def score_line(line: dict[str, Any] | None, weights: dict[str, float]) -> float | None:
    """Fantasy points for one stat line under ``weights``.

    Returns None when the line carries none of the weighted stats — a missing
    line is a data gap, not a zero.
    """
    if not line:
        return None
    total = 0.0
    seen = False
    for stat, weight in weights.items():
        value = _float(line.get(stat))
        if value is None:
            continue
        seen = True
        total += weight * value
    return round(total, 4) if seen else None


def compare_scoring(
    synced: dict[str, float], expected: dict[str, float]
) -> list[tuple[str, float | None, float | None]]:
    """Weights that differ: ``[(stat, expected, synced)]`` sorted by stat."""
    keys = set(synced) | set(expected)
    return [
        (k, expected.get(k), synced.get(k))
        for k in sorted(keys)
        if expected.get(k) != synced.get(k)
    ]
