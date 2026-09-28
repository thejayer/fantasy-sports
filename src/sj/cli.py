"""CLI for Strictly Jayers ESPN sync."""

from __future__ import annotations

from pathlib import Path

import typer

from sj.fixtures import regenerate_fixtures, validate_fixtures
from sj.registry import load_registry
from sj.sample import DEFAULT_TEAM_COUNT, seed_store
from sj.store import describe_store, list_snapshots
from sj.sync import (
    SyncAllFailed,
    failures_should_fail_run,
    notify_hub_revalidate,
    open_espn_league,
    sync_registry,
    sync_summary_line,
)

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Strictly Jayers hub tools")


def _report_sync_outcome(
    results: list,
    failures: list,
    *,
    label: str,
    tolerate_invalid_league: bool,
) -> None:
    """Print human + machine-readable summaries; exit non-zero when required."""
    ok = not failures_should_fail_run(
        failures, tolerate_invalid_league=tolerate_invalid_league
    )
    typer.echo(f"{label}: {len(results)} synced, {len(failures)} failed")
    for failure in failures:
        typer.echo(
            f"  failed {failure.league_id} {failure.season} "
            f"[{failure.kind}]: {failure.error}",
            err=True,
        )
    typer.echo(sync_summary_line(results, failures, ok=ok))
    # Drop hub Data Cache entries when we wrote anything — best-effort.
    if results:
        typer.echo(f"hub revalidate: {notify_hub_revalidate()}")
    if not ok:
        raise typer.Exit(code=1)


@app.command("leagues")
def leagues_cmd(
    registry: Path | None = typer.Option(None, help="Path to leagues.yaml"),
) -> None:
    """List leagues in the registry."""
    reg = load_registry(registry)
    for lg in reg.leagues:
        platform = (
            f"espn={lg.espn_league_id}"
            if lg.platform == "espn"
            else f"platform={lg.platform}"
        )
        typer.echo(
            f"{lg.id:20} {lg.sport:10} {lg.format:14} {platform} "
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
    store_dir: Path | None = typer.Option(
        None, help="Write to this directory instead of the configured store."
    ),
    registry: Path | None = typer.Option(None, help="Path to leagues.yaml"),
    throttle: float = typer.Option(
        0.0, "--throttle", help="Seconds to pause between league-seasons."
    ),
) -> None:
    """Sync ESPN leagues into the snapshot store.

    Requires ESPN_S2 and ESPN_SWID (or SWID). Writes to Cloud Storage when
    SJ_GCS_BUCKET is set, otherwise to the local data directory.

    Any skipped league-season fails the run (exit 1) and prints a
    ``SYNC_SUMMARY`` line Cloud Scheduler / alerting can key on. Use
    ``sj backfill`` when historical seasons ESPN refuses should be tolerated.
    """
    typer.echo(f"store: {describe_store(store_dir)}")
    try:
        results, failures = sync_registry(
            league_ids=league,
            seasons=season,
            current_only=current_only,
            registry_path=registry,
            store_dir=store_dir,
            throttle_seconds=throttle,
            on_event=typer.echo,
        )
    except SyncAllFailed as exc:
        typer.echo(f"error: {exc}", err=True)
        typer.echo(sync_summary_line([], exc.failures, ok=False))
        raise typer.Exit(code=1) from exc
    except KeyError as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    _report_sync_outcome(
        results, failures, label="done", tolerate_invalid_league=False
    )


@app.command("backfill")
def backfill_cmd(
    league: list[str] | None = typer.Option(
        None, "--league", "-l", help="League id (repeatable). Default: all."
    ),
    store_dir: Path | None = typer.Option(
        None, help="Write to this directory instead of the configured store."
    ),
    registry: Path | None = typer.Option(None, help="Path to leagues.yaml"),
    throttle: float = typer.Option(
        1.0, "--throttle", help="Seconds to pause between league-seasons."
    ),
) -> None:
    """Sync every season in the registry, pausing between requests.

    ``invalid_league`` failures (seasons ESPN no longer serves) are reported
    but do not fail the run. Auth, network, and unknown errors still exit 1.
    """
    typer.echo(f"store: {describe_store(store_dir)}")
    try:
        results, failures = sync_registry(
            league_ids=league,
            current_only=False,
            registry_path=registry,
            store_dir=store_dir,
            throttle_seconds=throttle,
            on_event=typer.echo,
        )
    except SyncAllFailed as exc:
        typer.echo(f"error: {exc}", err=True)
        typer.echo(sync_summary_line([], exc.failures, ok=False))
        raise typer.Exit(code=1) from exc
    except KeyError as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    _report_sync_outcome(
        results,
        failures,
        label="backfill done",
        tolerate_invalid_league=True,
    )


@app.command("seed")
def seed_cmd(
    league: list[str] | None = typer.Option(
        None, "--league", "-l", help="League id (repeatable). Default: all."
    ),
    season: list[int] | None = typer.Option(
        None, "--season", "-s", help="Season year (repeatable). Default: all listed seasons."
    ),
    current_only: bool = typer.Option(
        False, "--current-only", help="Seed only each league's current_season."
    ),
    teams: int = typer.Option(DEFAULT_TEAM_COUNT, "--teams", help="Teams per league."),
    store_dir: Path | None = typer.Option(
        None, help="Write here instead of the default local data directory."
    ),
    registry: Path | None = typer.Option(None, help="Path to leagues.yaml"),
    force: bool = typer.Option(
        False, "--force", help="Overwrite a store that may hold real snapshots."
    ),
) -> None:
    """Fill the local store with realistic-scale SYNTHETIC snapshots.

    For local development and UI testing when you have no ESPN credentials, or
    when the committed fixtures are too small to show real behaviour. Output is
    deterministic per league-season and uses the same schema as `sj sync`.

    Never writes to Cloud Storage, and refuses to overwrite unmarked snapshots
    unless --force is passed.
    """
    try:
        written = seed_store(
            league_ids=league,
            seasons=season,
            current_only=current_only,
            teams=teams,
            registry_path=registry,
            store_dir=store_dir,
            force=force,
            on_event=typer.echo,
        )
    except (RuntimeError, KeyError, ValueError) as exc:
        # A refused overwrite or a bad league id is user error, not a crash.
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"seeded {len(written)} league-seasons of synthetic data")


