"""Command line entrypoints.

Examples:
    ffa ingest --season 2023 --season 2024
    ffa score --league configs/ppr.yaml --season 2024 --week 5 --limit 25
"""

from __future__ import annotations

from pathlib import Path

import typer

from ffa.backtest import GENERATORS as _GENERATORS
from ffa.backtest import build_player_level, run_backtest, years_exp_from_rosters
from ffa.calibration import (
    dispersion_decomposition,
    dispersion_direction,
    quantile_calibration,
)
from ffa.draft import simulate_draft, summarize_user_picks
from ffa.games import GAMES_MODELS
from ffa.ingest import ingest_seasons, open_warehouse
from ffa.league import load_league
from ffa.level import LevelModel
from ffa.optimize import optimize_lineup
from ffa.player_map import (
    build_player_map_document,
    collect_hub_espn_players,
    compute_hub_coverage,
    crosswalk_from_ff_playerids,
    crosswalk_from_rosters,
    fetch_ff_playerids,
    merge_crosswalks,
    skill_roster_stats,
    write_player_map,
)
from ffa.projection import project_per_game, project_season
from ffa.projections import (
    build_projection_table,
    build_snapshot_document,
    scoring_slug,
    write_projection_snapshot,
)
from ffa.ranking import assign_tiers, compute_vor
from ffa.rookies import augment_with_rookies
from ffa.scoring import score_player_weeks
from ffa.simulation import simulate_typical_weeks, summarize_seasons

app = typer.Typer(add_completion=False, help="Fantasy football analytics pipeline.")

# How many prior draft classes feed the rookie cohort pools.
_ROOKIE_LOOKBACK_CLASSES = 6


@app.command()
def ingest(
    season: list[int] = typer.Option(..., "--season", help="Repeatable: --season 2023 --season 2024"),
    out_dir: Path = typer.Option(Path("data/raw"), "--out-dir"),
) -> None:
    """Pull weekly stats, rosters, and schedules from nflverse to Parquet."""
    result = ingest_seasons(seasons=season, out_dir=out_dir)
    for table, n in result.rows.items():
        typer.echo(f"{table}: {n:,} rows -> {out_dir / (table + '.parquet')}")


