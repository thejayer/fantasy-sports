"""CLI for Strictly Jayers ESPN sync."""

from __future__ import annotations

from pathlib import Path

import typer

from sj.registry import load_registry
from sj.store import DEFAULT_STORE_DIR, list_snapshots
from sj.sync import sync_registry

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Strictly Jayers hub tools")


@app.command("leagues")
def leagues_cmd(
    registry: Path | None = typer.Option(None, help="Path to leagues.yaml"),
) -> None:
    """List leagues in the registry."""
    reg = load_registry(registry)
    for lg in reg.leagues:
        typer.echo(
            f"{lg.id:20} {lg.sport:10} {lg.format:8} espn={lg.espn_league_id} "
            f"current={lg.current_season} seasons={len(lg.seasons)}"
        )


@app.command("sync")
def sync_cmd(
    league: list[str] | None = typer.Option(
        None, "--league", "-l", help="League id (repeatable). Default: all."
    ),
    season: list[int] | None = typer.Option(
        None, "--season", "-s", help="Season year (repeatable). Default: all listed seasons."
    ),
    current_only: bool = typer.Option(
        False, "--current-only", help="Sync only each league's current_season."
    ),
    store_dir: Path = typer.Option(DEFAULT_STORE_DIR, help="Output directory for snapshots."),
    registry: Path | None = typer.Option(None, help="Path to leagues.yaml"),
) -> None:
    """Sync ESPN leagues into the local JSON store.

    Requires ESPN_S2 and ESPN_SWID (or SWID) environment variables for private leagues.
    """
    results = sync_registry(
        league_ids=league,
        seasons=season,
        current_only=current_only,
        registry_path=registry,
        store_dir=store_dir,
    )
    for result in results:
        typer.echo(
            f"synced {result.league_id} {result.season} "
            f"({result.team_count} teams) -> {result.path}"
        )
    typer.echo(f"done: {len(results)} snapshot(s)")


@app.command("status")
def status_cmd(
    store_dir: Path | None = typer.Option(None, help="Snapshot directory"),
) -> None:
    """Show snapshots available locally (or fixtures)."""
    items = list_snapshots(store_dir)
    if not items:
        typer.echo("No snapshots found. Run `sj sync` after setting ESPN credentials.")
        raise typer.Exit(code=1)
    for item in items:
        typer.echo(
            f"{item['league_id']:20} {item['season']}  "
            f"{item.get('team_count', '?')} teams  synced={item.get('synced_at', '?')}"
        )


if __name__ == "__main__":
    app()
