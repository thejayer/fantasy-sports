"""Command line entrypoints.

Examples:
    ffa ingest --season 2023 --season 2024
    ffa score --league configs/ppr.yaml --season 2024 --week 5 --limit 25
"""

from __future__ import annotations

from pathlib import Path

import typer

from ffa.draft import simulate_draft, summarize_user_picks
from ffa.ingest import ingest_seasons, open_warehouse
from ffa.learned import simulate_seasons_learned
from ffa.league import load_league
from ffa.optimize import optimize_lineup
from ffa.projection import project_per_game, project_season
from ffa.quantile import simulate_seasons_quantile_calibrated
from ffa.ranking import assign_tiers, compute_vor
from ffa.scoring import score_player_weeks
from ffa.simulation import simulate_seasons, summarize_seasons

app = typer.Typer(add_completion=False, help="Fantasy football analytics pipeline.")


# Generator name -> (simulator function, history multiplier for training).
# The learned/quantile generators need more history (training data) than the
# pure bootstrap, so we pull extra seasons when those are selected.
_GENERATORS = {
    "bootstrap": (simulate_seasons, 0),
    "learned": (simulate_seasons_learned, 2),
    "quantile": (simulate_seasons_quantile_calibrated, 2),
}


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
    out: Path | None = typer.Option(None, "--out", help="Optional Parquet path for the summary."),
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Distributional projections; print mean / sd / 5-95 quantiles."""
    _, summary = _load_simulation_summary(
        league, season, samples, lookback, decay, expected_games, seed, db, raw_dir,
        generator=generator,
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
):
    """Shared helper: pull weekly history -> samples -> posterior summary.

    ``generator`` chooses the simulator: ``bootstrap`` (phase 3),
    ``learned`` (phase 5), or ``quantile`` (phase 6). All three return
    the same long DataFrame, so downstream code is identical.
    """
    if generator not in _GENERATORS:
        typer.echo(
            f"Unknown generator: {generator!r}. Choose from: {list(_GENERATORS)}."
        )
        raise typer.Exit(code=2)

    simulator, history_pad = _GENERATORS[generator]
    cfg = load_league(league)
    con = open_warehouse(db_path=db, raw_dir=raw_dir)
    seasons = list(range(season - (lookback + history_pad), season))
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
        seed=seed,
    )
    return cfg, summarize_seasons(samples_df, cfg)


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
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Posterior summary + VOR + tiers."""
    cfg, summary = _load_simulation_summary(
        league, season, samples, lookback, decay, expected_games, seed, db, raw_dir,
        generator=generator,
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
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """ILP roster optimizer; max VOR subject to slots and optional budget."""
    import pandas as pd

    cfg, summary = _load_simulation_summary(
        league, season, samples, lookback, decay, expected_games, seed, db, raw_dir,
        generator=generator,
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
    db: Path = typer.Option(Path("data/ffa.duckdb"), "--db"),
    raw_dir: Path = typer.Option(Path("data/raw"), "--raw-dir"),
) -> None:
    """Monte Carlo snake draft from your slot; prints pick-rate table."""
    cfg, summary = _load_simulation_summary(
        league, season, samples, lookback, decay, expected_games, seed, db, raw_dir,
        generator=generator,
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
