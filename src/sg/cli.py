"""CLI for Strictly Jayers fantasy golf (roadmap Phase 6)."""

from __future__ import annotations

from pathlib import Path

import typer

from sg.settings import DEFAULT_BENCH, DEFAULT_GOLF_SETTINGS, GolfSettings
from sg.snapshot import build_golf_snapshot, golf_settings_from_registry
from sj.registry import load_registry
from sj.store import DEFAULT_STORE_DIR, FileStore

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Strictly Jayers fantasy golf (PGA Tour counting model)",
)


@app.command("create-league")
def create_league_cmd(
    league_id: str = typer.Option(..., "--id", help="Slug used in hub URLs"),
    name: str = typer.Option(..., "--name", help="Display name"),
    season: int = typer.Option(..., "--season", help="Season year"),
    format: str = typer.Option("h2h", "--format", help="h2h | season_points"),
    teams: int = typer.Option(10, "--teams", help="Team count (6–14)"),
    bench: int = typer.Option(DEFAULT_BENCH, "--bench", help="Bench size (2–20)"),
    missed_cut: str = typer.Option("alt1", "--missed-cut", help="off | alt1 | alt1_2"),
    regular_mult: float = typer.Option(1.0, "--mult-regular"),
    signature_mult: float = typer.Option(1.5, "--mult-signature"),
    major_mult: float = typer.Option(2.0, "--mult-major"),
    draft_style: str = typer.Option("snake", "--draft-style", help="snake | auction"),
    keepers: bool = typer.Option(False, "--keepers/--no-keepers"),
    keeper_slots: int = typer.Option(
        0, "--keeper-slots", help="Keepers per team when --keepers (default 2)."
    ),
    budget: int = typer.Option(200, "--budget", help="Auction budget per team."),
    store_dir: Path | None = typer.Option(
        None, help="Write here instead of the default local data directory."
    ),
    short_name: str | None = typer.Option(None, "--short-name"),
    run_draft: bool = typer.Option(
        True, "--draft/--no-draft", help="Draft the OWGR fixture pool (snake or auction)."
    ),
) -> None:
    """Create a golf league with settings + optional offline draft."""
    golf = GolfSettings.model_validate(
        {
            **DEFAULT_GOLF_SETTINGS.model_dump(mode="json"),
            "draft": {
                "style": draft_style,
                "keepers": keepers,
                "keeper_slots": keeper_slots,
                "budget": budget,
            },
            "roster": {"starters": 5, "bench": bench},
            "missed_cut": {"mode": missed_cut},
            "multipliers": {
                "regular": regular_mult,
                "signature": signature_mult,
                "major": major_mult,
            },
        }
    )
    snapshot = build_golf_snapshot(
        league_id=league_id,
        name=name,
        short_name=short_name,
        season=season,
        format=format,
        team_count=teams,
        golf=golf,
        run_draft=run_draft,
    )
    root = Path(store_dir) if store_dir is not None else DEFAULT_STORE_DIR
    location = FileStore(root).write(snapshot)
    typer.echo(
        f"wrote {location} ({snapshot['team_count']} teams, format={format}, "
        f"{len(snapshot['draft'])} draft picks)"
    )


@app.command("seed-registry")
def seed_registry_cmd(
    league: list[str] | None = typer.Option(
        None, "--league", "-l", help="Golf league id (repeatable). Default: all golf."
    ),
    store_dir: Path | None = typer.Option(None, help="Local store directory"),
    registry: Path | None = typer.Option(None, help="Path to leagues.yaml"),
) -> None:
    """Write golf leagues from the registry into the local store."""
    reg = load_registry(registry)
    selected = [lg for lg in reg.leagues if lg.sport == "golf"]
    if league:
        wanted = set(league)
        selected = [lg for lg in selected if lg.id in wanted]
        missing = wanted - {lg.id for lg in selected}
        if missing:
            typer.echo(f"error: unknown golf league id(s): {sorted(missing)}", err=True)
            raise typer.Exit(code=1)
    if not selected:
        typer.echo("No golf leagues in registry.", err=True)
        raise typer.Exit(code=1)

    root = Path(store_dir) if store_dir is not None else DEFAULT_STORE_DIR
    store = FileStore(root)
    for spec in selected:
        teams = int(spec.team_count or 10)
        snapshot = build_golf_snapshot(
            league_id=spec.id,
            name=spec.name,
            short_name=spec.short_name,
            season=spec.current_season,
            format=spec.format,
            team_count=teams,
            golf=golf_settings_from_registry(spec),
        )
        location = store.write(snapshot)
        typer.echo(f"seeded {spec.id} {spec.current_season} → {location}")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
