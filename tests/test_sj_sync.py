"""Failure-path coverage for ``sj.sync`` — no live ESPN calls."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import requests
from espn_api.requests.espn_requests import (
    ESPNAccessDenied,
    ESPNInvalidLeague,
    ESPNUnknownError,
)
from typer.testing import CliRunner

from sj.cli import app
from sj.registry import LeagueSpec, load_registry
from sj.sample import sample_league
from sj.sync import (
    ACTIVITY_MIN_SEASON,
    DEFAULT_ACTIVITY_MAX_PAGES,
    FREE_AGENT_MIN_SEASON,
    MAX_ACTIVITY_MAX_PAGES,
    SyncAllFailed,
    SyncFailure,
    SyncResult,
    activity_max_pages,
    classify_sync_error,
    espn_call,
    espn_credentials,
    failures_should_fail_run,
    fetch_free_agents,
    fetch_recent_activity,
    notify_hub_revalidate,
    open_espn_league,
    sync_league_season,
    sync_registry,
    sync_summary_line,
)

MINI_REGISTRY = """\
leagues:
  - id: football-main
    name: Test Football
    short_name: FB
    sport: football
    format: redraft
    platform: espn
    espn_league_id: 39790
    seasons: [2024, 2025]
    current_season: 2025
  - id: baseball-dynasty
    name: Test Baseball
    short_name: BB
    sport: baseball
    format: dynasty
    platform: espn
    espn_league_id: 2499137
    seasons: [2025]
    current_season: 2025
