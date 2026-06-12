"""Learned per-stat per-game generator.

Hybrid of the phase-3 bootstrap and a small supervised model:

    1. Train per-(position, stat) regressors that predict next-season
       per-game stat values from features computed off prior seasons.
    2. At projection time, for each player:
         - compute features from their last `lookback` seasons
         - predict the per-game mean for each stat
         - scale the player's historical game rows so their mean matches
           the predicted mean
         - bootstrap-sample `expected_games` scaled rows and sum them to
           produce one simulated season total
    3. Return the same long DataFrame contract as ``simulate_seasons``.

Why this design

The phase-3 bootstrap can't extrapolate: a player's projection is the
mean of their own past, recency-weighted. That misses everything a
learned model captures -- aging curves, position-pool baselines, role
changes when a player's prior-season per-game numbers are anomalous.

Why not replace the bootstrap entirely

Bootstrapping the residuals preserves the within-player variability
structure (skewness of TDs, correlations between stats) for free. A
fully learned generator would have to estimate that joint distribution
explicitly, which is much harder and much more dependent on having a
big training set. The hybrid gets most of the upside of conditioning
with none of the downside of joint-distribution modeling.

Limitations

- Players with zero history of a stat (e.g. a RB who never threw a
  pass) still get zero samples for that stat. Multiplicative scaling
  preserves zero, by design.
- Models are trained on whatever weekly data you pass in -- with a few
  seasons of nflverse data this is fine for trend extraction, but not
  enough for a serious aging-curve model.
- The model objective is squared error on per-game means, so it's
  calibrated for means but not for tail quantiles. That's the next
  upgrade (quantile regression objective).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Final

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

from ffa.projection import regular_season_only
from ffa.scoring import STAT_COLUMNS

_META_COLUMNS: Final[tuple[str, ...]] = (
    "player_name",
    "player_display_name",
    "position",
    "recent_team",
)

_DEFAULT_GBR_KWARGS: Final[dict] = {
    "n_estimators": 200,
    "max_depth": 3,
    "learning_rate": 0.05,
    "random_state": 0,
}


def _per_player_season_aggregates(
    weekly: pd.DataFrame, stats: Iterable[str]
) -> pd.DataFrame:
    """Reduce weekly rows to one row per (player, season) with per-game means + game count."""
    stat_cols = [s for s in stats if s in weekly.columns]
    agg = (
        weekly.assign(_g=1)
        .groupby(["player_id", "season"], as_index=False)
        .agg({**{s: "sum" for s in stat_cols}, "_g": "sum"})
    )
    for s in stat_cols:
        agg[f"{s}_per_game"] = agg[s] / agg["_g"]
    agg = agg.rename(columns={"_g": "games"})
    # Carry the player's most recent position (mode would be safer but cheaper to take first non-null).
    if "position" in weekly.columns:
        pos = (
            weekly.dropna(subset=["position"])
            .groupby("player_id")["position"]
            .agg(lambda s: s.mode().iloc[0] if not s.mode().empty else s.iloc[0])
        )
        agg = agg.merge(pos.rename("position"), left_on="player_id", right_index=True, how="left")
    return agg


def _build_features(
    agg: pd.DataFrame,
    target_season: int,
    stats: Iterable[str],
    lookback: int = 3,
) -> pd.DataFrame:
    """Per-player feature row at projection time for ``target_season``.

    Features per stat:
      - ``{stat}_prev_pg``: last-season per-game value (NaN -> 0)
      - ``{stat}_prev2_pg``: two-seasons-ago per-game (NaN -> 0)
      - ``{stat}_career_pg``: weighted career per-game over the lookback
    Plus:
      - ``prev_games``: last season games played (proxy for durability)
      - ``career_games``: total games in the lookback window
    """
    seasons = list(range(target_season - lookback, target_season))
    window = agg[agg["season"].isin(seasons)].copy()

    stat_cols = [s for s in stats if f"{s}_per_game" in window.columns]
    feature_rows: list[dict] = []
    for player_id, group in window.groupby("player_id", sort=False):
        by_season = group.set_index("season").reindex(seasons)
        row: dict[str, float] = {"player_id": player_id}
        prev = by_season.iloc[-1]
        prev2 = by_season.iloc[-2] if len(seasons) >= 2 else pd.Series(dtype=float)
        # Weighted career: weight by season recency, divide by weighted games.
        weights = np.array(
            [np.exp(-0.5 * (target_season - s)) for s in seasons], dtype=float
        )
        games = by_season["games"].fillna(0).to_numpy(dtype=float)
        for s in stat_cols:
            stat_pg_col = f"{s}_per_game"
            stat_total_col = s
            row[f"{s}_prev_pg"] = float(prev.get(stat_pg_col, np.nan) or 0.0) if pd.notna(prev.get(stat_pg_col, np.nan)) else 0.0
            prev2_val = prev2.get(stat_pg_col, np.nan) if not prev2.empty else np.nan
            row[f"{s}_prev2_pg"] = float(prev2_val) if pd.notna(prev2_val) else 0.0
            totals = by_season[stat_total_col].fillna(0).to_numpy(dtype=float)
            weighted_stat = float((weights * totals).sum())
            weighted_games = float((weights * games).sum())
            row[f"{s}_career_pg"] = (
                weighted_stat / weighted_games if weighted_games > 0 else 0.0
            )
        row["prev_games"] = float(prev.get("games", 0) or 0)
        row["career_games"] = float(games.sum())
        if "position" in group.columns:
            row["position"] = group["position"].iloc[-1]
        feature_rows.append(row)
    return pd.DataFrame(feature_rows)


@dataclass
class LearnedGenerator:
    """Per-(position, stat) sklearn regressors of next-season per-game stats.

    Fit once on historical weekly data, then call :meth:`predict_per_game`
    to score a new season. The fitted state is just a dict of small
    sklearn estimators -- pickle-friendly, no PyTorch required.
    """

    lookback: int = 3
    stats: tuple[str, ...] = STAT_COLUMNS
    model_kwargs: dict = field(default_factory=lambda: dict(_DEFAULT_GBR_KWARGS))
    models: dict[tuple[str, str], GradientBoostingRegressor] = field(default_factory=dict)
    feature_cols: list[str] = field(default_factory=list)

    def _training_rows(self, weekly: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Build (features, targets) keyed by (player_id, season).

        For every (player, season) target, features are computed from
        the player's prior ``lookback`` seasons; the target is the
        player's per-game stat means *that* season.
        """
        agg = _per_player_season_aggregates(weekly, self.stats)
        seasons = sorted(agg["season"].unique())
        train_target_seasons = [s for s in seasons if s - 1 >= min(seasons)]
        all_features: list[pd.DataFrame] = []
        all_targets: list[pd.DataFrame] = []
        for target_season in train_target_seasons:
            feats = _build_features(agg, target_season, self.stats, lookback=self.lookback)
            if feats.empty:
                continue
            feats = feats.assign(season=target_season)
            targets = agg[agg["season"] == target_season][
                ["player_id", *[f"{s}_per_game" for s in self.stats if f"{s}_per_game" in agg.columns]]
            ]
            joined = feats.merge(targets, on="player_id", how="inner")
            if joined.empty:
                continue
            all_features.append(joined.drop(columns=[f"{s}_per_game" for s in self.stats if f"{s}_per_game" in joined.columns]))
            all_targets.append(joined[[f"{s}_per_game" for s in self.stats if f"{s}_per_game" in joined.columns]])
        if not all_features:
            return pd.DataFrame(), pd.DataFrame()
        return pd.concat(all_features, ignore_index=True), pd.concat(all_targets, ignore_index=True)

    def fit(self, weekly: pd.DataFrame) -> "LearnedGenerator":
        """Fit one model per (position, stat). No-op if there's no training data."""
        feats, targets = self._training_rows(weekly)
        if feats.empty:
            return self

        # Build the canonical feature matrix order.
        non_feature = {"player_id", "season", "position"}
        self.feature_cols = [c for c in feats.columns if c not in non_feature]

        for position, idx in feats.groupby("position", sort=False).groups.items():
            X = feats.loc[idx, self.feature_cols].to_numpy(dtype=float)
            for target_col in targets.columns:
                y = targets.loc[idx, target_col].to_numpy(dtype=float)
                if len(y) < 5 or np.all(y == y[0]):
                    # Not enough rows or constant target -> skip; predictions
                    # for this (position, stat) will fall back to features.
                    continue
                model = GradientBoostingRegressor(**self.model_kwargs)
                model.fit(X, y)
                stat = target_col.removesuffix("_per_game")
                self.models[(str(position), stat)] = model
        return self

    def predict_per_game(
        self, weekly_history: pd.DataFrame, target_season: int
    ) -> pd.DataFrame:
        """Predict per-game stat values for each player projected to ``target_season``."""
        agg = _per_player_season_aggregates(weekly_history, self.stats)
        feats = _build_features(agg, target_season, self.stats, lookback=self.lookback)
        if feats.empty:
            return feats

        out_cols = ["player_id", "position"] if "position" in feats.columns else ["player_id"]
        out = feats[out_cols].copy()
        X = feats[self.feature_cols].to_numpy(dtype=float) if self.feature_cols else np.empty((len(feats), 0))

        for stat in self.stats:
            pred_col = np.zeros(len(feats), dtype=float)
            if "position" in feats.columns:
                for position, idx in feats.groupby("position", sort=False).groups.items():
                    model = self.models.get((str(position), stat))
                    if model is None:
                        # Fallback: use the player's career per-game value.
                        career_col = f"{stat}_career_pg"
                        if career_col in feats.columns:
                            pred_col[feats.index.get_indexer(idx)] = feats.loc[idx, career_col].to_numpy()
                        continue
                    rows = feats.index.get_indexer(idx)
                    pred_col[rows] = np.clip(model.predict(X[rows]), 0.0, None)
            out[stat] = pred_col

        return out