@app.command("status")
def status_cmd(
    store_dir: Path | None = typer.Option(None, help="Snapshot directory"),
) -> None:
    """Show snapshots available in the store (or fixtures)."""
    typer.echo(f"store: {describe_store(store_dir)}")
    items = list_snapshots(store_dir)
    if not items:
        typer.echo("No snapshots found. Run `sj sync` after setting ESPN credentials.")
        raise typer.Exit(code=1)
    for item in items:
        typer.echo(
            f"{item['league_id']:20} {item['season']}  "
            f"{item.get('team_count', '?')} teams  synced={item.get('synced_at', '?')}"
        )


@app.command("analysis")
def analysis_cmd(
    league: list[str] | None = typer.Option(
        None, "--league", "-l", help="League id (repeatable). Default: baseball + hockey."
    ),
    season: list[int] | None = typer.Option(
        None, "--season", "-s", help="Season year (repeatable). Default: listed seasons."
    ),
    current_only: bool = typer.Option(
        False, "--current-only", help="Only each league's current_season."
    ),
    force: bool = typer.Option(
        False, "--force", help="Re-fetch every scoring period (ignore incremental cache)."
    ),
    store_dir: Path | None = typer.Option(
        None, help="Write to this directory instead of the configured store."
    ),
    registry: Path | None = typer.Option(None, help="Path to leagues.yaml"),
) -> None:
    """Rebuild season-points analysis sidecars (roadmap 8.5).

    Walks ESPN ``view=mRoster`` per scoring period and writes
    ``analysis/slot_points.json`` + ``analysis/points_timeseries.json``.
    Requires ESPN_S2 / ESPN_SWID. Incremental by default — completed
    periods are reused unless ``--force``. ``sj sync`` / ``sj backfill``
    already run this for season-points baseball and hockey leagues.
    """
    from sj.season_points_analysis import PROFILE_BY_SPORT, sync_season_points_analysis
    from sj.store import read_snapshot

    typer.echo(f"store: {describe_store(store_dir)}")
    reg = load_registry(registry)
    selected = [
        lg for lg in reg.leagues if lg.is_espn() and lg.sport in PROFILE_BY_SPORT
    ]
    if league:
        wanted = set(league)
        selected = [lg for lg in selected if lg.id in wanted]
        missing = wanted - {lg.id for lg in selected}
        if missing:
            typer.echo(
                f"error: unknown analysis league id(s): {sorted(missing)}",
                err=True,
            )
            raise typer.Exit(code=1)
    wrote = 0
    for spec in selected:
        if not spec.has_live_espn_id():
            typer.echo(f"skip {spec.id}: espn_league_id placeholder")
            continue
        target = [spec.current_season] if current_only else list(spec.seasons)
        if season is not None:
            target = [s for s in target if s in season]
        for year in target:
            try:
                espn = open_espn_league(spec, year)
                snapshot = read_snapshot(spec.id, year, store_dir=store_dir)
            except Exception as exc:  # noqa: BLE001
                typer.echo(f"skip {spec.id} {year}: {exc}", err=True)
                continue
            n = sync_season_points_analysis(
                espn, spec, year, snapshot, store_dir=store_dir, force=force
            )
            wrote += n
            typer.echo(f"analysis {spec.id} {year} ({n} files)")
    if wrote:
        typer.echo(f"hub revalidate: {notify_hub_revalidate()}")
    typer.echo(f"done: {wrote} analysis files")


@app.command("regenerate-fixtures")
def regenerate_fixtures_cmd(
    fixtures_dir: Path | None = typer.Option(
        None, help="Write here instead of the committed fixtures/sj directory."
    ),
    registry: Path | None = typer.Option(None, help="Path to leagues.yaml"),
) -> None:
    """Rewrite committed fixtures/sj from the live serializer (roadmap 2.5).

    Keeps schema_version 1 monoliths (so dual-read stays covered) but fills every
    field ``serialize_league`` emits. Deterministic; safe to re-run after schema
    changes.
    """
    written = regenerate_fixtures(
        fixtures_dir=fixtures_dir,
        registry_path=registry,
        on_event=typer.echo,
    )
    typer.echo(f"regenerated {len(written)} fixture league-seasons")


@app.command("validate-fixtures")
def validate_fixtures_cmd(
    fixtures_dir: Path | None = typer.Option(
        None, help="Check this directory instead of committed fixtures/sj."
    ),
    registry: Path | None = typer.Option(None, help="Path to leagues.yaml"),
) -> None:
    """Fail if committed fixtures drift from the serializer (roadmap 2.5)."""
    errors = validate_fixtures(fixtures_dir=fixtures_dir, registry_path=registry)
    if errors:
        for error in errors:
            typer.echo(f"error: {error}", err=True)
        typer.echo(
            "Fixtures out of date. Run `sj regenerate-fixtures` and commit.",
            err=True,
        )
        raise typer.Exit(code=1)
    typer.echo("fixtures ok")


if __name__ == "__main__":
    app()