"""


@pytest.fixture
def registry_path(tmp_path: Path) -> Path:
    path = tmp_path / "leagues.yaml"
    path.write_text(MINI_REGISTRY, encoding="utf-8")
    return path


@pytest.fixture
def football_spec(registry_path: Path) -> LeagueSpec:
    return load_registry(registry_path).by_id("football-main")


# ---------------------------------------------------------------------------
# classify_sync_error
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("exc", "kind"),
    [
        (RuntimeError("ESPN_S2 and ESPN_SWID (or SWID) env vars are required"), "credentials"),
        (ESPNAccessDenied("bad cookies"), "access_denied"),
        (ESPNInvalidLeague("League 1 does not exist"), "invalid_league"),
        (ConnectionError("dns failed"), "network"),
        (TimeoutError("timed out"), "network"),
        (requests.exceptions.ConnectionError("conn reset"), "network"),
        (requests.exceptions.Timeout("slow"), "network"),
        (ESPNUnknownError("ESPN returned an HTTP 500"), "unknown"),
        (ValueError("weird"), "unknown"),
    ],
)
def test_classify_sync_error(exc, kind):
    assert classify_sync_error(exc) == kind


def test_failures_should_fail_run_policies():
    invalid = [SyncFailure("x", 2020, "gone", kind="invalid_league")]
    denied = [SyncFailure("x", 2025, "nope", kind="access_denied")]
    mixed = invalid + denied

    assert failures_should_fail_run([]) is False
    assert failures_should_fail_run(invalid) is True
    assert failures_should_fail_run(invalid, tolerate_invalid_league=True) is False
    assert failures_should_fail_run(denied, tolerate_invalid_league=True) is True
    assert failures_should_fail_run(mixed, tolerate_invalid_league=True) is True


def test_sync_summary_line_is_parseable():
    results = [SyncResult("football-main", 2025, "/tmp/x", 10)]
    failures = [SyncFailure("football-main", 2024, "gone", kind="invalid_league")]
    line = sync_summary_line(results, failures, ok=False)
    assert line.startswith("SYNC_SUMMARY ")
    payload = json.loads(line.removeprefix("SYNC_SUMMARY "))
    assert payload == {
        "failed": 1,
        "failures": [
            {
                "error": "gone",
                "kind": "invalid_league",
                "league_id": "football-main",
                "season": 2024,
            }
        ],
        "kinds": {"invalid_league": 1},
        "ok": False,
        "synced": 1,
    }


# ---------------------------------------------------------------------------
# credentials / open_espn_league
# ---------------------------------------------------------------------------


def test_espn_credentials_reads_primary_and_aliases(monkeypatch):
    monkeypatch.delenv("ESPN_S2", raising=False)
    monkeypatch.delenv("ESPN_S2_COOKIE", raising=False)
    monkeypatch.delenv("ESPN_SWID", raising=False)
    monkeypatch.delenv("SWID", raising=False)
    assert espn_credentials() == (None, None)

    monkeypatch.setenv("ESPN_S2_COOKIE", "s2-alt")
    monkeypatch.setenv("SWID", "{swid-alt}")
    assert espn_credentials() == ("s2-alt", "{swid-alt}")

    monkeypatch.setenv("ESPN_S2", "s2")
    monkeypatch.setenv("ESPN_SWID", "{swid}")
    assert espn_credentials() == ("s2", "{swid}")


def test_open_espn_league_requires_credentials(football_spec, monkeypatch):
    monkeypatch.delenv("ESPN_S2", raising=False)
    monkeypatch.delenv("ESPN_S2_COOKIE", raising=False)
    monkeypatch.delenv("ESPN_SWID", raising=False)
    monkeypatch.delenv("SWID", raising=False)
    with pytest.raises(RuntimeError, match="ESPN_S2"):
        open_espn_league(football_spec, 2025)


@pytest.mark.parametrize(
    ("sport", "module_path"),
    [
        ("football", "espn_api.football.League"),
        ("baseball", "espn_api.baseball.League"),
        ("basketball", "espn_api.basketball.League"),
    ],
)
def test_open_espn_league_dispatches_by_sport(monkeypatch, sport, module_path):
    monkeypatch.setenv("ESPN_S2", "s2")
    monkeypatch.setenv("ESPN_SWID", "{swid}")
    fake = MagicMock(name="League")
    monkeypatch.setattr(module_path, fake)
    spec = LeagueSpec(
        id="lg",
        name="L",
        short_name="L",
        sport=sport,
        format="redraft",
        espn_league_id=1,
        seasons=[2025],
        current_season=2025,
    )
    opened = open_espn_league(spec, 2025)
    fake.assert_called_once_with(league_id=1, year=2025, espn_s2="s2", swid="{swid}")
    assert opened is fake.return_value


# ---------------------------------------------------------------------------
# sync_registry failure modes (mocked ESPN)
# ---------------------------------------------------------------------------


def _patch_season_outcomes(monkeypatch, outcomes: dict[tuple[str, int], Exception | object]):
    """Patch sync_league_season so each (league_id, season) raises or returns."""

    def fake(spec, season, store_dir=None):
        key = (spec.id, season)
        outcome = outcomes[key]
        if isinstance(outcome, Exception):
            raise outcome
        return SyncResult(spec.id, season, f"/tmp/{spec.id}/{season}.json", 10)

    monkeypatch.setattr("sj.sync.sync_league_season", fake)


def test_missing_credentials_classified_and_collected(
    registry_path, tmp_path, monkeypatch
):
    monkeypatch.delenv("ESPN_S2", raising=False)
    monkeypatch.delenv("ESPN_S2_COOKIE", raising=False)
    monkeypatch.delenv("ESPN_SWID", raising=False)
    monkeypatch.delenv("SWID", raising=False)

    with pytest.raises(SyncAllFailed) as raised:
        sync_registry(
            league_ids=["football-main"],
            seasons=[2025],
            registry_path=registry_path,
            store_dir=tmp_path,
        )
    assert raised.value.failures[0].kind == "credentials"


def test_access_denied_vs_invalid_league(registry_path, tmp_path, monkeypatch):
    events: list[str] = []
    _patch_season_outcomes(
        monkeypatch,
        {
            ("football-main", 2024): ESPNInvalidLeague("League does not exist"),
            ("football-main", 2025): ESPNAccessDenied("bad credentials"),
        },
    )
    with pytest.raises(SyncAllFailed) as raised:
        sync_registry(
            league_ids=["football-main"],
            registry_path=registry_path,
            store_dir=tmp_path,
            on_event=events.append,
        )
    kinds = {f.season: f.kind for f in raised.value.failures}
    assert kinds == {2024: "invalid_league", 2025: "access_denied"}
    assert any("[invalid_league]" in e for e in events)
    assert any("[access_denied]" in e for e in events)


def test_network_error_partial_season_failure(registry_path, tmp_path, monkeypatch):
    _patch_season_outcomes(
        monkeypatch,
        {
            ("football-main", 2024): requests.exceptions.ConnectionError("boom"),
            ("football-main", 2025): object(),  # success sentinel
        },
    )
    results, failures = sync_registry(
        league_ids=["football-main"],
        registry_path=registry_path,
        store_dir=tmp_path,
    )
    assert len(results) == 1 and results[0].season == 2025
    assert len(failures) == 1
    assert failures[0].kind == "network"
    assert failures[0].season == 2024


def test_throttle_sleeps_between_attempts(registry_path, tmp_path, monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr("sj.sync.time.sleep", sleeps.append)
    _patch_season_outcomes(
        monkeypatch,
        {
            ("football-main", 2024): object(),
            ("football-main", 2025): object(),
        },
    )
    sync_registry(
        league_ids=["football-main"],
        registry_path=registry_path,
        store_dir=tmp_path,
        throttle_seconds=1.5,
    )
    assert sleeps == [1.5, 1.5]


def test_unknown_league_id_raises(registry_path, tmp_path):
    with pytest.raises(KeyError, match="nope"):
        sync_registry(
            league_ids=["nope"],
            registry_path=registry_path,
            store_dir=tmp_path,
        )


def test_current_only_skips_historical(registry_path, tmp_path, monkeypatch):
    seen: list[int] = []

    def fake(spec, season, store_dir=None):
        seen.append(season)
        return SyncResult(spec.id, season, "/tmp/x", 10)

    monkeypatch.setattr("sj.sync.sync_league_season", fake)
    results, failures = sync_registry(
        league_ids=["football-main"],
        current_only=True,
        registry_path=registry_path,
        store_dir=tmp_path,
    )
    assert seen == [2025]
    assert len(results) == 1 and not failures


def test_sync_league_season_writes_snapshot(
    football_spec, tmp_path, monkeypatch
):
    monkeypatch.setenv("ESPN_S2", "s2")
    monkeypatch.setenv("ESPN_SWID", "{swid}")
    sample = sample_league(football_spec, 2025, teams=4)
    monkeypatch.setattr("sj.sync.open_espn_league", lambda *a, **k: sample)

    result = sync_league_season(football_spec, 2025, store_dir=tmp_path)
    assert result.team_count == 4
    season_dir = tmp_path / "football-main" / "2025"
    assert (season_dir / "manifest.json").exists()
    assert (season_dir / "settings.json").exists()
    assert (season_dir / "transactions.json").exists()
    assert (season_dir / "free_agents.json").exists()
    assert not (tmp_path / "football-main" / "2025.json").exists()
    settings = json.loads((season_dir / "settings.json").read_text(encoding="utf-8"))
    txns = json.loads((season_dir / "transactions.json").read_text(encoding="utf-8"))
    agents = json.loads((season_dir / "free_agents.json").read_text(encoding="utf-8"))
    assert settings["settings"]["faab"] is True
    assert len(txns["transactions"]) >= 1
    assert len(agents["free_agents"]) >= 1
    assert agents["free_agents"][0]["slot"] == "FA"


def test_espn_call_retries_transient_errors(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr("sj.sync.time.sleep", sleeps.append)
    attempts = {"n": 0}

    def flaky():
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise TimeoutError("slow")
        return "ok"

    assert espn_call(flaky, max_attempts=4, base_delay=0.1) == "ok"
    assert attempts["n"] == 3
    assert sleeps == [0.1, 0.2]


def test_espn_call_does_not_retry_access_denied():
    def boom():
        raise ESPNAccessDenied("nope")

    with pytest.raises(ESPNAccessDenied):
        espn_call(boom, max_attempts=4)


def test_fetch_recent_activity_empty_before_2019():
    league = MagicMock()
    league.year = ACTIVITY_MIN_SEASON - 1
    assert fetch_recent_activity(league) == []
    league.recent_activity.assert_not_called()


def test_fetch_recent_activity_pages_until_short(monkeypatch):
    monkeypatch.setattr("sj.sync.time.sleep", lambda *_a, **_k: None)
    league = MagicMock()
    league.year = 2025
    league.recent_activity.side_effect = [
        [MagicMock(name="a"), MagicMock(name="b")],
        [MagicMock(name="c")],
    ]
    items = fetch_recent_activity(league, page_size=2, max_pages=5)
    assert len(items) == 3
    assert league.recent_activity.call_args_list[0].kwargs == {
        "size": 2,
        "offset": 0,
    }
    assert league.recent_activity.call_args_list[1].kwargs == {
        "size": 2,
        "offset": 2,
    }


def test_fetch_recent_activity_treats_invalid_league_as_empty():
    """Historical activity endpoints often raise ESPNInvalidLeague falsely."""
    league = MagicMock()
    league.year = 2019
    league.recent_activity.side_effect = ESPNInvalidLeague(
        "League 39790 does not exist"
    )
    assert fetch_recent_activity(league) == []


def test_fetch_recent_activity_stops_at_max_pages(monkeypatch):
    monkeypatch.setattr("sj.sync.time.sleep", lambda *_a, **_k: None)
    league = MagicMock()
    league.year = 2025
    league.recent_activity.side_effect = lambda **_kw: [MagicMock(), MagicMock()]
    items = fetch_recent_activity(league, page_size=2, max_pages=3)
    assert len(items) == 6
    assert league.recent_activity.call_count == 3


def test_activity_max_pages_from_env(monkeypatch):
    monkeypatch.delenv("SJ_ACTIVITY_MAX_PAGES", raising=False)
    assert activity_max_pages() == DEFAULT_ACTIVITY_MAX_PAGES
    monkeypatch.setenv("SJ_ACTIVITY_MAX_PAGES", "12")
    assert activity_max_pages() == 12
    monkeypatch.setenv("SJ_ACTIVITY_MAX_PAGES", "9999")
    assert activity_max_pages() == MAX_ACTIVITY_MAX_PAGES
    monkeypatch.setenv("SJ_ACTIVITY_MAX_PAGES", "nope")
    assert activity_max_pages() == DEFAULT_ACTIVITY_MAX_PAGES


def test_fetch_recent_activity_uses_env_page_cap(monkeypatch):
    monkeypatch.setattr("sj.sync.time.sleep", lambda *_a, **_k: None)
    monkeypatch.setenv("SJ_ACTIVITY_MAX_PAGES", "2")
    league = MagicMock()
    league.year = 2025
    league.recent_activity.side_effect = lambda **_kw: [MagicMock(), MagicMock()]
    items = fetch_recent_activity(league, page_size=2)
    assert len(items) == 4
    assert league.recent_activity.call_count == 2


def test_fetch_free_agents_empty_before_2019():
    league = MagicMock()
    league.year = FREE_AGENT_MIN_SEASON - 1
    assert fetch_free_agents(league) == []
    league.free_agents.assert_not_called()


def test_fetch_free_agents_passes_size(monkeypatch):
    monkeypatch.setattr("sj.sync.time.sleep", lambda *_a, **_k: None)
    league = MagicMock()
    league.year = 2025
    league.free_agents.return_value = [MagicMock(name="fa")]
    items = fetch_free_agents(league, size=10)
    assert len(items) == 1
    assert league.free_agents.call_args.kwargs == {"size": 10}


def test_fetch_free_agents_unsupported_returns_empty(monkeypatch):
    monkeypatch.setattr("sj.sync.time.sleep", lambda *_a, **_k: None)
    league = MagicMock()
    league.year = 2020
    league.free_agents.side_effect = Exception("Cant use free agents before 2019")
    assert fetch_free_agents(league) == []


# ---------------------------------------------------------------------------
# CLI exit codes + SYNC_SUMMARY
# ---------------------------------------------------------------------------


def test_cli_sync_exits_nonzero_on_partial_failure(
    registry_path, tmp_path, monkeypatch
):
    _patch_season_outcomes(
        monkeypatch,
        {
            ("football-main", 2025): ESPNAccessDenied("nope"),
            ("baseball-dynasty", 2025): object(),
        },
    )
    # Patch where the CLI looks up the symbol (same module object).
    monkeypatch.setattr("sj.cli.sync_registry", sync_registry)

    result = CliRunner().invoke(
        app,
        [
            "sync",
            "--current-only",
            "--registry",
            str(registry_path),
            "--store-dir",
            str(tmp_path),
        ],
    )
    assert result.exit_code == 1, result.output
    assert "SYNC_SUMMARY " in result.output
    summary = json.loads(
        next(
            line.removeprefix("SYNC_SUMMARY ")
            for line in result.output.splitlines()
            if line.startswith("SYNC_SUMMARY ")
        )
    )
    assert summary["ok"] is False
    assert summary["synced"] == 1
    assert summary["failed"] == 1
    assert summary["kinds"] == {"access_denied": 1}


def test_cli_backfill_tolerates_invalid_league_only(
    registry_path, tmp_path, monkeypatch
):
    _patch_season_outcomes(
        monkeypatch,
        {
            ("football-main", 2024): ESPNInvalidLeague("gone"),
            ("football-main", 2025): object(),
            ("baseball-dynasty", 2025): object(),
        },
    )
    monkeypatch.setattr("sj.cli.sync_registry", sync_registry)

    result = CliRunner().invoke(
        app,
        [
            "backfill",
            "--registry",
            str(registry_path),
            "--store-dir",
            str(tmp_path),
            "--throttle",
            "0",
        ],
    )
    assert result.exit_code == 0, result.output
    summary = json.loads(
        next(
            line.removeprefix("SYNC_SUMMARY ")
            for line in result.output.splitlines()
            if line.startswith("SYNC_SUMMARY ")
        )
    )
    assert summary["ok"] is True
    assert summary["synced"] == 2
    assert summary["kinds"] == {"invalid_league": 1}


def test_cli_backfill_fails_loud_on_access_denied(
    registry_path, tmp_path, monkeypatch
):
    _patch_season_outcomes(
        monkeypatch,
        {
            ("football-main", 2024): ESPNInvalidLeague("gone"),
            ("football-main", 2025): ESPNAccessDenied("cookies"),
            ("baseball-dynasty", 2025): object(),
        },
    )
    monkeypatch.setattr("sj.cli.sync_registry", sync_registry)

    result = CliRunner().invoke(
        app,
        [
            "backfill",
            "--registry",
            str(registry_path),
            "--store-dir",
            str(tmp_path),
            "--throttle",
            "0",
        ],
    )
    assert result.exit_code == 1, result.output
    assert '"access_denied": 1' in result.output or '"access_denied":1' in result.output.replace(
        " ", ""
    )


def test_cli_sync_all_failed_emits_summary(registry_path, tmp_path, monkeypatch):
    _patch_season_outcomes(
        monkeypatch,
        {
            ("football-main", 2025): ESPNAccessDenied("nope"),
        },
    )
    monkeypatch.setattr("sj.cli.sync_registry", sync_registry)

    result = CliRunner().invoke(
        app,
        [
            "sync",
            "--league",
            "football-main",
            "--season",
            "2025",
            "--registry",
            str(registry_path),
            "--store-dir",
            str(tmp_path),
        ],
    )
    assert result.exit_code == 1, result.output
    assert "All sync attempts failed" in result.output
    assert "SYNC_SUMMARY " in result.output
    summary = json.loads(
        next(
            line.removeprefix("SYNC_SUMMARY ")
            for line in result.output.splitlines()
            if line.startswith("SYNC_SUMMARY ")
        )
    )
    assert summary["ok"] is False
    assert summary["failed"] == 1
    assert summary["kinds"] == {"access_denied": 1}


def test_cli_sync_unknown_league_exits_cleanly(registry_path, tmp_path):
    result = CliRunner().invoke(
        app,
        [
            "sync",
            "--league",
            "nope",
            "--registry",
            str(registry_path),
            "--store-dir",
            str(tmp_path),
        ],
    )
    assert result.exit_code == 1
    assert "nope" in result.output
    assert "Traceback" not in result.output


def test_notify_hub_revalidate_skips_without_env(monkeypatch):
    monkeypatch.delenv("SJ_REVALIDATE_URL", raising=False)
    monkeypatch.delenv("SJ_REVALIDATE_SECRET", raising=False)
    assert "skipped" in notify_hub_revalidate()


def test_notify_hub_revalidate_posts_bearer(monkeypatch):
    calls: list[object] = []

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def getcode(self):
            return 200

        status = 200

    def fake_urlopen(request, timeout=0):
        calls.append(request)
        return _Resp()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    status = notify_hub_revalidate(
        url="https://hub.example/api/revalidate",
        secret="s3cret",
    )
    assert status == "ok HTTP 200"
    assert len(calls) == 1
    req = calls[0]
    assert req.full_url == "https://hub.example/api/revalidate"
    assert req.get_header("Authorization") == "Bearer s3cret"
    assert req.get_method() == "POST"


def test_notify_hub_revalidate_swallows_errors(monkeypatch):
    def boom(*_args, **_kwargs):
        raise TimeoutError("nope")

    monkeypatch.setattr("urllib.request.urlopen", boom)
    status = notify_hub_revalidate(
        url="https://hub.example/api/revalidate",
        secret="s3cret",
    )
    assert status.startswith("failed")
    assert "TimeoutError" in status
