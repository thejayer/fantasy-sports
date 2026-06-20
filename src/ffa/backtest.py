"""Walk-forward backtesting: score the generators against realized seasons.

Every modeling claim in this package is testable one way: project a season
using only data available beforehand, then compare against what actually
happened. This module does that, walking forward over holdout seasons:

    1. Slice weekly history strictly before holdout season S.
    2. Run a generator (bootstrap / learned / quantile) targeting S.
    3. Reduce to the posterior summary via the same
       :func:`ffa.simulation.summarize_seasons` used everywhere else.
    4. Join against realized season totals (regular season only) and
       compute accuracy + calibration metrics.

Metrics per (generator, season, position):

- ``mae`` / ``rmse``: error of the posterior mean, in fantasy points.
- ``bias``: mean of (projected - realized). Positive = optimistic; the
  fixed ``expected_games=17`` assumption shows up here, since real
  players miss games.
- ``spearman``: rank correlation of projected vs realized points. Draft
  decisions consume ranks, so this is the headline accuracy number.
- ``pinball_qXX``: quantile (pinball) loss for each reported quantile
  column. The proper score for checking that e.g. ``q95`` behaves like
  a real 95th percentile; lower is better.
- ``cover_qXX_qYY``: fraction of players whose realized points landed
  inside the [qXX, qYY] interval. Compare against the nominal level:
  q05-q95 should cover ~90% if the posterior is calibrated.

Players who scored in the holdout season but were never projected (no
history -- rookies, mostly) are counted in ``n_unprojected`` rather than
silently dropped: that number is the size of the model's blind spot.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Final

import numpy as np
import pandas as pd

from ffa.league import LeagueConfig
from ffa.learned import simulate_seasons_learned
from ffa.level import LevelModel, projected_tier
from ffa.projection import project_per_game, project_season, regular_season_only
from ffa.quantile import simulate_seasons_quantile_calibrated
from ffa.rookies import augment_with_rookies
from ffa.scoring import STAT_COLUMNS, score_player_weeks
from ffa.simulation import simulate_seasons, summarize_seasons


def build_player_level(
    history: pd.DataFrame,
    target_season: int,
    league: LeagueConfig,
    level_model: LevelModel,
    lookback: int = 3,
    years_exp: pd.DataFrame | None = None,
) -> dict:
    """Per-player ``(level_sd, level_mean)`` from a conditioned LevelModel.

    Tiers each player by their *baseline* projected fantasy points (so the
    league-agnostic generator never has to score), looks up ``years_exp`` for
    the target season, and asks the model for each player's level knobs.
    Leakage-free: the projection uses only ``history`` (pre-target seasons).
    """
    per_game = project_per_game(history, target_season=target_season, lookback=lookback)
    if per_game.empty:
        return {}
    proj = project_season(per_game).copy()
    proj["_pts"] = score_player_weeks(proj, league)
    proj["_tier"] = projected_tier(proj["_pts"]).to_numpy()

    exp_lookup: dict = {}
    if years_exp is not None and {"player_id", "season", "years_exp"} <= set(years_exp.columns):
        sub = years_exp[years_exp["season"] == target_season]
        exp_lookup = dict(zip(sub["player_id"], sub["years_exp"]))

    out: dict = {}
    for pid, tier in zip(proj["player_id"], proj["_tier"]):
        out[pid] = level_model.level_for(tier, exp_lookup.get(pid))
    return out

# Generator name -> (simulator function, extra history seasons for training).
# The learned/quantile generators need more history than the pure bootstrap
# because they fit on (prior-seasons -> next-season) pairs; callers pulling
# data should pad the lookback window by the second tuple element.
GENERATORS: Final[dict[str, tuple[Callable[..., pd.DataFrame], int]]] = {
    "bootstrap": (simulate_seasons, 0),
    "learned": (simulate_seasons_learned, 2),
    "quantile": (simulate_seasons_quantile_calibrated, 2),
}

DEFAULT_POSITIONS: Final[tuple[str, ...]] = ("QB", "RB", "WR", "TE")

_META_COLUMNS: Final[tuple[str, ...]] = (
    "player_name",
    "player_display_name",
    "position",
    "recent_team",
)


@dataclass(frozen=True)
class BacktestResult:
    """Aggregated walk-forward evaluation output."""

    metrics: pd.DataFrame  # one row per (generator, season, position incl. "ALL")
    players: pd.DataFrame  # player-level projected-vs-realized rows across seasons


def realized_season_totals(
    weekly: pd.DataFrame,
    season: int,
    league: LeagueConfig,
    stats: Iterable[str] = STAT_COLUMNS,
) -> pd.DataFrame:
    """Realized regular-season totals and fantasy points for one season.

    Returns one row per player who logged at least one regular-season game
    in ``season``: summed stat columns, ``games_played``, available
    metadata, and ``points_realized`` under ``league`` scoring.
    """
    required = {"player_id", "season", "week"}
    missing = required - set(weekly.columns)
    if missing:
        raise ValueError(f"weekly is missing required columns: {sorted(missing)}")

    rows = regular_season_only(weekly)
    rows = rows[rows["season"] == season]
    stat_cols = [s for s in stats if s in rows.columns]
    if rows.empty:
        return pd.DataFrame(
            columns=["player_id", "games_played", "points_realized", *stat_cols]
        )

    totals = (
        rows.assign(_games=1)
        .groupby("player_id", as_index=False)
        .agg({**{s: "sum" for s in stat_cols}, "_games": "sum"})
        .rename(columns={"_games": "games_played"})
    )

    meta_cols = [c for c in _META_COLUMNS if c in rows.columns]
    if meta_cols:
        last_seen = (
            rows.sort_values(["player_id", "season", "week"])
            .groupby("player_id", as_index=False)
            .last()
        )
        totals = totals.merge(last_seen[["player_id", *meta_cols]], on="player_id", how="left")

    totals["points_realized"] = score_player_weeks(totals, league)
    return totals


def pinball_loss(
    realized: Iterable[float], predicted: Iterable[float], tau: float
) -> float:
    """Mean quantile (pinball) loss of ``predicted`` as the tau-quantile.

    For each pair: ``tau * (y - q)`` when the realized value ``y`` exceeds
    the prediction ``q``, else ``(1 - tau) * (q - y)``. A forecast that is
    truly the tau-quantile minimizes this in expectation, which is what
    makes it the right score for q05/q50/q95 columns.
    """
    y = np.asarray(realized, dtype=float)
    q = np.asarray(predicted, dtype=float)
    diff = y - q
    return float(np.mean(np.where(diff >= 0, tau * diff, (tau - 1) * diff)))


def _quantile_columns(df: pd.DataFrame) -> list[str]:
    """Posterior quantile columns named like ``q05``/``q50``/``q95``."""
    return [c for c in df.columns if len(c) == 3 and c[0] == "q" and c[1:].isdigit()]


def evaluate_projections(
    summary: pd.DataFrame,
    realized: pd.DataFrame,
    positions: Iterable[str] | None = DEFAULT_POSITIONS,
    min_realized_games: int = 1,
) -> pd.DataFrame:
    """Player-level join of a posterior summary against realized totals.

    Inner join on ``player_id``: only players who were both projected and
    actually played qualify. Use :func:`run_backtest` to also track how
    many realized players the model never projected.
    """
    if summary.empty or realized.empty:
        return pd.DataFrame()

    proj = summary
    if positions is not None and "position" in proj.columns:
        proj = proj[proj["position"].isin(tuple(positions))]
    real = realized[realized["games_played"] >= min_realized_games]

    evald = proj.merge(
        real[["player_id", "games_played", "points_realized"]],
        on="player_id",
        how="inner",
    )
    return evald.reset_index(drop=True)


def summarize_evaluation(evald: pd.DataFrame, by_position: bool = True) -> pd.DataFrame:
    """Reduce player-level evaluation rows to accuracy/calibration metrics.

    Returns one row per group: ``"ALL"`` plus (optionally) each position.
    See the module docstring for the meaning of each metric column.
    """
    if evald.empty:
        return pd.DataFrame()

    groups: list[tuple[str, pd.DataFrame]] = [("ALL", evald)]
    if by_position and "position" in evald.columns:
        groups += [(str(p), g) for p, g in evald.groupby("position", sort=True)]

    qcols = _quantile_columns(evald)
    rows: list[dict] = []
    for label, g in groups:
        err = g["points_mean"] - g["points_realized"]
        row: dict[str, float | int | str] = {
            "position": label,
            "n_players": int(len(g)),
            "mae": float(err.abs().mean()),
            "rmse": float(np.sqrt((err**2).mean())),
            "bias": float(err.mean()),
            "spearman": (
                float(g["points_mean"].corr(g["points_realized"], method="spearman"))
                if len(g) >= 2
                else float("nan")
            ),
        }
        for qc in qcols:
            row[f"pinball_{qc}"] = pinball_loss(g["points_realized"], g[qc], int(qc[1:]) / 100)
        for lo, hi in (("q05", "q95"), ("q25", "q75")):
            if lo in g.columns and hi in g.columns:
                inside = (g["points_realized"] >= g[lo]) & (g["points_realized"] <= g[hi])
                row[f"cover_{lo}_{hi}"] = float(inside.mean())
        rows.append(row)

    return pd.DataFrame(rows)


def run_backtest(
    weekly: pd.DataFrame,
    seasons: Iterable[int],
    league: LeagueConfig,
    generator: str = "bootstrap",
    n_samples: int = 500,
    lookback: int = 3,
    decay: float = 0.5,
    expected_games: float = 17.0,
    min_realized_games: int = 1,
    positions: Iterable[str] | None = DEFAULT_POSITIONS,
    games_model: str = "fixed",
    level_sd: float = 0.0,
    level_mean: float = 1.0,
    collapse_rate: float = 0.0,
    level_model: "LevelModel | None" = None,
    years_exp: pd.DataFrame | None = None,
    include_rookies: bool = False,
    draft_picks: pd.DataFrame | None = None,
    seed: int | None = 0,
) -> BacktestResult:
    """Walk-forward backtest of one generator over holdout ``seasons``.

    For each holdout season, the generator sees only ``weekly`` rows from
    strictly earlier seasons (enforced here in addition to inside each
    generator), so every evaluated projection was makeable at the time.

    Args:
        weekly: per-player per-game stats covering both the history needed
            to project each holdout season and the holdout seasons
            themselves (for realized totals).
        seasons: holdout seasons to evaluate, e.g. ``[2023, 2024]``.
        league: scoring rules applied to projections and actuals alike.
        generator: one of :data:`GENERATORS`.
        n_samples, lookback, decay, expected_games, seed: forwarded to the
            generator with the same semantics as everywhere else.
        min_realized_games: realized games required for a player to count.
            Keep at 1 for honest calibration -- injury-shortened seasons
            are real downside outcomes the posterior should cover.
        positions: restrict evaluation to these positions (None = all).
        games_model: ``"fixed"`` (sum a constant ``expected_games`` rows) or
            ``"empirical"`` (sample each sim's game count from the player's
            own / position's games-played history). Forwarded to the generator.
        level_sd, level_mean: per-season log-normal level multiplier
            (:mod:`ffa.level`) injecting level uncertainty into both tails;
            ``level_sd=0`` is off. Forwarded to the generator.
        include_rookies: augment each season's samples with draft-cohort
            rookie projections (:func:`ffa.rookies.augment_with_rookies`).
            Requires ``draft_picks``. Cohort pools use only classes before
            the holdout season, so this stays leakage-free.
        draft_picks: draft-pick table (needs ``player_id``/``season``/
            ``round``/``position``); required when ``include_rookies``.

    Returns:
        :class:`BacktestResult` with per-(season, position) metrics and
        the player-level rows behind them. Seasons with no overlapping
        players (e.g. missing history) are omitted from both frames.
    """
    if generator not in GENERATORS:
        raise ValueError(f"Unknown generator: {generator!r}. Choose from: {list(GENERATORS)}.")
    if include_rookies and draft_picks is None:
        raise ValueError("include_rookies=True requires a draft_picks frame.")
    simulate, _ = GENERATORS[generator]

    metrics_frames: list[pd.DataFrame] = []
    player_frames: list[pd.DataFrame] = []
    for season in seasons:
        history = weekly[weekly["season"] < season]
        player_level = (
            build_player_level(history, season, league, level_model, lookback, years_exp)
            if level_model is not None
            else None
        )
        samples = simulate(
            history,
            target_season=season,
            n_samples=n_samples,
            lookback=lookback,
            decay=decay,
            expected_games=expected_games,
            games_model=games_model,
            level_sd=level_sd,
            level_mean=level_mean,
            collapse_rate=collapse_rate,
            player_level=player_level,
            seed=seed,
        )
        if include_rookies:
            samples = augment_with_rookies(
                samples, history, draft_picks, target_season=season,
                n_samples=n_samples, expected_games=expected_games, seed=seed,
            )
        summary = summarize_seasons(samples, league)

        realized = realized_season_totals(weekly, season, league)
        if positions is not None and "position" in realized.columns:
            realized = realized[realized["position"].isin(tuple(positions))]
        realized = realized[realized["games_played"] >= min_realized_games]

        evald = evaluate_projections(
            summary, realized, positions=positions, min_realized_games=min_realized_games
        )
        if evald.empty:
            continue

        projected_ids = set(summary["player_id"])
        unprojected = realized[~realized["player_id"].isin(projected_ids)]
        unproj_by_pos = (
            unprojected["position"].value_counts()
            if "position" in unprojected.columns
            else pd.Series(dtype=int)
        )

        met = summarize_evaluation(evald)
        met.insert(0, "generator", generator)
        met.insert(1, "season", season)
        met["n_unprojected"] = [
            len(unprojected) if pos == "ALL" else int(unproj_by_pos.get(pos, 0))
            for pos in met["position"]
        ]
        metrics_frames.append(met)
        player_frames.append(evald.assign(season=season, generator=generator))

    if not metrics_frames:
        return BacktestResult(metrics=pd.DataFrame(), players=pd.DataFrame())
    return BacktestResult(
        metrics=pd.concat(metrics_frames, ignore_index=True),
        players=pd.concat(player_frames, ignore_index=True),
    )
