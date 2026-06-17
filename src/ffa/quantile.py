"""Quantile-calibrated generator (phase 6).

The phase-5 ``LearnedGenerator`` predicts per-game *means* (squared-error
loss), so its samples have calibrated means but tails inherit whatever
shape the player's history happens to have. For risk and confidence
intervals we want calibrated *tails* too.

Approach:

    1. For each (position, stat), fit one sklearn quantile-loss regressor
       per quantile level (default q10, q50, q90).
    2. At projection time, predict each player's marginal stat quantiles
       for the target season.
    3. PIT-transform the player's historical game rows: for each stat,
       replace the value with the linear interpolation of the predicted
       quantile function at the value's empirical CDF rank.
    4. Bootstrap-sample whole transformed rows as in phase 3.

Because PIT is rank-preserving within each stat and we sample whole
rows, cross-stat correlations from the player's history survive. The
*marginals* are calibrated to the model's predicted quantiles; the
*copula* is the player's own.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Final

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

from ffa.games import (
    GAMES_MODELS,
    GamesModel,
    bootstrap_season_totals,
    resolve_games_counts,
    stable_position,
)
from ffa.learned import _build_features, _per_player_season_aggregates
from ffa.projection import regular_season_only
from ffa.scoring import STAT_COLUMNS

_META_COLUMNS: Final[tuple[str, ...]] = (
    "player_name",
    "player_display_name",
    "position",
    "recent_team",
)

_DEFAULT_GBR_KWARGS: Final[dict] = {
    "n_estimators": 150,
    "max_depth": 3,
    "learning_rate": 0.05,
    "random_state": 0,
}


def _monotonize(values: np.ndarray) -> np.ndarray:
    """Enforce non-decreasing values along the last axis.

    sklearn's per-quantile fits don't jointly enforce that q10 <= q50
    <= q90; with limited data they can cross. Sorting per row is the
    standard post-hoc fix and never increases overall calibration error.
    """
    return np.sort(values, axis=-1)


def _pit_transform_column(
    historical_values: np.ndarray,
    predicted_quantiles: dict[float, float],
) -> np.ndarray:
    """Map each historical value to its quantile-calibrated equivalent.

    Steps:
        1. Empirical CDF rank of each historical value: ``rank / (n+1)``
           with average-method ties. The +1 keeps ranks strictly inside
           (0, 1) so they never fall outside the quantile knots.
        2. Linearly interpolate the predicted quantile function -- with
           an anchor at (0.0, 0.0) on the low side and a linear
           extrapolation on the high side -- at each rank.

    Returns a non-negative array of the same length as the input.
    """
    n = len(historical_values)
    if n == 0:
        return historical_values
    ranks = (
        pd.Series(historical_values).rank(method="average").to_numpy(dtype=float)
        / (n + 1)
    )
    qs = sorted(predicted_quantiles.keys())
    vs = [float(predicted_quantiles[q]) for q in qs]

    # Anchor: assume the lower end of every stat is 0 (yards, TDs,
    # receptions, fumbles -- all non-negative). Extrapolate the upper
    # end linearly from the last two predicted quantiles.
    xp = [0.0, *qs]
    fp = [0.0, *vs]
    if len(qs) >= 2:
        slope = (vs[-1] - vs[-2]) / max(qs[-1] - qs[-2], 1e-9)
        xp.append(1.0)
        fp.append(max(vs[-1] + slope * (1.0 - qs[-1]), vs[-1]))
    else:
        xp.append(1.0)
        fp.append(vs[-1])

    transformed = np.interp(ranks, xp, fp)
    return np.clip(transformed, 0.0, None)


@dataclass
class QuantileGenerator:
    """Per-(position, stat, quantile) sklearn quantile regressors.

    The fit produces ``len(quantiles)`` small models per (position, stat).
    With three quantiles (q10, q50, q90), four positions (QB/RB/WR/TE),
    and ~10 stat columns, that's ~120 lightweight tree ensembles --
    still pickle-friendly and fast to predict.
    """

    lookback: int = 3
    stats: tuple[str, ...] = STAT_COLUMNS
    quantiles: tuple[float, ...] = (0.1, 0.5, 0.9)
    model_kwargs: dict = field(default_factory=lambda: dict(_DEFAULT_GBR_KWARGS))
    models: dict[tuple[str, str, float], GradientBoostingRegressor] = field(default_factory=dict)
    feature_cols: list[str] = field(default_factory=list)

    def _training_rows(self, weekly: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
        agg = _per_player_season_aggregates(weekly, self.stats)
        seasons = sorted(agg["season"].unique())
        train_target_seasons = [s for s in seasons if s - 1 >= min(seasons)]
        all_features: list[pd.DataFrame] = []
        all_targets: list[pd.DataFrame] = []
        target_cols = [
            f"{s}_per_game" for s in self.stats if f"{s}_per_game" in agg.columns
        ]
        for target_season in train_target_seasons:
            feats = _build_features(agg, target_season, self.stats, lookback=self.lookback)
            if feats.empty:
                continue
            feats = feats.assign(season=target_season)
            targets = agg[agg["season"] == target_season][["player_id", *target_cols]]
            joined = feats.merge(targets, on="player_id", how="inner")
            if joined.empty:
                continue
            all_features.append(joined.drop(columns=target_cols))
            all_targets.append(joined[target_cols])
        if not all_features:
            return pd.DataFrame(), pd.DataFrame()
        return pd.concat(all_features, ignore_index=True), pd.concat(all_targets, ignore_index=True)

    def fit(self, weekly: pd.DataFrame) -> "QuantileGenerator":
        feats, targets = self._training_rows(weekly)
        if feats.empty:
            return self

        non_feature = {"player_id", "season", "position"}
        self.feature_cols = [c for c in feats.columns if c not in non_feature]

        for position, idx in feats.groupby("position", sort=False).groups.items():
            X = feats.loc[idx, self.feature_cols].to_numpy(dtype=float)
            for target_col in targets.columns:
                stat = target_col.removesuffix("_per_game")
                y = targets.loc[idx, target_col].to_numpy(dtype=float)
                if len(y) < 5 or np.all(y == y[0]):
                    continue
                for q in self.quantiles:
                    kwargs = dict(self.model_kwargs)
                    kwargs.update({"loss": "quantile", "alpha": float(q)})
                    model = GradientBoostingRegressor(**kwargs)
                    model.fit(X, y)
                    self.models[(str(position), stat, float(q))] = model
        return self

    def predict_quantiles(
        self, weekly_history: pd.DataFrame, target_season: int
    ) -> pd.DataFrame:
        """One row per player; columns ``{stat}_q{int(q*100):02d}`` for each (stat, q)."""
        agg = _per_player_season_aggregates(weekly_history, self.stats)
        feats = _build_features(agg, target_season, self.stats, lookback=self.lookback)
        if feats.empty:
            return feats

        keep_cols = ["player_id"]
        if "position" in feats.columns:
            keep_cols.append("position")
        out = feats[keep_cols].copy()

        X = (
            feats[self.feature_cols].to_numpy(dtype=float)
            if self.feature_cols
            else np.empty((len(feats), 0))
        )

        for stat in self.stats:
            # n_players x n_quantiles matrix of predictions.
            preds = np.zeros((len(feats), len(self.quantiles)), dtype=float)
            has_any_model = False
            if "position" in feats.columns:
                for position, idx in feats.groupby("position", sort=False).groups.items():
                    rows = feats.index.get_indexer(idx)
                    for j, q in enumerate(self.quantiles):
                        model = self.models.get((str(position), stat, float(q)))
                        if model is None:
                            continue
                        has_any_model = True
                        preds[rows, j] = np.clip(model.predict(X[rows]), 0.0, None)
            if not has_any_model:
                # Fallback: career per-game (constant across quantiles).
                career_col = f"{stat}_career_pg"
                if career_col in feats.columns:
                    preds[:] = feats[career_col].to_numpy(dtype=float)[:, None]
            preds = _monotonize(preds)
            for j, q in enumerate(self.quantiles):
                out[f"{stat}_q{int(round(q * 100)):02d}"] = preds[:, j]

        return out


def simulate_seasons_quantile_calibrated(
    weekly: pd.DataFrame,
    target_season: int,
    generator: QuantileGenerator | None = None,
    n_samples: int = 1000,
    lookback: int = 3,
    decay: float = 0.5,
    expected_games: float = 17.0,
    min_history_games: int = 4,
    stats: Iterable[str] = STAT_COLUMNS,
    quantiles: tuple[float, ...] = (0.1, 0.5, 0.9),
    games_model: str = "fixed",
    seed: int | None = None,
) -> pd.DataFrame:
    """Drop-in replacement for :func:`ffa.simulation.simulate_seasons`.

    Marginal stat distributions are calibrated to the learned quantile
    predictions; cross-stat correlations come from the player's own
    historical game rows (preserved by PIT + whole-row resampling).

    If ``generator`` is None, a fresh :class:`QuantileGenerator` is fit
    on ``weekly[weekly.season < target_season]``.
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
        generator = QuantileGenerator(
            lookback=lookback,
            stats=tuple(stat_cols),
            quantiles=tuple(quantiles),
        ).fit(training)

    quantile_preds = generator.predict_quantiles(history, target_season).set_index("player_id")
    if games_model not in GAMES_MODELS:
        raise ValueError(f"Unknown games_model: {games_model!r}. Choose from: {list(GAMES_MODELS)}.")
    n_games = max(1, int(round(expected_games)))
    rng = np.random.default_rng(seed)
    gm = GamesModel.from_history(history, max_games=n_games) if games_model == "empirical" else None

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
        if len(group) < min_history_games or player_id not in quantile_preds.index:
            continue

        # PIT-transform each stat column independently, in place per player.
        transformed = np.zeros((len(group), len(stat_cols)), dtype=float)
        for j, stat in enumerate(stat_cols):
            hist_vals = group[stat].fillna(0).to_numpy(dtype=float)
            pred_q = {
                float(q): float(quantile_preds.at[player_id, f"{stat}_q{int(round(q * 100)):02d}"])
                for q in generator.quantiles
                if f"{stat}_q{int(round(q * 100)):02d}" in quantile_preds.columns
            }
            if not pred_q:
                transformed[:, j] = hist_vals  # fallback: unchanged
                continue
            transformed[:, j] = _pit_transform_column(hist_vals, pred_q)

        weights = np.exp(-decay * (target_season - group["season"].to_numpy(dtype=float)))
        weights = weights / weights.sum()
        position = stable_position(group)
        games_counts = resolve_games_counts(gm, player_id, position, n_games, n_samples, rng)
        season_totals = bootstrap_season_totals(
            transformed, n_samples, games_counts, rng, weights=weights
        )

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
