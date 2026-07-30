"""Committed fallback fixtures under ``fixtures/sj/`` (roadmap 2.5).

Live writers emit schema_version 2. Committed fixtures stay on schema_version 1
monoliths so the dual-read path stays exercised, but they are regenerated from
the same serializer ``sj sync`` / ``sj seed`` use — no hand-maintained field
lists. Team counts stay small (3–4) so the files remain reviewable; use
``sj seed`` for realistic-scale local data.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sj.registry import LeagueSpec, load_registry
from sj.sample import sample_pro_schedule_for_snapshot, sample_snapshot
from sj.store import FIXTURES_DIR, INDEX_NAME, FileStore, monolith_rel

# Stable stamp so regenerating fixtures is a pure function of the serializer +
# registry — no wall-clock noise in git diffs.
FIXED_TIMESTAMP = "2026-07-27T00:00:00+00:00"

# Keep the committed fallbacks small; ``sj seed`` covers real scale.
FIXTURE_TEAM_COUNTS: dict[str, int] = {
    "football-main": 4,
    "football-dynasty": 3,
    "baseball-dynasty": 3,
    "golf-main": 8,
}


def fixture_team_count(spec: LeagueSpec) -> int:
    return FIXTURE_TEAM_COUNTS.get(spec.id, 3)


def expected_fixture_snapshot(spec: LeagueSpec, season: int | None = None) -> dict[str, Any]:
    """Build the snapshot that should be committed for one league-season."""
    target = spec.current_season if season is None else season
    if spec.sport == "golf":
        from sg.snapshot import build_golf_snapshot, golf_settings_from_registry

        # Pass FIXED_TIMESTAMP into the builder so lineup saved_at / lock stamps
        # stay deterministic (not wall-clock).
        return build_golf_snapshot(
            league_id=spec.id,
            name=spec.name,
            short_name=spec.short_name,
            season=target,
            format=spec.format,
            team_count=int(spec.team_count or fixture_team_count(spec)),
            golf=golf_settings_from_registry(spec),
            synced_at=FIXED_TIMESTAMP,
        )
    snapshot = sample_snapshot(spec, target, teams=fixture_team_count(spec))
    return {**snapshot, "synced_at": FIXED_TIMESTAMP}


def _dump(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def regenerate_fixtures(
    *,
    fixtures_dir: Path | str | None = None,
    registry_path: Path | str | None = None,
    on_event: Any = None,
) -> list[tuple[str, int, str]]:
    """Rewrite committed fixtures from the live serializer.

    Writes one schema_version 1 monolith per league at ``current_season``,
    refreshes ``index.json``, and deletes stale season files for those leagues.
    """
    root = Path(fixtures_dir) if fixtures_dir is not None else FIXTURES_DIR
    registry = load_registry(registry_path)

    def emit(message: str) -> None:
        if on_event is not None:
            on_event(message)

    root.mkdir(parents=True, exist_ok=True)
    written: list[tuple[str, int, str]] = []
    index_leagues: list[dict[str, Any]] = []

    for spec in registry.leagues:
        season = spec.current_season
        snapshot = expected_fixture_snapshot(spec, season)
        league_dir = root / spec.id
        league_dir.mkdir(parents=True, exist_ok=True)

        # Drop other seasons for this league so football/2025.json cannot linger.
        keep_name = f"{season}.json"
        for stale in league_dir.glob("*.json"):
            if stale.name != keep_name:
                stale.unlink()
                emit(f"removed stale fixture {stale.relative_to(root)}")

        rel = monolith_rel(spec.id, season)
        path = root / rel
        path.write_text(_dump(snapshot), encoding="utf-8")
        if spec.sport == "baseball":
            # Side concerns (not validated against monolith equality).
            store = FileStore(root)
            store.write_pro_schedule(sample_pro_schedule_for_snapshot(snapshot))
            emit(f"wrote {spec.id}/{season}/pro_schedule.json")
            week = int(snapshot.get("current_week") or 1)
            teams = snapshot.get("teams") or []
            if len(teams) >= 2:
                from sj.serialize import build_week_category_document

                class _CatBox:
                    def __init__(self, home: dict, away: dict):
                        self.home_team = home["team_id"]
                        self.away_team = away["team_id"]
                        self.home_wins, self.home_losses, self.home_ties = 6, 3, 1
                        self.away_wins, self.away_losses, self.away_ties = 3, 6, 1
                        cats = ["R", "HR", "RBI", "SB", "AVG", "W", "SV", "K", "ERA", "WHIP"]
                        self.home_stats = {
                            c: {"value": 10.0 + i, "result": "WIN" if i % 2 == 0 else "LOSS"}
                            for i, c in enumerate(cats)
                        }
                        self.away_stats = {
                            c: {"value": 9.0 + i, "result": "LOSS" if i % 2 == 0 else "WIN"}
                            for i, c in enumerate(cats)
                        }

                doc = build_week_category_document(
                    league_id=spec.id,
                    season=season,
                    week=week,
                    box_scores=[_CatBox(teams[0], teams[1])],
                    synced_at=FIXED_TIMESTAMP,
                    period_label="period",
                )
                store.write_week_box_scores(doc)
                emit(f"wrote {spec.id}/{season}/weeks/{week}.json")
        written.append((spec.id, season, str(path)))
        index_leagues.append(
            {
                "league_id": snapshot["league_id"],
                "espn_league_id": snapshot.get("espn_league_id"),
                "name": snapshot.get("name"),
                "sport": snapshot.get("sport"),
                "format": snapshot.get("format"),
                "season": snapshot.get("season"),
                "team_count": snapshot.get("team_count"),
                "synced_at": snapshot.get("synced_at"),
                "path": rel,
            }
        )
        emit(
            f"wrote {rel} "
            f"({snapshot['team_count']} teams, {len(snapshot['players'])} players)"
        )

    index_leagues.sort(key=lambda item: (item["league_id"], -(item["season"] or 0)))
    index_doc = {"generated_at": FIXED_TIMESTAMP, "leagues": index_leagues}
    (root / INDEX_NAME).write_text(_dump(index_doc), encoding="utf-8")
    emit(f"wrote {INDEX_NAME} ({len(index_leagues)} leagues)")
    return written


def validate_fixtures(
    *,
    fixtures_dir: Path | str | None = None,
    registry_path: Path | str | None = None,
) -> list[str]:
    """Return human-readable errors if committed fixtures drift from the serializer."""
    root = Path(fixtures_dir) if fixtures_dir is not None else FIXTURES_DIR
    registry = load_registry(registry_path)
    errors: list[str] = []

    index_path = root / INDEX_NAME
    if not index_path.exists():
        return [f"missing {INDEX_NAME}"]

    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"unreadable {INDEX_NAME}: {exc}"]

    indexed = {
        (item.get("league_id"), item.get("season")): item
        for item in (index.get("leagues") or [])
    }

    for spec in registry.leagues:
        season = spec.current_season
        expected = expected_fixture_snapshot(spec, season)
        rel = monolith_rel(spec.id, season)
        path = root / rel
        if not path.exists():
            errors.append(f"missing fixture {rel}")
            continue
        try:
            actual = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"unreadable {rel}: {exc}")
            continue
        if actual != expected:
            errors.append(
                f"{rel} does not match serializer output; "
                "run `sj regenerate-fixtures`"
            )

        entry = indexed.get((spec.id, season))
        if entry is None:
            errors.append(f"{INDEX_NAME} missing entry for {spec.id} {season}")
        else:
            if entry.get("path") != rel:
                errors.append(
                    f"{INDEX_NAME} path for {spec.id} {season} is "
                    f"{entry.get('path')!r}, expected {rel!r}"
                )
            if entry.get("team_count") != expected["team_count"]:
                errors.append(
                    f"{INDEX_NAME} team_count for {spec.id} {season} is "
                    f"{entry.get('team_count')!r}, expected {expected['team_count']!r}"
                )

        # No leftover seasons for this league.
        for extra in sorted((root / spec.id).glob("*.json")):
            if extra.name != f"{season}.json":
                errors.append(f"stale fixture {extra.relative_to(root)}")

    expected_keys = {(spec.id, spec.current_season) for spec in registry.leagues}
    for key in sorted(indexed):
        if key not in expected_keys:
            errors.append(f"{INDEX_NAME} has unexpected entry {key[0]} {key[1]}")

    return errors
