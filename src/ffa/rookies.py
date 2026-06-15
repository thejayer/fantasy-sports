"""Rookie projections via draft-cohort block bootstrap.

The veteran generators (:mod:`ffa.simulation`, :mod:`ffa.learned`,
:mod:`ffa.quantile`) all project a player from *their own* past game rows,
so a first-year player with no NFL history is dropped entirely. That makes
the draft tool blind to exactly the players a draft most turns on -- first
round rookie RBs and WRs.

This module fills that hole with the same machinery, sourced differently.
A rookie's "history" is the pool of *rookie-season game rows produced by
comparable players in prior draft classes* -- same position, same draft
capital bucket. To simulate one rookie season:

    1. Bucket the incoming rookie by position and draft round.
    2. Pool every prior-class rookie-season game row in that cohort.
    3. Bootstrap-sample ``expected_games`` rows with replacement and sum
       them -- one simulated season. Repeat ``n_samples`` times.

Because whole game rows are the sampling unit (as in the veteran
bootstrap), cross-stat correlations and skew survive for free, and the
spread across a cohort -- busts who washed out next to hits who broke
out -- becomes the rookie's floor-to-ceiling range. The output is the
same long ``(player_id, sample_idx, ...stats...)`` contract every
generator returns, so it concatenates onto veteran samples and flows
through scoring / VOR / tiers / draft-sim unchanged.

Draft capital is the only signal used here. It is a coarse prior -- it
knows nothing about landing spot, depth chart, or college production --
but it is the signal that most separates rookie outcomes, and it is
available before a snap is played.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import Final

import numpy as np
import pandas as pd

from ffa.projection import regular_season_only
from ffa.scoring import STAT_COLUMNS

DEFAULT_ROOKIE_POSITIONS: Final[tuple[str, ...]] = ("QB", "RB", "WR", "TE")

_META_COLUMNS: Final[tuple[str, ...]] = (
    "player_name",
    "player_display_name",
    "position",
    "recent_team",
)

# nflverse load_draft_picks column -> canonical name the package uses. Same
# boundary-adapter idea as ffa.ingest; applied only when canonical is absent.
_DRAFT_COLUMN_ALIASES: Final[Mapping[str, str]] = {
    "gsis_id": "player_id",
    "pfr_player_name": "player_display_name",
    "team": "recent_team",
}


def draft_round_bucket(draft_round: float, max_named_round: int = 3) -> str:
    """Coarse draft-capital bucket from a draft round.

    Rounds 1..``max_named_round`` get their own bucket (``"R1"``, ...); later
    rounds collapse into a single ``"R{n}+"`` Day-3 bucket. Round (not exact
    pick) keeps cohorts populated with only a handful of prior classes while
    still separating the outcomes that matter most.
    """
    r = int(draft_round)
    if r <= max_named_round:
        return f"R{r}"
    return f"R{max_named_round + 1}+"


def normalize_draft_picks(draft_picks: pd.DataFrame) -> pd.DataFrame:
    """Rename nflverse draft columns to canonical names (pure, non-clobbering)."""
    rename = {
        src: dst
        for src, dst in _DRAFT_COLUMN_ALIASES.items()
        if src in draft_picks.columns and dst not in draft_picks.columns
    }
    return draft_picks.rename(columns=rename) if rename else draft_picks


def _present(df: pd.DataFrame, cols: Iterable[str]) -> list[str]:
    return [c for c in cols if c in df.columns]


def draft_class(
    draft_picks: pd.DataFrame,
    season: int,
    positions: Iterable[str] = DEFAULT_ROOKIE_POSITIONS,
    bucket_fn: Callable[[float], str] = draft_round_bucket,
) -> pd.DataFrame:
    """One row per drafted skill player entering the league in ``season``.

    Returns columns ``player_id``, ``position``, ``bucket`` plus any
    available metadata (``player_display_name``, ``recent_team``).
    """
    dp = normalize_draft_picks(draft_picks)
    required = {"player_id", "season", "round", "position"}
    missing = required - set(dp.columns)
    if missing:
        raise ValueError(f"draft_picks is missing required columns: {sorted(missing)}")

    rows = dp[(dp["season"] == season) & dp["position"].isin(tuple(positions))].copy()
    rows = rows.dropna(subset=["player_id", "round"])
    if rows.empty:
        return rows.assign(bucket=pd.Series(dtype=str))
    rows["bucket"] = rows["round"].map(bucket_fn)
    keep = ["player_id", "position", "bucket", *_present(rows, _META_COLUMNS)]
    return rows[keep].reset_index(drop=True)


def build_cohort_pool(
    weekly: pd.DataFrame,
    draft_picks: pd.DataFrame,
    before_season: int,
    lookback_classes: int = 6,
    positions: Iterable[str] = DEFAULT_ROOKIE_POSITIONS,
    stats: Iterable[str] = STAT_COLUMNS,
    bucket_fn: Callable[[float], str] = draft_round_bucket,
) -> pd.DataFrame:
    """Pool prior-class rookie-season game rows, tagged by cohort.

    A "rookie-season game row" is a regular-season weekly row for a drafted
    player in the same season they were drafted. Only classes strictly
    before ``before_season`` (within ``lookback_classes``) are included, so
    a pool built for a target season never sees that season's outcomes.

    Returns a long DataFrame with columns ``position``, ``bucket``, and each
    present stat column -- one row per pooled rookie game.
    """
    dp = normalize_draft_picks(draft_picks)
    required = {"player_id", "season", "round", "position"}
    missing = required - set(dp.columns)
    if missing:
        raise ValueError(f"draft_picks is missing required columns: {sorted(missing)}")

    classes = range(before_season - lookback_classes, before_season)
    dp = dp[dp["season"].isin(list(classes)) & dp["position"].isin(tuple(positions))]
    dp = dp.dropna(subset=["player_id", "round"])
    stat_cols = _present(weekly, stats)
    if dp.empty or not stat_cols:
        return pd.DataFrame(columns=["position", "bucket", *stat_cols])

    # Rename the draft position to avoid colliding with weekly's own
    # ``position`` on merge; the draft position is the cohort's identity.
    rookie_meta = dp[["player_id", "season", "position", "round"]].rename(
        columns={"season": "rookie_season", "position": "_cohort_pos"}
    )
    rookie_meta["bucket"] = rookie_meta["round"].map(bucket_fn)

    reg = regular_season_only(weekly)
    # A row counts as a rookie-season row when its season equals the player's
    # draft season -- their actual first-year production.
    merged = reg.merge(rookie_meta, on="player_id", how="inner")
    merged = merged[merged["season"] == merged["rookie_season"]]
    if merged.empty:
        return pd.DataFrame(columns=["position", "bucket", *stat_cols])

    out = merged[["_cohort_pos", "bucket", *stat_cols]].rename(columns={"_cohort_pos": "position"})
    return out.reset_index(drop=True)


def simulate_rookies(
    weekly: pd.DataFrame,
    draft_picks: pd.DataFrame,
    target_season: int,
    n_samples: int = 1000,
    lookback_classes: int = 6,
    expected_games: float = 17.0,
    positions: Iterable[str] = DEFAULT_ROOKIE_POSITIONS,
    stats: Iterable[str] = STAT_COLUMNS,
    min_pool_games: int = 24,
    bucket_fn: Callable[[float], str] = draft_round_bucket,
    seed: int | None = None,
) -> pd.DataFrame:
    """Bootstrap simulated rookie seasons for ``target_season``'s draft class.

    For each incoming rookie, sample whole game rows from their draft-cohort
    pool (position + round bucket). A cohort thinner than ``min_pool_games``
    rows falls back to a position-only pool; a position with no prior data at
    all is skipped (the rookie stays unprojected rather than fabricated).

    Returns the same long contract as :func:`ffa.simulation.simulate_seasons`:
    ``player_id``, ``sample_idx``, each stat column, plus rookie metadata.
    """
    pool = build_cohort_pool(
        weekly, draft_picks, before_season=target_season,
        lookback_classes=lookback_classes, positions=positions, stats=stats,
        bucket_fn=bucket_fn,
    )
    incoming = draft_class(draft_picks, target_season, positions=positions, bucket_fn=bucket_fn)
    stat_cols = _present(weekly, stats)
    if pool.empty or incoming.empty or not stat_cols:
        return pd.DataFrame(columns=["player_id", "sample_idx", *stat_cols])

    n_games = max(1, int(round(expected_games)))
    rng = np.random.default_rng(seed)

    # Pre-split the pool by exact cohort and by position for fallback.
    by_cohort = {
        key: grp[stat_cols].fillna(0).to_numpy(dtype=float)
        for key, grp in pool.groupby(["position", "bucket"], sort=False)
    }
    by_position = {
        str(pos): grp[stat_cols].fillna(0).to_numpy(dtype=float)
        for pos, grp in pool.groupby("position", sort=False)
    }

    out_frames: list[pd.DataFrame] = []
    for row in incoming.itertuples(index=False):
        pos = str(row.position)
        matrix = by_cohort.get((pos, row.bucket))
        if matrix is None or len(matrix) < min_pool_games:
            matrix = by_position.get(pos)
        if matrix is None or len(matrix) == 0:
            continue
        idx = rng.choice(len(matrix), size=(n_samples, n_games), replace=True)
        season_totals = matrix[idx].sum(axis=1)
        frame = pd.DataFrame(season_totals, columns=stat_cols)
        frame["player_id"] = row.player_id
        frame["sample_idx"] = np.arange(n_samples, dtype=np.int32)
        for meta in _META_COLUMNS:
            if meta == "position":
                frame[meta] = pos
            elif hasattr(row, meta):
                frame[meta] = getattr(row, meta)
        out_frames.append(frame)

    if not out_frames:
        return pd.DataFrame(columns=["player_id", "sample_idx", *stat_cols])

    samples = pd.concat(out_frames, ignore_index=True)
    front = ["player_id", "sample_idx", *stat_cols]
    return samples[[*front, *[c for c in samples.columns if c not in front]]]


def augment_with_rookies(
    veteran_samples: pd.DataFrame,
    weekly: pd.DataFrame,
    draft_picks: pd.DataFrame,
    target_season: int,
    n_samples: int = 1000,
    lookback_classes: int = 6,
    expected_games: float = 17.0,
    positions: Iterable[str] = DEFAULT_ROOKIE_POSITIONS,
    stats: Iterable[str] = STAT_COLUMNS,
    min_pool_games: int = 24,
    bucket_fn: Callable[[float], str] = draft_round_bucket,
    seed: int | None = None,
) -> pd.DataFrame:
    """Append rookie samples to veteran samples; column-aligned concat.

    A no-op (returns ``veteran_samples`` unchanged) when there is no draft
    data or no projectable rookie. Rookies never collide with veterans: a
    target-season rookie has no prior weekly rows, so the veteran generators
    never produced samples for them.
    """
    rookie_samples = simulate_rookies(
        weekly, draft_picks, target_season, n_samples=n_samples,
        lookback_classes=lookback_classes, expected_games=expected_games,
        positions=positions, stats=stats, min_pool_games=min_pool_games,
        bucket_fn=bucket_fn, seed=seed,
    )
    if rookie_samples.empty:
        return veteran_samples
    if veteran_samples.empty:
        return rookie_samples
    return pd.concat([veteran_samples, rookie_samples], ignore_index=True)