def simulate_seasons_learned(
    weekly: pd.DataFrame,
    target_season: int,
    generator: LearnedGenerator | None = None,
    n_samples: int = 1000,
    lookback: int = 3,
    decay: float = 0.5,
    expected_games: float = 17.0,
    min_history_games: int = 4,
    stats: Iterable[str] = STAT_COLUMNS,
    seed: int | None = None,
) -> pd.DataFrame:
    """Drop-in replacement for :func:`ffa.simulation.simulate_seasons`.

    Bootstrap residuals from each player's own game rows, but center
    them on a learned per-game mean instead of the player's historical
    mean. Stat columns are scaled multiplicatively (so a stat the player
    never produced stays at zero -- the right behavior unless and until
    we have features that say "this guy is going to start throwing now").

    If ``generator`` is None, a fresh :class:`LearnedGenerator` is fit on
    ``weekly[weekly.season < target_season]``. Pass a pre-fit generator
    when projecting multiple seasons to avoid re-fitting.
    """
    required = {"player_id", "season", "week"}
    missing = required - set(weekly.columns)
    if missing:
        raise ValueError(f"weekly is missing required columns: {sorted(missing)}")

    weekly = regular_season_only(weekly)
    stat_cols = [s for s in stats if s in weekly.columns]
    history = weekly[
        weekly["season"].between(target_season - lookback, target_season - 1)
    ]
    if history.empty or not stat_cols:
        return pd.DataFrame(columns=["player_id", "sample_idx", *stat_cols])

    if generator is None:
        training = weekly[weekly["season"] < target_season]
        generator = LearnedGenerator(lookback=lookback, stats=tuple(stat_cols)).fit(training)

    predictions = generator.predict_per_game(history, target_season).set_index("player_id")

    n_games = max(1, int(round(expected_games)))
    rng = np.random.default_rng(seed)

    meta_cols = [c for c in _META_COLUMNS if c in history.columns]
    if meta_cols:
        meta_lookup = (
            history.sort_values(["player_id", "season", "week"])
            .groupby("player_id", as_index=False)
            .last()
            .set_index("player_id")[meta_cols]
        )
    else:
        meta_lookup = None

    out_frames: list[pd.DataFrame] = []
    for player_id, group in history.groupby("player_id", sort=False):
        if len(group) < min_history_games or player_id not in predictions.index:
            continue

        stat_matrix = group[stat_cols].fillna(0).to_numpy(dtype=float)
        hist_mean = stat_matrix.mean(axis=0)
        pred_mean = predictions.loc[player_id, stat_cols].to_numpy(dtype=float)
        # Multiplicative shift: scale each game row's stats so the player's
        # mean matches the learned prediction. Stats with zero history stay zero.
        with np.errstate(divide="ignore", invalid="ignore"):
            scale = np.where(hist_mean > 0, pred_mean / hist_mean, 0.0)
        shifted = stat_matrix * scale  # broadcasts over rows

        # Recency-weight sampling probabilities (same as plain bootstrap).
        weights = np.exp(-decay * (target_season - group["season"].to_numpy(dtype=float)))
        weights = weights / weights.sum()
        idx = rng.choice(len(shifted), size=(n_samples, n_games), replace=True, p=weights)
        season_totals = shifted[idx].sum(axis=1)

        frame = pd.DataFrame(season_totals, columns=stat_cols)
        frame["player_id"] = player_id
        frame["sample_idx"] = np.arange(n_samples, dtype=np.int32)
        out_frames.append(frame)

    if not out_frames:
        return pd.DataFrame(columns=["player_id", "sample_idx", *stat_cols])

    samples = pd.concat(out_frames, ignore_index=True)
    samples = samples[["player_id", "sample_idx", *stat_cols]]
    if meta_lookup is not None:
        samples = samples.join(meta_lookup, on="player_id")
    return samples
