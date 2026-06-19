"""Command line entrypoints.

Examples:
    ffa ingest --season 2023 --season 2024
    ffa score --league configs/ppr.yaml --season 2024 --week 5 --limit 25
"""

from __future__ import annotations

from pathlib import Path

import typer

from ffa.backtest import GENERATORS as _GENERATORS
from ffa.backtest import run_backtest
from ffa.calibration import (
    dispersion_decomposition,
    dispersion_direction,
    quantile_calibration,
)
from ffa.draft import simulate_draft, summarize_user_picks
from ffa.games import GAMES_MODELS
from ffa.ingest import ingest_seasons, open_warehouse
from ffa.league import load_league
from ffa.optimize import optimize_lineup
from ffa.projection import project_per_game, project_season
from ffa.ranking import assign_tiers, compute_vor
from ffa.rookies import augment_with_rookies
from ffa.scoring import score_player_weeks
from ffa.simulation import summarize_seasons

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
        include_rookies=include_rookies,
    )

    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
        summary.to_parquet(out, index=False)
        typer.echo(f"Wrote {len(summary):,} rows -> {out}")

    cols = [c for c in ("player_display_name", "position", "recent_team") if c in summary.columns]
    show = [*cols, "points_mean", "points_sd", "q05", "q50", "q95"]
    show = [c for c in show if c in summary.columns]
    typer.echo(summary[show].head(limit).round(1).to_string(index=False))


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
    include_rookies: bool = False,
):
    """Shared helper: pull weekly history -> samples -> posterior summary.

    ``generator`` chooses the simulator: ``bootstrap`` (phase 3),
    ``learned`` (phase 5), or ``quantile`` (phase 6). All three return
    the same long DataFrame, so downstream code is identical.

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
        include_rookies=include_rookies,
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
        include_rookies=include_rookies,
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
        include_rookies=include_rookies,
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
