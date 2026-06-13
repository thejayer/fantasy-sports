from ffa.backtest import (
    BacktestResult,
    evaluate_projections,
    pinball_loss,
    realized_season_totals,
    run_backtest,
    summarize_evaluation,
)
from ffa.draft import DraftResult, simulate_draft, summarize_user_picks
from ffa.learned import LearnedGenerator, simulate_seasons_learned
from ffa.league import LeagueConfig, RosterRules, load_league
from ffa.optimize import greedy_lineup, optimize_lineup
from ffa.projection import (
    apply_depth_multiplier,
    latest_depth_chart,
    project_per_game,
    project_season,
    regular_season_only,
)
from ffa.quantile import QuantileGenerator, simulate_seasons_quantile_calibrated
from ffa.ranking import assign_tiers, compute_vor
from ffa.scoring import score_player_weeks, score_stat_line
from ffa.simulation import simulate_seasons, summarize_seasons

__all__ = [
    "BacktestResult",
    "DraftResult",
    "LeagueConfig",
    "LearnedGenerator",
    "QuantileGenerator",
    "RosterRules",
    "apply_depth_multiplier",
    "assign_tiers",
    "compute_vor",
    "evaluate_projections",
    "greedy_lineup",
    "latest_depth_chart",
    "load_league",
    "optimize_lineup",
    "pinball_loss",
    "project_per_game",
    "project_season",
    "realized_season_totals",
    "regular_season_only",
    "run_backtest",
    "score_player_weeks",
    "score_stat_line",
    "simulate_draft",
    "simulate_seasons",
    "simulate_seasons_learned",
    "simulate_seasons_quantile_calibrated",
    "summarize_evaluation",
    "summarize_seasons",
    "summarize_user_picks",
]