@app.command()
def score(
    league: Path = typer.Option(..., "--league", help="Path to a league YAML"),
    season: int = typer.Option(..., "--season"),
    week: int | None = typer.Option(None, "--week", help="Restrict to one week"),
    limit: int = typer.Option(25, "--limit"),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Apply a league config to ingested weekly stats and print top scorers."""
    cfg = load_league(league)
    con = open_warehouse(db_path=db, raw_dir=raw_dir)
    query = "SELECT * FROM weekly WHERE season = ?"
    params: list[object] = [season]
    if week is not None:
        query += " AND week = ?"
        params.append(week)
    weekly = con.execute(query, params).df()

    if weekly.empty:
        typer.echo("No rows found. Have you run `ffa ingest` for that season?")
        raise typer.Exit(code=1)

    weekly["fantasy_points"] = score_player_weeks(weekly, cfg)
    cols = [c for c in ("player_display_name", "position", "recent_team", "week") if c in weekly.columns]
    out = weekly[[*cols, "fantasy_points"]].sort_values("fantasy_points", ascending=False).head(limit)
    typer.echo(out.to_string(index=False))


@app.command()
def project(
    season: int = typer.Option(..., "--season", help="Season to project."),
    lookback: int = typer.Option(3, "--lookback", help="Prior seasons to use."),
    decay: float = typer.Option(0.5, "--decay", help="Exponential recency decay."),
    expected_games: float = typer.Option(17.0, "--expected-games"),
    league: Path | None = typer.Option(None, "--league", help="If given, also score the projection."),
    limit: int = typer.Option(25, "--limit"),
    out: Path | None = typer.Option(None, "--out", help="Optional Parquet path to write the projection."),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Recency-weighted baseline projection from ingested weekly history."""
    con = open_warehouse(db_path=db, raw_dir=raw_dir)
    seasons = list(range(season - lookback, season))
    placeholders = ",".join("?" for _ in seasons)
    weekly = con.execute(
        f"SELECT * FROM weekly WHERE season IN ({placeholders})", seasons
    ).df()
    if weekly.empty:
        typer.echo(
            f"No weekly history found for seasons {seasons}. Run `ffa ingest` first."
        )
        raise typer.Exit(code=1)

    per_game = project_per_game(weekly, target_season=season, lookback=lookback, decay=decay)
    season_df = project_season(per_game, expected_games=expected_games)

    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
        season_df.to_parquet(out, index=False)
        typer.echo(f"Wrote {len(season_df):,} rows -> {out}")

    if league is not None:
        cfg = load_league(league)
        season_df["fantasy_points"] = score_player_weeks(season_df, cfg)
        cols = [c for c in ("player_display_name", "position", "recent_team") if c in season_df.columns]
        out_df = (
            season_df[[*cols, "fantasy_points"]]
            .sort_values("fantasy_points", ascending=False)
            .head(limit)
        )
        typer.echo(out_df.to_string(index=False))


@app.command()
def simulate(
    league: Path = typer.Option(..., "--league", help="Path to a league YAML."),
    season: int = typer.Option(..., "--season"),
    samples: int = typer.Option(1000, "--samples", help="Samples per player."),
    lookback: int = typer.Option(3, "--lookback"),
    decay: float = typer.Option(0.5, "--decay"),
    expected_games: float = typer.Option(17.0, "--expected-games"),
    seed: int = typer.Option(0, "--seed"),
    generator: str = typer.Option(
        "bootstrap",
        "--generator",
        help="Generator: bootstrap (phase 3), learned (phase 5), or quantile (phase 6).",
    ),
    limit: int = typer.Option(25, "--limit"),
    games_model: str = typer.Option(
        "fixed", "--games-model",
        help="fixed = same expected-games count every sim; empirical = sample games played from history.",
    ),
    level_sd: float = typer.Option(
        0.0, "--level-sd", help="Per-season level-uncertainty spread; fattens both tails (0 = off)."
    ),
    level_mean: float = typer.Option(
        1.0, "--level-mean", help="Level multiplier mean; <1 also de-biases down (recommended 0.90)."
    ),
    conditioned_level: bool = typer.Option(
        False,
        "--conditioned-level",
        help="Use LevelModel (tier + years_exp + collapse) instead of global level scalars.",
    ),
    include_rookies: bool = typer.Option(
        False, "--include-rookies", help="Project this season's draft class from cohorts."
    ),
    out: Path | None = typer.Option(None, "--out", help="Optional Parquet path for the summary."),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Distributional projections; print mean / sd / 5-95 quantiles."""
    _, summary = _load_simulation_summary(
        league, season, samples, lookback, decay, expected_games, seed, db, raw_dir,
        generator=generator, games_model=games_model, level_sd=level_sd, level_mean=level_mean,
        conditioned_level=conditioned_level, include_rookies=include_rookies,
    )

    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
        summary.to_parquet(out, index=False)
        typer.echo(f"Wrote {len(summary):,} rows -> {out}")

    cols = [c for c in ("player_display_name", "position", "recent_team") if c in summary.columns]
    show = [*cols, "points_mean", "points_sd", "q05", "q50", "q95"]
    show = [c for c in show if c in summary.columns]
    typer.echo(summary[show].head(limit).round(1).to_string(index=False))


def _load_years_exp(con, seasons: list[int]):
    """Rosters ``years_exp`` for LevelModel joins, or None if unavailable."""
    if not seasons:
        return None
    placeholders = ",".join("?" for _ in seasons)
    try:
        rosters = con.execute(
            f"SELECT * FROM rosters WHERE season IN ({placeholders})", seasons
        ).df()
    except Exception:  # noqa: BLE001 -- missing view / older warehouse
        return None
    if rosters is None or rosters.empty:
        return None
    try:
        return years_exp_from_rosters(rosters)
    except ValueError:
        return None


def _load_simulation_summary(
    league: Path,
    season: int,
    samples: int,
    lookback: int,
    decay: float,
    expected_games: float,
    seed: int,
    db: Path,
    raw_dir: Path,
    generator: str = "bootstrap",
    games_model: str = "fixed",
    level_sd: float = 0.0,
    level_mean: float = 1.0,
    conditioned_level: bool = False,
    include_rookies: bool = False,
):
    """Shared helper: pull weekly history -> samples -> posterior summary.

    ``generator`` chooses the simulator: ``bootstrap`` (phase 3),
    ``learned`` (phase 5), or ``quantile`` (phase 6). All three return
    the same long DataFrame, so downstream code is identical.

    With ``conditioned_level``, build a per-player LevelModel table (tier +
    ``years_exp`` + collapse) and pass it as ``player_level`` — the
    calibrated phase-18 path. Global ``--level-sd`` / ``--level-mean`` remain
    the fallback for players absent from that table.

    With ``include_rookies``, the target season's draft class is projected
    from prior-class cohorts and appended (:mod:`ffa.rookies`).
    """
    if generator not in _GENERATORS:
        typer.echo(
            f"Unknown generator: {generator!r}. Choose from: {list(_GENERATORS)}."
        )
        raise typer.Exit(code=2)
    if games_model not in GAMES_MODELS:
        typer.echo(f"Unknown games-model: {games_model!r}. Choose from: {list(GAMES_MODELS)}.")
        raise typer.Exit(code=2)

    simulator, history_pad = _GENERATORS[generator]
    cfg = load_league(league)
    con = open_warehouse(db_path=db, raw_dir=raw_dir)
    history_span = lookback + history_pad
    if include_rookies:
        history_span = max(history_span, _ROOKIE_LOOKBACK_CLASSES)
    seasons = list(range(season - history_span, season))
    placeholders = ",".join("?" for _ in seasons)
    weekly = con.execute(
        f"SELECT * FROM weekly WHERE season IN ({placeholders})", seasons
    ).df()
    if weekly.empty:
        typer.echo(f"No weekly history for seasons {seasons}. Run `ffa ingest` first.")
        raise typer.Exit(code=1)

    player_level = None
    if conditioned_level:
        years_exp = _load_years_exp(con, [season])
        if years_exp is None or years_exp.empty:
            typer.echo(
                "--conditioned-level: no rosters years_exp for season "
                f"{season}; using tier-only LevelModel (experience = unknown)."
            )
        player_level = build_player_level(
            weekly,
            season,
            cfg,
            LevelModel(),
            lookback=lookback,
            years_exp=years_exp,
        )
        typer.echo(
            f"--conditioned-level: LevelModel table for {len(player_level):,} players."
        )

    samples_df = simulator(
        weekly,
        target_season=season,
        n_samples=samples,
        lookback=lookback,
        decay=decay,
        expected_games=expected_games,
        games_model=games_model,
        level_sd=level_sd,
        level_mean=level_mean,
        player_level=player_level,
        seed=seed,
    )
    if include_rookies:
        samples_df = _augment_rookies(
            con, samples_df, weekly, season, samples, expected_games, seed
        )
    return cfg, summarize_seasons(samples_df, cfg)


def _augment_rookies(con, samples_df, weekly, season, samples, expected_games, seed):
    """Load the draft class from the warehouse and append rookie samples.

    Degrades gracefully: if no ``draft_picks`` have been ingested, warn and
    return the veteran samples unchanged rather than failing the command.
    """
    draft_seasons = list(range(season - _ROOKIE_LOOKBACK_CLASSES, season + 1))
    placeholders = ",".join("?" for _ in draft_seasons)
    try:
        draft_picks = con.execute(
            f"SELECT * FROM draft_picks WHERE season IN ({placeholders})", draft_seasons
        ).df()
    except Exception:  # noqa: BLE001 -- missing view / older warehouse
        draft_picks = None
    if draft_picks is None or draft_picks.empty:
        typer.echo(
            "--include-rookies set but no draft_picks in the warehouse; "
            "run `ffa ingest` to pull them. Continuing without rookies."
        )
        return samples_df
    return augment_with_rookies(
        samples_df,
        weekly,
        draft_picks,
        target_season=season,
        n_samples=samples,
        expected_games=expected_games,
        lookback_classes=_ROOKIE_LOOKBACK_CLASSES,
        seed=seed,
    )


@app.command()
def rank(
    league: Path = typer.Option(..., "--league"),
    season: int = typer.Option(..., "--season"),
    samples: int = typer.Option(1000, "--samples"),
    lookback: int = typer.Option(3, "--lookback"),
    decay: float = typer.Option(0.5, "--decay"),
    expected_games: float = typer.Option(17.0, "--expected-games"),
    seed: int = typer.Option(0, "--seed"),
    generator: str = typer.Option("bootstrap", "--generator"),
    n_tiers: int = typer.Option(5, "--tiers"),
    limit: int = typer.Option(40, "--limit"),
    games_model: str = typer.Option(
        "fixed", "--games-model",
        help="fixed = same expected-games count every sim; empirical = sample games played from history.",
    ),
    level_sd: float = typer.Option(
        0.0, "--level-sd", help="Per-season level-uncertainty spread; fattens both tails (0 = off)."
    ),
    level_mean: float = typer.Option(
        1.0, "--level-mean", help="Level multiplier mean; <1 also de-biases down (recommended 0.90)."
    ),
    conditioned_level: bool = typer.Option(
        False,
        "--conditioned-level",
        help="Use LevelModel (tier + years_exp + collapse) instead of global level scalars.",
    ),
    include_rookies: bool = typer.Option(
        False, "--include-rookies", help="Project this season's draft class from cohorts."
    ),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Posterior summary + VOR + tiers."""
    cfg, summary = _load_simulation_summary(
        league, season, samples, lookback, decay, expected_games, seed, db, raw_dir,
        generator=generator, games_model=games_model, level_sd=level_sd, level_mean=level_mean,
        conditioned_level=conditioned_level, include_rookies=include_rookies,
    )
    ranked = compute_vor(summary, cfg.roster)
    ranked = assign_tiers(ranked, n_tiers=n_tiers)
    ranked = ranked.sort_values("vor", ascending=False)
    cols = [c for c in ("player_display_name", "position", "recent_team", "tier", "points_mean", "vor", "q05", "q95") if c in ranked.columns]
    typer.echo(ranked[cols].head(limit).round(1).to_string(index=False))


@app.command()
def optimize(
    league: Path = typer.Option(..., "--league"),
    season: int = typer.Option(..., "--season"),
    budget: float | None = typer.Option(None, "--budget", help="Optional auction cap."),
    costs_csv: Path | None = typer.Option(
        None, "--costs", help="CSV with columns player_id, cost (required with --budget)."
    ),
    samples: int = typer.Option(1000, "--samples"),
    lookback: int = typer.Option(3, "--lookback"),
    decay: float = typer.Option(0.5, "--decay"),
    expected_games: float = typer.Option(17.0, "--expected-games"),
    seed: int = typer.Option(0, "--seed"),
    generator: str = typer.Option("bootstrap", "--generator"),
    games_model: str = typer.Option(
        "fixed", "--games-model",
        help="fixed = same expected-games count every sim; empirical = sample games played from history.",
    ),
    level_sd: float = typer.Option(
        0.0, "--level-sd", help="Per-season level-uncertainty spread; fattens both tails (0 = off)."
    ),
    level_mean: float = typer.Option(
        1.0, "--level-mean", help="Level multiplier mean; <1 also de-biases down (recommended 0.90)."
    ),
    conditioned_level: bool = typer.Option(
        False,
        "--conditioned-level",
        help="Use LevelModel (tier + years_exp + collapse) instead of global level scalars.",
    ),
    include_rookies: bool = typer.Option(
        False, "--include-rookies", help="Project this season's draft class from cohorts."
    ),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """ILP roster optimizer; max VOR subject to slots and optional budget."""
    import pandas as pd

    cfg, summary = _load_simulation_summary(
        league, season, samples, lookback, decay, expected_games, seed, db, raw_dir,
        generator=generator, games_model=games_model, level_sd=level_sd, level_mean=level_mean,
        conditioned_level=conditioned_level, include_rookies=include_rookies,
    )
    ranked = compute_vor(summary, cfg.roster)
    if budget is not None:
        if costs_csv is None:
            typer.echo("--budget requires --costs.")
            raise typer.Exit(code=1)
        costs_df = pd.read_csv(costs_csv)
        costs = costs_df.set_index("player_id")["cost"]
        lineup = optimize_lineup(ranked, cfg.roster, costs=costs, budget=budget)
    else:
        lineup = optimize_lineup(ranked, cfg.roster)
    cols = [c for c in ("slot", "player_display_name", "position", "recent_team", "points_mean", "vor") if c in lineup.columns]
    typer.echo(lineup[cols].round(1).to_string(index=False))


@app.command("draft-sim")
def draft_sim(
    league: Path = typer.Option(..., "--league"),
    season: int = typer.Option(..., "--season"),
    user_slot: int = typer.Option(..., "--slot", help="User's 1-indexed draft slot."),
    n_sims: int = typer.Option(500, "--sims"),
    opponent_noise: float = 0.25,
    samples: int = typer.Option(1000, "--samples"),
    lookback: int = typer.Option(3, "--lookback"),
    decay: float = typer.Option(0.5, "--decay"),
    expected_games: float = typer.Option(17.0, "--expected-games"),
    seed: int = typer.Option(0, "--seed"),
    generator: str = typer.Option("bootstrap", "--generator"),
    limit: int = typer.Option(25, "--limit"),
    games_model: str = typer.Option(
        "fixed", "--games-model",
        help="fixed = same expected-games count every sim; empirical = sample games played from history.",
    ),
    level_sd: float = typer.Option(
        0.0, "--level-sd", help="Per-season level-uncertainty spread; fattens both tails (0 = off)."
    ),
    level_mean: float = typer.Option(
        1.0, "--level-mean", help="Level multiplier mean; <1 also de-biases down (recommended 0.90)."
    ),
    conditioned_level: bool = typer.Option(
        False,
        "--conditioned-level",
        help="Use LevelModel (tier + years_exp + collapse) instead of global level scalars.",
    ),
    include_rookies: bool = typer.Option(
        False, "--include-rookies", help="Project this season's draft class from cohorts."
    ),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Monte Carlo snake draft from your slot; prints pick-rate table."""
    cfg, summary = _load_simulation_summary(
        league, season, samples, lookback, decay, expected_games, seed, db, raw_dir,
        generator=generator, games_model=games_model, level_sd=level_sd, level_mean=level_mean,
        conditioned_level=conditioned_level, include_rookies=include_rookies,
    )
    ranked = compute_vor(summary, cfg.roster)
    result = simulate_draft(
        ranked,
        cfg.roster,
        user_slot=user_slot,
        n_sims=n_sims,
        opponent_noise=opponent_noise,
        seed=seed,
    )
    typer.echo(summarize_user_picks(result.user_picks, top=limit).round(2).to_string(index=False))


@app.command()
def backtest(
    league: Path = typer.Option(..., "--league"),
    start: int = typer.Option(..., "--start", help="First holdout season to evaluate."),
    end: int | None = typer.Option(None, "--end", help="Last holdout season (inclusive); defaults to --start."),
    generator: list[str] = typer.Option(
        ["bootstrap"], "--generator", help="Repeatable: compare several generators in one run."
    ),
    samples: int = typer.Option(500, "--samples"),
    lookback: int = typer.Option(3, "--lookback"),
    decay: float = typer.Option(0.5, "--decay"),
    expected_games: float = typer.Option(17.0, "--expected-games"),
    min_games: int = typer.Option(1, "--min-games", help="Realized games required to count a player."),
    by_position: bool = typer.Option(False, "--by-position", help="Also print per-position metrics."),
    calibration: bool = typer.Option(
        False, "--calibration", help="Print per-position quantile-coverage calibration table."
    ),
    games_model: str = typer.Option(
        "fixed", "--games-model",
        help="fixed = same expected-games count every sim; empirical = sample games played from history.",
    ),
    level_sd: float = typer.Option(
        0.0, "--level-sd", help="Per-season level-uncertainty spread; fattens both tails (0 = off)."
    ),
    level_mean: float = typer.Option(
        1.0, "--level-mean", help="Level multiplier mean; <1 also de-biases down (recommended 0.90)."
    ),
    conditioned_level: bool = typer.Option(
        False,
        "--conditioned-level",
        help="Use LevelModel (tier + years_exp + collapse) instead of global level scalars.",
    ),
    include_rookies: bool = typer.Option(
        False, "--include-rookies", help="Also project + score each season's draft class."
    ),
    seed: int = typer.Option(0, "--seed"),
    out: Path | None = typer.Option(None, "--out", help="Optional Parquet path for player-level rows."),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Walk-forward backtest: project each holdout season, compare to reality."""
    import pandas as pd

    cfg = load_league(league)
    last = start if end is None else end
    if last < start:
        typer.echo(f"--end ({last}) must be >= --start ({start}).")
        raise typer.Exit(code=2)
    unknown = [g for g in generator if g not in _GENERATORS]
    if unknown:
        typer.echo(f"Unknown generator(s): {unknown}. Choose from: {list(_GENERATORS)}.")
        raise typer.Exit(code=2)
    if games_model not in GAMES_MODELS:
        typer.echo(f"Unknown games-model: {games_model!r}. Choose from: {list(GAMES_MODELS)}.")
        raise typer.Exit(code=2)

    # Pull enough history for the hungriest generator's first holdout season,
    # plus the holdout seasons themselves for realized totals. Rookie cohort
    # pools reach back further, so widen the lower bound when they're on.
    max_pad = max(_GENERATORS[g][1] for g in generator)
    history_span = lookback + max_pad
    if include_rookies:
        history_span = max(history_span, _ROOKIE_LOOKBACK_CLASSES)
    seasons_needed = list(range(start - history_span, last + 1))
    con = open_warehouse(db_path=db, raw_dir=raw_dir)
    placeholders = ",".join("?" for _ in seasons_needed)
    weekly = con.execute(
        f"SELECT * FROM weekly WHERE season IN ({placeholders})", seasons_needed
    ).df()
    if weekly.empty:
        typer.echo(f"No weekly history for seasons {seasons_needed}. Run `ffa ingest` first.")
        raise typer.Exit(code=1)

    draft_picks = None
    if include_rookies:
        try:
            draft_picks = con.execute(
                f"SELECT * FROM draft_picks WHERE season IN ({placeholders})", seasons_needed
            ).df()
        except Exception:  # noqa: BLE001 -- missing view / older warehouse
            draft_picks = None
        if draft_picks is None or draft_picks.empty:
            typer.echo("--include-rookies set but no draft_picks ingested; run `ffa ingest`.")
            raise typer.Exit(code=1)

    holdouts = list(range(start, last + 1))
    level_model = LevelModel() if conditioned_level else None
    years_exp = None
    if conditioned_level:
        years_exp = _load_years_exp(con, holdouts)
        if years_exp is None or years_exp.empty:
            typer.echo(
                "--conditioned-level: no rosters years_exp; using tier-only LevelModel."
            )
        else:
            typer.echo(
                f"--conditioned-level: years_exp for {years_exp['player_id'].nunique():,} players."
            )

    metrics_frames = []
    players_frames = []
    for gen_name in generator:
        result = run_backtest(
            weekly,
            holdouts,
            cfg,
            generator=gen_name,
            n_samples=samples,
            lookback=lookback,
            decay=decay,
            expected_games=expected_games,
            min_realized_games=min_games,
            games_model=games_model,
            level_sd=level_sd,
            level_mean=level_mean,
            level_model=level_model,
            years_exp=years_exp,
            include_rookies=include_rookies,
            draft_picks=draft_picks,
            seed=seed,
        )
        if result.metrics.empty:
            typer.echo(
                f"{gen_name}: no projected players overlapped reality -- "
                f"is history ingested for seasons {seasons_needed}?"
            )
            continue
        metrics_frames.append(result.metrics)
        players_frames.append(result.players)

    if not metrics_frames:
        raise typer.Exit(code=1)
    metrics = pd.concat(metrics_frames, ignore_index=True)

    show = [
        c
        for c in (
            "generator", "season", "position", "n_players", "n_unprojected",
            "mae", "rmse", "bias", "spearman", "cover_q05_q95",
            "pinball_q05", "pinball_q50", "pinball_q95",
        )
        if c in metrics.columns
    ]
    view = metrics if by_position else metrics[metrics["position"] == "ALL"]
    typer.echo(view[show].round(2).to_string(index=False))

    if len(holdouts) > 1:
        overall = metrics[metrics["position"] == "ALL"]
        means = overall.groupby("generator", sort=False)[show[3:]].mean().reset_index()
        typer.echo("\nAverage across seasons:")
        typer.echo(means.round(2).to_string(index=False))

    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
        pd.concat(players_frames, ignore_index=True).to_parquet(out, index=False)
        typer.echo(f"\nWrote player-level rows -> {out}")

    if calibration:
        players = pd.concat(players_frames, ignore_index=True)
        gens = list(dict.fromkeys(players["generator"])) if "generator" in players.columns else [None]
        printed = False
        for gen_name in gens:
            subset = players if gen_name is None else players[players["generator"] == gen_name]
            # The two analyses have independent inputs (coverage needs the
            # q-columns; the decomposition needs only mean/sd/realized), so
            # run each whenever its own data is present.
            cal = quantile_calibration(subset, by="position")
            decomp = dispersion_decomposition(subset, by="position")
            if cal.empty and decomp.empty:
                continue
            if not printed:
                typer.echo(
                    "\nCalibration (coverage nominal q05/q25/q50/q75/q95 = .05/.25/.50/.75/.95):"
                )
                printed = True
            # Only label per-generator when several were compared in one run.
            if gen_name is not None and len(gens) > 1:
                typer.echo(f"\n[{gen_name}]")
            if not cal.empty:
                cal = cal.assign(dispersion=cal.apply(dispersion_direction, axis=1))
                typer.echo(cal.round(2).to_string(index=False))
            if not decomp.empty:
                typer.echo("variance decomposition (ratio = resid_sd / modeled_sd; "
                           "frac_modeled = share the posterior explains):")
                typer.echo(decomp.round(2).to_string(index=False))
        if not printed:
            typer.echo("\nNo calibration data available.")


@app.command("export-projections")
def export_projections(
    league: Path = typer.Option(Path("configs/ppr.yaml"), "--league"),
    season: int = typer.Option(..., "--season"),
    out_dir: Path = typer.Option(
        Path("data/sj/projections"),
        "--out-dir",
        help="Store root for projections/{scoring}/{season}.json",
    ),
    samples: int = typer.Option(2000, "--samples"),
    lookback: int = typer.Option(3, "--lookback"),
    decay: float = typer.Option(0.5, "--decay"),
    expected_games: float = typer.Option(17.0, "--expected-games"),
    seed: int = typer.Option(0, "--seed"),
    generator: str = typer.Option("bootstrap", "--generator"),
    games_model: str = typer.Option("fixed", "--games-model"),
    level_sd: float = typer.Option(0.0, "--level-sd"),
    level_mean: float = typer.Option(1.0, "--level-mean"),
    conditioned_level: bool = typer.Option(
        True,
        "--conditioned-level/--no-conditioned-level",
        help="Default on: calibrated LevelModel path (roadmap 4.1).",
    ),
    include_rookies: bool = typer.Option(False, "--include-rookies"),
    n_tiers: int = typer.Option(5, "--tiers"),
    fmt: str = typer.Option(
        "json",
        "--format",
        help="json | parquet | both",
    ),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Write hub-consumable projection snapshots (roadmap 4.2).

    Runs the same simulation summary as ``rank``, attaches VOR + tiers, and
    writes ``{out_dir}/{scoring}/{season}.json`` (optional Parquet sibling).
    Defaults to ``--conditioned-level`` so nightly exports use the calibrated
    path. The hub reads these files; it never invokes this CLI at request time.
    """
    if fmt not in ("json", "parquet", "both"):
        typer.echo(f"Unknown --format {fmt!r}; choose json, parquet, or both.")
        raise typer.Exit(code=2)

    cfg, summary = _load_simulation_summary(
        league,
        season,
        samples,
        lookback,
        decay,
        expected_games,
        seed,
        db,
        raw_dir,
        generator=generator,
        games_model=games_model,
        level_sd=level_sd,
        level_mean=level_mean,
        conditioned_level=conditioned_level,
        include_rookies=include_rookies,
    )
    table = build_projection_table(summary, cfg, n_tiers=n_tiers)
    slug = scoring_slug(cfg)
    document = build_snapshot_document(
        table,
        scoring=slug,
        season=season,
        n_sims=samples,
        source={
            "engine": "ffa",
            "league": str(league),
            "generator": generator,
            "games_model": games_model,
            "lookback": lookback,
            "decay": decay,
            "expected_games": expected_games,
            "conditioned_level": conditioned_level,
            "level_sd": level_sd,
            "level_mean": level_mean,
            "include_rookies": include_rookies,
            "seed": seed,
            "tiers": n_tiers,
        },
    )
    written = write_projection_snapshot(document, table, out_dir, fmt=fmt)  # type: ignore[arg-type]
    for path in written:
        typer.echo(f"Wrote {len(table):,} players -> {path}")


@app.command("export-weekly-projections")
def export_weekly_projections(
    league: Path = typer.Option(Path("configs/ppr.yaml"), "--league"),
    season: int = typer.Option(..., "--season"),
    out_dir: Path = typer.Option(
        Path("data/sj/weekly_projections"),
        "--out-dir",
        help="Store root for weekly_projections/{scoring}/{season}.json",
    ),
    samples: int = typer.Option(2000, "--samples"),
    lookback: int = typer.Option(3, "--lookback"),
    decay: float = typer.Option(0.5, "--decay"),
    seed: int = typer.Option(0, "--seed"),
    level_sd: float = typer.Option(0.0, "--level-sd"),
    level_mean: float = typer.Option(1.0, "--level-mean"),
    conditioned_level: bool = typer.Option(
        True,
        "--conditioned-level/--no-conditioned-level",
        help="Default on: calibrated LevelModel path (roadmap 4.1).",
    ),
    n_tiers: int = typer.Option(5, "--tiers"),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Write hub-consumable typical-week posterior snapshots.

    Bootstraps single historical game rows (not season totals) so the hub can
    power start/sit without calling ``ffa`` at request time. Not schedule- or
    opponent-adjusted — ``grain`` is ``typical_week``. Learned/quantile
    season generators are intentionally out of scope here.
    """
    from ffa.weekly_export import (
        GRAIN_TYPICAL_WEEK,
        build_weekly_projection_table,
        build_weekly_snapshot_document,
        write_weekly_projection_snapshot,
    )

    cfg = load_league(league)
    con = open_warehouse(db_path=db, raw_dir=raw_dir)
    seasons = list(range(season - lookback, season))
    placeholders = ",".join("?" for _ in seasons)
    weekly = con.execute(
        f"SELECT * FROM weekly WHERE season IN ({placeholders})", seasons
    ).df()
    if weekly.empty:
        typer.echo(f"No weekly history for seasons {seasons}. Run `ffa ingest` first.")
        raise typer.Exit(code=1)

    player_level = None
    if conditioned_level:
        years_exp = _load_years_exp(con, [season])
        if years_exp is None or years_exp.empty:
            typer.echo(
                "--conditioned-level: no rosters years_exp for season "
                f"{season}; using tier-only LevelModel (experience = unknown)."
            )
        player_level = build_player_level(
            weekly,
            season,
            cfg,
            LevelModel(),
            lookback=lookback,
            years_exp=years_exp,
        )
        typer.echo(
            f"--conditioned-level: LevelModel table for {len(player_level):,} players."
        )

    samples_df = simulate_typical_weeks(
        weekly,
        target_season=season,
        n_samples=samples,
        lookback=lookback,
        decay=decay,
        level_sd=level_sd,
        level_mean=level_mean,
        player_level=player_level,
        seed=seed,
    )
    summary = summarize_seasons(samples_df, cfg)
    table = build_weekly_projection_table(summary, cfg, n_tiers=n_tiers)
    slug = scoring_slug(cfg)
    document = build_weekly_snapshot_document(
        table,
        scoring=slug,
        season=season,
        n_sims=samples,
        grain=GRAIN_TYPICAL_WEEK,
        source={
            "engine": "ffa",
            "league": str(league),
            "generator": "bootstrap_typical_week",
            "lookback": lookback,
            "decay": decay,
            "conditioned_level": conditioned_level,
            "level_sd": level_sd,
            "level_mean": level_mean,
            "seed": seed,
            "tiers": n_tiers,
        },
    )
    path = write_weekly_projection_snapshot(document, out_dir)
    typer.echo(f"Wrote {len(table):,} players ({GRAIN_TYPICAL_WEEK}) -> {path}")


@app.command("export-playoff-odds")
def export_playoff_odds(
    sj_root: Path = typer.Option(
        Path("data/sj"),
        "--sj-root",
        help="Hub store root with league snapshots (falls back to fixtures via sj.store).",
    ),
    season: int = typer.Option(..., "--season"),
    league_id: str | None = typer.Option(
        None,
        "--league-id",
        help="One football league_id. Default: every football league for --season.",
    ),
    out_dir: Path = typer.Option(
        Path("data/sj/playoff_odds"),
        "--out-dir",
        help="Store root for playoff_odds/{league_id}/{season}.json",
    ),
    league: Path = typer.Option(
        Path("configs/ppr.yaml"),
        "--league",
        help="ffa scoring config used for weekly FP draws (ppr/standard).",
    ),
    n_sims: int = typer.Option(500, "--sims"),
    samples: int = typer.Option(2000, "--samples"),
    lookback: int = typer.Option(3, "--lookback"),
    decay: float = typer.Option(0.5, "--decay"),
    seed: int = typer.Option(0, "--seed"),
    as_of_week: int | None = typer.Option(
        None,
        "--as-of-week",
        help="Treat periods >= this week as undecided (midseason what-if).",
    ),
    level_sd: float = typer.Option(0.0, "--level-sd"),
    level_mean: float = typer.Option(1.0, "--level-mean"),
    conditioned_level: bool = typer.Option(
        True,
        "--conditioned-level/--no-conditioned-level",
        help="Default on: calibrated LevelModel path.",
    ),
    player_map: Path | None = typer.Option(
        None,
        "--player-map",
        help="Optional player_map JSON (default: {sj-root}/player_map/{season}.json).",
    ),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Write hub-consumable playoff-odds snapshots (football).

    Offline Monte Carlo over remaining regular-season H2H games using
    independent typical-week bootstrap draws + greedy skill lineups. Does not
    invent odds from season/weekly quantile boards. Hub reads the JSON only.
    """
    import numpy as np

    from ffa.player_map import load_player_map
    from ffa.playoff_export import (
        build_playoff_odds_document,
        simulate_playoff_odds,
        write_playoff_odds_snapshot,
    )
    from ffa.projections import scoring_slug
    from ffa.scoring import score_player_weeks
    from sj.store import list_snapshots, read_snapshot

    cfg = load_league(league)
    slug = scoring_slug(cfg)

    map_path = player_map
    if map_path is None:
        for year in (season, season - 1):
            candidate = sj_root / "player_map" / f"{year}.json"
            if candidate.is_file():
                map_path = candidate
                break
    espn_to_gsis: dict[str, str] = {}
    if map_path and map_path.is_file():
        doc = load_player_map(map_path)
        for row in doc.get("mappings") or []:
            espn = str(row.get("espn_id") or "").strip()
            gsis = str(row.get("player_id") or "").strip()
            if espn and gsis:
                espn_to_gsis[espn] = gsis
        typer.echo(f"Player map: {len(espn_to_gsis):,} ESPN→GSIS from {map_path}")
    else:
        typer.echo("No player map found; mapped roster counts will be 0.")

    # Typical-week joint samples (ephemeral — not written to the hub store).
    con = open_warehouse(db_path=db, raw_dir=raw_dir)
    seasons = list(range(season - lookback, season))
    placeholders = ",".join("?" for _ in seasons)
    weekly = con.execute(
        f"SELECT * FROM weekly WHERE season IN ({placeholders})", seasons
    ).df()
    if weekly.empty:
        typer.echo(f"No weekly history for seasons {seasons}. Run `ffa ingest` first.")
        raise typer.Exit(code=1)

    player_level = None
    if conditioned_level:
        years_exp = _load_years_exp(con, [season])
        player_level = build_player_level(
            weekly,
            season,
            cfg,
            LevelModel(),
            lookback=lookback,
            years_exp=years_exp,
        )

    samples_df = simulate_typical_weeks(
        weekly,
        target_season=season,
        n_samples=samples,
        lookback=lookback,
        decay=decay,
        level_sd=level_sd,
        level_mean=level_mean,
        player_level=player_level,
        seed=seed,
    )
    if samples_df.empty:
        typer.echo("No typical-week samples produced.")
        raise typer.Exit(code=1)

    scored = samples_df.copy()
    scored["fantasy_points"] = score_player_weeks(scored, cfg)
    points_by_key: dict[str, np.ndarray] = {}
    for pid, grp in scored.groupby("player_id", sort=False):
        points_by_key[str(pid)] = grp.sort_values("sample_idx")["fantasy_points"].to_numpy(
            dtype=float
        )
    typer.echo(f"Weekly FP matrix: {len(points_by_key):,} players × {samples} samples")

    store_arg = sj_root if sj_root.is_dir() else None
    try:
        available = list_snapshots(store_arg)
    except Exception:  # noqa: BLE001
        available = []
    targets = [
        item
        for item in available
        if item.get("sport") == "football" and int(item.get("season") or 0) == season
    ]
    if league_id:
        targets = [t for t in targets if t.get("league_id") == league_id]
        if not targets:
            # Still try a direct read (fixtures / partial index).
            targets = [{"league_id": league_id, "season": season, "sport": "football"}]

    if not targets:
        typer.echo(f"No football leagues for season {season} under {sj_root}.")
        raise typer.Exit(code=1)

    written = 0
    for item in targets:
        lid = str(item["league_id"])
        try:
            snap = read_snapshot(lid, season, store_arg)
        except FileNotFoundError:
            typer.echo(f"Skip {lid}: snapshot not found")
            continue
        if snap.get("sport") and snap.get("sport") != "football":
            continue
        sim = simulate_playoff_odds(
            snap,
            points_by_key,
            espn_to_gsis,
            n_sims=n_sims,
            seed=seed,
            as_of_week=as_of_week,
        )
        document = build_playoff_odds_document(
            snap,
            sim,
            scoring=slug,
            n_sims=n_sims,
            assumptions={
                "player_draws": "independent_bootstrap_typical_week",
                "lineup": "greedy_skill_positions",
                "k_dst": "omitted",
                "rosters": "fixed_at_export",
                "schedule_adjusted": False,
                "median_scoring": False,
                "metric": "make_playoffs_regular_season_only",
            },
            source={
                "engine": "ffa",
                "sj_root": str(sj_root),
                "generator": "playoff_mc_v1",
                "league_config": str(league),
                "conditioned_level": conditioned_level,
                "lookback": lookback,
                "decay": decay,
                "samples": samples,
                "seed": seed,
                "as_of_week": as_of_week,
            },
        )
        path = write_playoff_odds_snapshot(document, out_dir)
        written += 1
        typer.echo(
            f"Wrote {lid} ({sim['n_matchups']} matchups, "
            f"{len(sim['periods_simulated'])} periods) -> {path}"
        )

    if written == 0:
        typer.echo("No playoff-odds files written.")
        raise typer.Exit(code=1)


@app.command("export-draft-sim")
def export_draft_sim(
    league: Path = typer.Option(Path("configs/ppr.yaml"), "--league"),
    season: int = typer.Option(..., "--season"),
    out_dir: Path = typer.Option(
        Path("data/sj/draft_sim"),
        "--out-dir",
        help="Store root for draft_sim/{scoring}/{season}/slot_{N}.json",
    ),
    slots: str = typer.Option(
        "all",
        "--slots",
        help="Comma-separated 1-indexed slots, or 'all' for every roster slot.",
    ),
    n_sims: int = typer.Option(500, "--sims"),
    opponent_noise: float = typer.Option(0.25, "--opponent-noise"),
    samples: int = typer.Option(2000, "--samples"),
    lookback: int = typer.Option(3, "--lookback"),
    decay: float = typer.Option(0.5, "--decay"),
    expected_games: float = typer.Option(17.0, "--expected-games"),
    seed: int = typer.Option(0, "--seed"),
    generator: str = typer.Option("bootstrap", "--generator"),
    games_model: str = typer.Option("fixed", "--games-model"),
    level_sd: float = typer.Option(0.0, "--level-sd"),
    level_mean: float = typer.Option(1.0, "--level-mean"),
    conditioned_level: bool = typer.Option(
        True,
        "--conditioned-level/--no-conditioned-level",
        help="Default on: calibrated LevelModel path (roadmap 4.1).",
    ),
    include_rookies: bool = typer.Option(False, "--include-rookies"),
    pick_rate_top: int = typer.Option(40, "--pick-rate-top"),
    availability_top: int = typer.Option(80, "--availability-top"),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Write hub-consumable draft-sim snapshots (roadmap 4.5).

    Runs the same Monte Carlo snake draft as ``draft-sim`` for one or more
    slots and writes ``{out_dir}/{scoring}/{season}/slot_{N}.json``. Defaults
    to ``--conditioned-level``. The hub reads these files; it never invokes
    this CLI at request time.
    """
    from ffa.draft_export import build_draft_sim_document, write_draft_sim_snapshot
    from ffa.projections import scoring_slug

    cfg, summary = _load_simulation_summary(
        league,
        season,
        samples,
        lookback,
        decay,
        expected_games,
        seed,
        db,
        raw_dir,
        generator=generator,
        games_model=games_model,
        level_sd=level_sd,
        level_mean=level_mean,
        conditioned_level=conditioned_level,
        include_rookies=include_rookies,
    )
    ranked = compute_vor(summary, cfg.roster)
    slug = scoring_slug(cfg)
    teams = int(cfg.roster.teams)
    from ffa.draft import _slot_needs

    rounds = int(sum(_slot_needs(cfg.roster).values()))

    if slots.strip().lower() == "all":
        slot_list = list(range(1, teams + 1))
    else:
        try:
            slot_list = [int(part.strip()) for part in slots.split(",") if part.strip()]
        except ValueError:
            typer.echo(f"Invalid --slots {slots!r}; use 'all' or comma-separated ints.")
            raise typer.Exit(code=2)
    if not slot_list:
        typer.echo("--slots produced an empty list.")
        raise typer.Exit(code=2)
    for slot in slot_list:
        if slot < 1 or slot > teams:
            typer.echo(f"Slot {slot} out of range for {teams}-team league.")
            raise typer.Exit(code=2)

    source = {
        "engine": "ffa",
        "league": str(league),
        "generator": generator,
        "games_model": games_model,
        "lookback": lookback,
        "decay": decay,
        "expected_games": expected_games,
        "conditioned_level": conditioned_level,
        "level_sd": level_sd,
        "level_mean": level_mean,
        "include_rookies": include_rookies,
        "seed": seed,
        "sims": n_sims,
        "opponent_noise": opponent_noise,
        "samples": samples,
    }

    for slot in slot_list:
        result = simulate_draft(
            ranked,
            cfg.roster,
            user_slot=slot,
            n_sims=n_sims,
            opponent_noise=opponent_noise,
            seed=seed + slot,
        )
        document = build_draft_sim_document(
            result,
            ranked,
            scoring=slug,
            season=season,
            user_slot=slot,
            n_sims=n_sims,
            teams=teams,
            rounds=rounds,
            source=source,
            pick_rate_top=pick_rate_top,
            availability_top=availability_top,
        )
        path = write_draft_sim_snapshot(document, out_dir)
        typer.echo(
            f"Wrote slot {slot}: {len(document['pick_rates'])} pick-rates, "
            f"{len(document['availability'])} availability rows -> {path}"
        )


@app.command("export-player-map")
def export_player_map(
    season: int = typer.Option(..., "--season", help="NFL season for the map file."),
    out_dir: Path = typer.Option(
        Path("data/sj/player_map"),
        "--out-dir",
        help="Directory for {season}.json",
    ),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
    sj_root: Path | None = typer.Option(
        Path("data/sj"),
        "--sj-root",
        help="Hub store root for coverage denominator (football roster ESPN ids).",
    ),
    use_ff_playerids: bool = typer.Option(
        True,
        "--ff-playerids/--no-ff-playerids",
        help="Fill gaps from DynastyProcess load_ff_playerids().",
    ),
    fail_below: float | None = typer.Option(
        None,
        "--fail-below",
        help="Exit 1 if hub coverage rate is below this threshold (0-1).",
    ),
) -> None:
    """Write ESPN↔nflverse player map + coverage report (roadmap 4.3).

    Reads ``rosters.parquet`` (and optionally ff_playerids), writes
    ``{out_dir}/{season}.json``. Hub coverage uses unique ESPN ids on football
    league rosters under ``--sj-root``. The hub reads this file via
    ``getPlayerMap`` — it never invokes this CLI at request time.
    """
    import pandas as pd

    rosters_path = raw_dir / "rosters.parquet"
    if not rosters_path.exists():
        typer.echo(f"Missing {rosters_path}. Run `ffa ingest` first.")
        raise typer.Exit(code=1)

    rosters = pd.read_parquet(rosters_path)
    has_season = "season" in rosters.columns and (rosters["season"] == season).any()
    if not has_season:
        typer.echo(
            f"No roster rows for season {season}; preferring latest rows across "
            f"all seasons in {rosters_path}."
        )

    # Target season first (when present), then all seasons, then ff_playerids.
    primary = (
        crosswalk_from_rosters(rosters, season=season)
        if has_season
        else crosswalk_from_rosters(rosters, season=None)
    )
    all_seasons = crosswalk_from_rosters(rosters, season=None)
    fill = None
    if use_ff_playerids:
        try:
            fill = crosswalk_from_ff_playerids(fetch_ff_playerids())
            typer.echo(f"ff_playerids: {len(fill):,} espn↔gsis rows.")
        except Exception as exc:  # noqa: BLE001 -- network / schema soft-fail
            typer.echo(f"ff_playerids unavailable ({exc}); continuing with rosters only.")

    crosswalk = merge_crosswalks(primary, all_seasons, fill)

    hub_players: list = []
    if sj_root is not None and Path(sj_root).exists():
        hub_players = collect_hub_espn_players(Path(sj_root))
        typer.echo(f"Hub football ESPN ids: {len(hub_players):,} under {sj_root}")
    else:
        typer.echo("No --sj-root (or missing); hub coverage will be empty.")

    coverage = compute_hub_coverage(hub_players, crosswalk)
    stats = skill_roster_stats(
        rosters,
        season=season if has_season else None,
    )
    document = build_player_map_document(
        crosswalk,
        season=season,
        coverage=coverage,
        stats=stats,
        source={
            "engine": "ffa",
            "raw_dir": str(raw_dir),
            "sj_root": str(sj_root) if sj_root else None,
            "ff_playerids": bool(use_ff_playerids and fill is not None),
            "roster_rows": len(rosters),
        },
    )
    path = write_player_map(document, out_dir)
    rate = coverage.get("rate")
    rate_s = f"{rate:.1%}" if isinstance(rate, float) else "n/a"
    typer.echo(
        f"Wrote {document['stats']['mappings']:,} mappings -> {path} "
        f"(hub coverage {coverage['resolved']}/{coverage['rostered']} = {rate_s})"
    )
    if fail_below is not None:
        if rate is None:
            typer.echo("--fail-below set but hub coverage rate is null (no rostered ids).")
            raise typer.Exit(code=1)
        if rate < fail_below:
            typer.echo(
                f"Hub coverage {rate:.1%} below --fail-below {fail_below:.1%}."
            )
            raise typer.Exit(code=1)


@app.command()
def dashboard(
    league: Path = typer.Option(Path("configs/ppr.yaml"), "--league"),
    season: int = typer.Option(..., "--season"),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
    port: int = typer.Option(8501, "--port"),
) -> None:
    """Launch the Streamlit dashboard (requires the `dashboard` extra)."""
    import subprocess
    import sys

    try:
        import streamlit  # noqa: F401
    except ImportError as e:
        typer.echo(
            "Streamlit is not installed. Install the dashboard extras:\n"
            '  pip install -e ".[dashboard]"'
        )
        raise typer.Exit(code=1) from e

    app_path = Path(__file__).parent / "dashboard.py"
    cmd = [
        sys.executable,
        "-m",
        "streamlit",
        "run",
        str(app_path),
        "--server.port",
        str(port),
        "--",
        "--league",
        str(league),
        "--season",
        str(season),
        "--db",
        str(db),
        "--raw-dir",
        str(raw_dir),
    ]
    raise typer.Exit(code=subprocess.call(cmd))


if __name__ == "__main__":
    app()
