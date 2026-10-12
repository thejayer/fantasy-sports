"""AI rankings (roadmap 7.16). Offline — canned CFBD + injected model."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

import pytest

from sj.ai_rankings import (
    DEFAULT_LLM_MAX_ATTEMPTS,
    DEFAULT_LLM_TIMEOUT_SECONDS,
    DEFAULT_TEMPERATURE,
    DEFAULT_XAI_BASE,
    DEFAULT_XAI_MODEL,
    assemble_cfb_snapshot,
    assemble_fantasy_snapshot,
    attach_movers,
    build_cfb_facts,
    build_fantasy_facts,
    cfb_prompt,
    complete_openai_compatible,
    extract_json_object,
    fantasy_phase_and_label,
    load_prior,
    offseason_week_label,
    openai_compatible_body,
    persist_snapshot,
    rankings_force,
    rankings_llm_config_from_env,
    resolve_cfb_week_number,
    run_cfb_board,
    run_fantasy_board,
    week_label,
)
from sj.cfbd import (
    CfbdClient,
    accumulate_records,
    compact_week_results,
    default_cfb_season,
    estimated_cfb_week,
    latest_completed_week,
    parse_ap_poll,
    parse_games,
    parse_week_label,
)
from sj.cfbd import (
    week_label as cfbd_week_label,
)
from sj.snapshot_layout import ai_rankings_rel
from sj.store import FileStore, read_ai_rankings

ROOT = Path(__file__).resolve().parents[1]
CFBD = ROOT / "tests" / "fixtures" / "cfbd"
FIXTURES = ROOT / "fixtures" / "sj"


def _games():
    return parse_games(json.loads((CFBD / "games.json").read_text(encoding="utf-8")))


def _ap():
    return parse_ap_poll(json.loads((CFBD / "rankings.json").read_text(encoding="utf-8")), week=7)


def _fake_cfb_complete(_system: str, _prompt: str) -> str:
    return json.dumps(
        {
            "headline": "Buckeyes stay on top",
            "methodology": "Results and margins only.",
            "last_week_review": "Alabama beating Georgia was the correction.",
            "rankings": [
                {"rank": 1, "name": "Ohio State", "blurb": "Beat Oregon at home."},
                {"rank": 2, "name": "Alabama", "blurb": "Took down Georgia in Tuscaloosa."},
                {"rank": 3, "name": "Georgia", "blurb": "Lost on the road; still 1-loss."},
                {"rank": 4, "name": "Oregon", "blurb": "Close loss in Columbus."},
                {"rank": 5, "name": "Penn State", "blurb": "Rolled West Virginia."},
            ],
            "also_ranked": [
                {"rank": 26, "name": "Texas"},
                {"rank": 27, "name": "Oklahoma"},
                {"rank": 28, "name": "Washington"},
                {"rank": 29, "name": "West Virginia"},
                {"rank": 30, "name": "Kentucky"},
            ],
        }
    )


def test_week_label_and_season_clock():
    assert week_label(2026, 7) == "2026-w07"
    assert week_label(2026, 0) == "2026-off"
    assert cfbd_week_label(2026, 12) == "2026-w12"
    assert default_cfb_season(date(2026, 10, 12)) == 2026
    assert default_cfb_season(date(2027, 1, 8)) == 2026
    assert default_cfb_season(date(2027, 3, 1)) == 2026
    assert estimated_cfb_week(date(2026, 10, 12)) == 7
    assert estimated_cfb_week(date(2026, 8, 20)) == 0
    assert estimated_cfb_week(date(2027, 1, 8)) == 15
    assert estimated_cfb_week(date(2027, 3, 1)) == 0
    assert resolve_cfb_week_number(None, date(2026, 10, 12)) == 7
    assert resolve_cfb_week_number(8, date(2026, 10, 12)) == 8
    assert parse_week_label("2026-off") == (2026, 0)
    assert parse_week_label("2026-off-20261013") == (2026, 20261013)
    assert parse_week_label("2026-off-20261013") > parse_week_label("2026-w24")


def test_ai_rankings_rel_strips_traversal():
    assert ai_rankings_rel("cfb/2026-w08") == "ai_rankings/cfb/2026-w08.json"
    assert ai_rankings_rel("fantasy/football-main/2026-w14.json") == (
        "ai_rankings/fantasy/football-main/2026-w14.json"
    )
    assert ai_rankings_rel("cfb/../secret") == "ai_rankings/cfb/secret.json"
    # ``....`` must stay a literal segment — do not collapse it into ``..``.
    assert ai_rankings_rel("cfb/..../secret") == "ai_rankings/cfb/..../secret.json"
    with pytest.raises(ValueError):
        ai_rankings_rel("///")
    with pytest.raises(ValueError):
        ai_rankings_rel("..")


def test_cfbd_parse_records_and_ap():
    games = _games()
    assert latest_completed_week(games) == 7
    week = compact_week_results(games, 7)
    assert any(row["home"] == "Alabama" and row["score"] == "27-20" for row in week)
    assert any(row["neutral"] for row in week)
    records = accumulate_records(games)
    assert records["Ohio State"].record == "2-0"
    assert records["Georgia"].record == "1-1"
    ap = _ap()
    assert ap[0]["name"] == "Ohio State"
    assert ap[1]["rank"] == 2
    mixed = parse_ap_poll(
        [
            {
                "week": 7,
                "polls": [
                    {"poll": "Map Poll", "ranks": [{"rank": 1, "school": "Wrong"}]},
                    {
                        "poll": "AP Top 25",
                        "ranks": [{"rank": 1, "school": "Ohio State"}],
                    },
                ],
            }
        ],
        week=7,
    )
    assert mixed[0]["name"] == "Ohio State"


def test_cfbd_client_uses_injected_fetch():
    payload = json.loads((CFBD / "games.json").read_text(encoding="utf-8"))

    def fetch(path: str, params):
        assert path == "/games"
        assert params["year"] == 2026
        return payload

    client = CfbdClient(api_key="test", fetch=fetch)
    games = client.games(2026)
    assert len(games) == 7
    assert client.available


def test_llm_config_defaults_to_xai():
    config = rankings_llm_config_from_env(
        {"SJ_RANKINGS_API_KEY": "xai-test", "SJ_RANKINGS_PROVIDER": "xai"}
    )
    assert config is not None
    assert config.provider == "xai"
    assert config.model == DEFAULT_XAI_MODEL
    assert config.base_url == DEFAULT_XAI_BASE
    assert config.temperature == DEFAULT_TEMPERATURE
    assert config.timeout_s == DEFAULT_LLM_TIMEOUT_SECONDS
    assert config.max_attempts == DEFAULT_LLM_MAX_ATTEMPTS
    body = openai_compatible_body(config, "sys", "user")
    assert body["temperature"] == DEFAULT_TEMPERATURE
    assert body["messages"][0]["content"] == "sys"
    assert body["response_format"] == {"type": "json_object"}
    assert rankings_llm_config_from_env({}) is None


def test_complete_rejects_empty_choices(monkeypatch: pytest.MonkeyPatch):
    config = rankings_llm_config_from_env({"SJ_RANKINGS_API_KEY": "xai-test"})
    assert config is not None

    class _Resp:
        def read(self) -> bytes:
            return b'{"choices":[]}'

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(urllib.request, "urlopen", lambda *args, **kwargs: _Resp())
    with pytest.raises(RuntimeError, match="returned no text"):
        complete_openai_compatible(config, "sys", "user")


def test_llm_timeout_and_attempts_from_env():
    config = rankings_llm_config_from_env(
        {
            "SJ_RANKINGS_API_KEY": "xai-test",
            "SJ_RANKINGS_TIMEOUT_S": "600",
            "SJ_RANKINGS_MAX_ATTEMPTS": "3",
        }
    )
    assert config is not None
    assert config.timeout_s == 600
    assert config.max_attempts == 3
    assert rankings_force({}) is False
    assert rankings_force({"SJ_RANKINGS_FORCE": "1"}) is True
    assert rankings_force({"SJ_RANKINGS_FORCE": "yes"}) is True


def test_complete_retries_read_timeout_then_succeeds(monkeypatch: pytest.MonkeyPatch):
    config = rankings_llm_config_from_env(
        {
            "SJ_RANKINGS_API_KEY": "xai-test",
            "SJ_RANKINGS_TIMEOUT_S": "600",
            "SJ_RANKINGS_MAX_ATTEMPTS": "3",
        }
    )
    assert config is not None
    calls = {"n": 0}

    class _Resp:
        def read(self) -> bytes:
            return b'{"choices":[{"message":{"content":"{\\"ok\\":true}"}}]}'

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(_req, timeout=None):
        calls["n"] += 1
        assert timeout == 600
        if calls["n"] < 3:
            raise urllib.error.URLError(TimeoutError("The read operation timed out"))
        return _Resp()

    sleeps: list[float] = []
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    text = complete_openai_compatible(config, "sys", "user", sleeper=sleeps.append)
    assert '"ok"' in text
    assert calls["n"] == 3
    assert sleeps == [5.0, 10.0]


def test_complete_does_not_retry_unauthorized(monkeypatch: pytest.MonkeyPatch):
    config = rankings_llm_config_from_env({"SJ_RANKINGS_API_KEY": "xai-test"})
    assert config is not None
    calls = {"n": 0}

    def fake_urlopen(req, timeout=None):
        calls["n"] += 1
        raise urllib.error.HTTPError(
            req.full_url, 401, "Unauthorized", {}, None
        )

    sleeps: list[float] = []
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(RuntimeError, match="401"):
        complete_openai_compatible(config, "sys", "user", sleeper=sleeps.append)
    assert calls["n"] == 1
    assert sleeps == []


def test_cfb_prompt_omits_ap_poll():
    facts = build_cfb_facts(_games(), 7, 2026, _ap())
    assert facts["ap_poll"]
    assert "ap_poll" not in cfb_prompt(facts, None)


def test_extract_json_object_fenced_and_plain():
    assert extract_json_object('```json\n{"a": 1}\n```')["a"] == 1
    assert extract_json_object('noise {"b": 2} trailing')["b"] == 2
    with pytest.raises(ValueError):
        extract_json_object("no object here")


def test_movers_and_ap_delta():
    current = [
        {"rank": 1, "name": "Ohio State"},
        {"rank": 2, "name": "Alabama"},
        {"rank": 3, "name": "Texas"},
    ]
    prior = [
        {"rank": 1, "name": "Ohio State"},
        {"rank": 2, "name": "Texas"},
        {"rank": 3, "name": "Alabama"},
        {"rank": 4, "name": "Oregon"},
    ]
    decorated, movers = attach_movers(current, prior)
    assert decorated[1]["prev_rank"] == 3
    assert decorated[1]["delta"] == 1
    assert decorated[2]["delta"] == -1
    assert movers["risers"][0]["name"] == "Alabama"
    assert movers["dropped"][0]["name"] == "Oregon"


def test_cfb_board_injected_model(tmp_path: Path):
    payload_games = json.loads((CFBD / "games.json").read_text(encoding="utf-8"))
    payload_ap = json.loads((CFBD / "rankings.json").read_text(encoding="utf-8"))

    def fetch(path: str, params):
        if path == "/games":
            return payload_games
        if path == "/rankings":
            return payload_ap
        raise AssertionError(path)

    client = CfbdClient(api_key="test", fetch=fetch)
    snapshot = run_cfb_board(
        season=2026,
        week=7,
        store_dir=tmp_path,
        cfbd=client,
        complete=_fake_cfb_complete,
    )
    assert snapshot["week_label"] == "2026-w07"
    assert snapshot["rankings"][0]["name"] == "Ohio State"
    assert snapshot["rankings"][0]["ap_rank"] == 1
    assert snapshot["rankings"][0]["vs_ap"] == 0
    alabama = next(row for row in snapshot["rankings"] if row["name"] == "Alabama")
    assert alabama["ap_rank"] == 3
    assert alabama["vs_ap"] == -1
    names = [row["name"] for row in snapshot["full_rankings"]]
    assert "Kentucky" in names
    assert snapshot["ap_available"] is True
    stored = read_ai_rankings("cfb/2026-w07", store_dir=tmp_path)
    assert stored["headline"] == "Buckeyes stay on top"
    assert "prompt" not in stored
    trace = read_ai_rankings("cfb/2026-w07.trace", store_dir=tmp_path)
    assert "Ohio State" in trace["prompt"]
    assert "ap_poll" not in trace["prompt"]
    assert "Buckeyes stay on top" in trace["raw_response"]
    index = read_ai_rankings("cfb/index", store_dir=tmp_path)
    assert index["latest"] == "2026-w07"
    assert (tmp_path / "index.json").exists() is False


def test_cfb_degrades_without_api_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("SJ_CFBD_API_KEY", raising=False)
    monkeypatch.delenv("CFBD_API_KEY", raising=False)
    snapshot = run_cfb_board(season=2026, week=7, store_dir=tmp_path, persist=True)
    assert snapshot["rankings"] == []
    assert snapshot["degraded"]
    assert "sj-cfbd-api-key" in snapshot["degraded"][0]
    assert read_ai_rankings("cfb/2026-w07", store_dir=tmp_path)["degraded"]
    index = read_ai_rankings("cfb/index", store_dir=tmp_path)
    assert index["weeks"] == ["2026-w07"]


def test_cfb_degrades_without_week_uses_calendar_and_indexes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("SJ_CFBD_API_KEY", raising=False)
    monkeypatch.delenv("CFBD_API_KEY", raising=False)
    snapshot = run_cfb_board(
        season=2026,
        week=None,
        store_dir=tmp_path,
        persist=True,
        today=date(2026, 10, 12),
    )
    assert snapshot["week_label"] == "2026-w07"
    assert snapshot["rankings"] == []
    index = read_ai_rankings("cfb/index", store_dir=tmp_path)
    assert "2026-w07" in index["weeks"]
    assert read_ai_rankings("cfb/2026-w07", store_dir=tmp_path)["degraded"]


def test_cfb_skips_llm_when_facts_hash_matches(tmp_path: Path):
    payload_games = json.loads((CFBD / "games.json").read_text(encoding="utf-8"))
    payload_ap = json.loads((CFBD / "rankings.json").read_text(encoding="utf-8"))
    calls = {"n": 0}

    def fetch(path: str, params):
        if path == "/games":
            return payload_games
        if path == "/rankings":
            return payload_ap
        raise AssertionError(path)

    def complete(_system: str, _prompt: str) -> str:
        calls["n"] += 1
        return _fake_cfb_complete(_system, _prompt)

    client = CfbdClient(api_key="test", fetch=fetch)
    first = run_cfb_board(
        season=2026,
        week=7,
        store_dir=tmp_path,
        cfbd=client,
        complete=complete,
    )
    second = run_cfb_board(
        season=2026,
        week=7,
        store_dir=tmp_path,
        cfbd=client,
        complete=complete,
    )
    assert first["rankings"]
    assert second["facts_hash"] == first["facts_hash"]
    assert calls["n"] == 1
    third = run_cfb_board(
        season=2026,
        week=7,
        store_dir=tmp_path,
        cfbd=client,
        complete=complete,
        force=True,
    )
    assert third["facts_hash"] == first["facts_hash"]
    assert calls["n"] == 2


def test_fantasy_facts_and_board(tmp_path: Path):
    store = FileStore(FIXTURES)
    snap = store.read("football-main", 2026)
    assert snap is not None
    facts = build_fantasy_facts(snap, today=date(2026, 10, 12))
    assert facts["league_id"] == "football-main"
    assert facts["week_label"] == "2026-w14"
    assert facts["phase"] == "in_season"
    assert len(facts["teams"]) == 4
    heroes = next(row for row in facts["teams"] if row["name"] == "Hail Mary Heroes")
    assert heroes["record"] == "8-6"
    assert heroes["top_players"]

    def complete(_system: str, _prompt: str) -> str:
        return json.dumps(
            {
                "headline": "Heroes still the club to beat",
                "methodology": "Record, PF, and recent form.",
                "last_week_review": "First board.",
                "rankings": [
                    {
                        "rank": 1,
                        "name": "Hail Mary Heroes",
                        "blurb": "Best PF, 8-6, Logan Baker still cooking.",
                    },
                    {
                        "rank": 2,
                        "name": "End Zone Enforcers",
                        "blurb": "Same record, a step behind on points.",
                    },
                    {
                        "rank": 3,
                        "name": "Turf Titans",
                        "blurb": "7-7 and hanging around.",
                    },
                    {
                        "rank": 4,
                        "name": "Gridiron Goons",
                        "blurb": "5-9 but the roster is not dead.",
                    },
                ],
            }
        )

    document = run_fantasy_board(
        "football-main",
        season=2026,
        store_dir=FIXTURES,
        complete=complete,
        persist=False,
        today=date(2026, 10, 12),
    )
    assert document["board"] == "fantasy"
    assert document["rankings"][0]["name"] == "Hail Mary Heroes"
    persist_snapshot(
        document,
        prompt=document["_prompt"],
        raw_response=document["_raw_response"],
        store_dir=tmp_path,
    )
    assert read_ai_rankings("fantasy/football-main/2026-w14", store_dir=tmp_path)[
        "headline"
    ].startswith("Heroes")


def test_fantasy_offseason_uses_dated_label_not_espn_period():
    when = date(2026, 10, 12)
    baseball = {
        "league_id": "baseball-dynasty",
        "sport": "baseball",
        "scoring_type": "TOTAL_SEASON_POINTS",
        "season": 2026,
        "current_week": 187,
        "teams": [],
    }
    hockey = {
        "league_id": "hockey-main",
        "sport": "hockey",
        "scoring_type": "TOTAL_SEASON_POINTS",
        "season": 2027,
        "current_week": 14,
        "teams": [],
    }
    football = {
        "league_id": "football-main",
        "sport": "football",
        "season": 2026,
        "current_week": 6,
        "teams": [],
    }
    b_phase, b_label, b_week = fantasy_phase_and_label(baseball, when)
    h_phase, h_label, h_week = fantasy_phase_and_label(hockey, when)
    f_phase, f_label, f_week = fantasy_phase_and_label(football, when)
    assert b_phase == "offseason"
    assert b_label == "2026-off-20261012"
    assert b_week == 0
    assert h_phase == "preseason"
    assert h_label == "2027-off-20261012"
    assert h_week == 0
    assert f_phase == "in_season"
    assert f_label == "2026-w06"
    assert f_week == 6
    assert offseason_week_label(2026, when) == "2026-off-20261012"
    mid = fantasy_phase_and_label(
        {**baseball, "current_week": 80}, date(2026, 7, 4)
    )
    assert mid[0] == "in_season"
    assert mid[1] == "2026-w16"
    jan = fantasy_phase_and_label(baseball, date(2027, 1, 12))
    assert jan[1] == "2026-off-20270112"
    assert parse_week_label(jan[1]) > parse_week_label("2026-off-20261012")
    hockey_open = fantasy_phase_and_label(hockey, date(2026, 10, 20))
    assert hockey_open[0] == "in_season"
    assert hockey_open[1] == "2027-w01"
    football_off = fantasy_phase_and_label(
        {**football, "current_week": 18}, date(2027, 3, 2)
    )
    assert football_off[0] == "offseason"
    assert football_off[1] == "2026-off-20270302"
    baseball_facts = build_fantasy_facts(baseball, today=when)
    assert baseball_facts["week_label"] == "2026-off-20261012"
    assert baseball_facts["phase"] == "offseason"
    assert baseball_facts["week"] == 0


def test_load_prior_orders_dated_offseason_after_in_season(tmp_path: Path):
    in_season = {
        "schema_version": 1,
        "board": "fantasy",
        "league_id": "baseball-dynasty",
        "season": 2026,
        "week": 24,
        "week_label": "2026-w24",
        "rankings": [{"rank": 1, "name": "A"}],
        "generated_at": "2026-10-01T00:00:00+00:00",
    }
    first_off = {
        **in_season,
        "week": 0,
        "week_label": "2026-off-20261006",
        "rankings": [{"rank": 1, "name": "B"}],
        "generated_at": "2026-10-06T00:00:00+00:00",
    }
    persist_snapshot(in_season, prompt="", raw_response="", store_dir=tmp_path)
    persist_snapshot(first_off, prompt="", raw_response="", store_dir=tmp_path)
    prior = load_prior(
        "fantasy", "2026-off-20261013", "baseball-dynasty", store_dir=tmp_path
    )
    assert prior is not None
    assert prior["week_label"] == "2026-off-20261006"
    assert load_prior(
        "fantasy", "2026-off-20261006", "baseball-dynasty", store_dir=tmp_path
    )["week_label"] == "2026-w24"


def test_assemble_rejects_unknown_teams():
    facts = build_cfb_facts(_games(), 7, 2026, _ap())
    snapshot = assemble_cfb_snapshot(
        facts,
        {
            "headline": "x",
            "methodology": "y",
            "last_week_review": "",
            "rankings": [
                {"rank": 1, "name": "Ohio State", "blurb": "Good."},
                {"rank": 2, "name": "Made Up U", "blurb": "Nope."},
            ],
            "also_ranked": [],
        },
        model="xai/grok-4-fast",
        temperature=0.2,
        prior=None,
        degraded=[],
    )
    names = [row["name"] for row in snapshot["rankings"]]
    assert "Ohio State" in names
    assert "Made Up U" not in names


def test_load_prior_uses_previous_week_not_later(tmp_path: Path):
    older = {
        "schema_version": 1,
        "board": "cfb",
        "season": 2026,
        "week": 6,
        "week_label": "2026-w06",
        "rankings": [{"rank": 1, "name": "Ohio State"}],
        "generated_at": "2026-10-05T00:00:00+00:00",
    }
    newer = {
        **older,
        "week": 7,
        "week_label": "2026-w07",
        "rankings": [{"rank": 1, "name": "Alabama"}],
        "generated_at": "2026-10-12T00:00:00+00:00",
    }
    persist_snapshot(older, prompt="", raw_response="", store_dir=tmp_path)
    persist_snapshot(newer, prompt="", raw_response="", store_dir=tmp_path)
    prior = load_prior("cfb", "2026-w06", store_dir=tmp_path)
    assert prior is None or prior["week_label"] != "2026-w07"
    assert load_prior("cfb", "2026-w07", store_dir=tmp_path)["week_label"] == "2026-w06"


def test_load_prior_skips_empty_degraded_week(tmp_path: Path):
    good = {
        "schema_version": 1,
        "board": "cfb",
        "season": 2026,
        "week": 6,
        "week_label": "2026-w06",
        "rankings": [{"rank": 1, "name": "Ohio State"}],
        "generated_at": "2026-10-05T00:00:00+00:00",
    }
    empty = {
        **good,
        "week": 7,
        "week_label": "2026-w07",
        "rankings": [],
        "generated_at": "2026-10-12T00:00:00+00:00",
    }
    persist_snapshot(good, prompt="", raw_response="", store_dir=tmp_path)
    persist_snapshot(empty, prompt="", raw_response="", store_dir=tmp_path)
    prior = load_prior("cfb", "2026-w08", store_dir=tmp_path)
    assert prior is not None
    assert prior["week_label"] == "2026-w06"
    assert prior["rankings"]


def test_cfb_fetch_failure_does_not_persist(tmp_path: Path):
    good = run_cfb_board(
        season=2026,
        week=7,
        store_dir=tmp_path,
        cfbd=CfbdClient(
            api_key="test",
            fetch=lambda path, params: json.loads(
                (CFBD / ("games.json" if path == "/games" else "rankings.json")).read_text()
            ),
        ),
        complete=_fake_cfb_complete,
    )
    assert good["rankings"]

    def boom(_path: str, _params):
        raise RuntimeError("cfbd down")

    empty = run_cfb_board(
        season=2026,
        week=7,
        store_dir=tmp_path,
        cfbd=CfbdClient(api_key="test", fetch=boom),
        persist=True,
    )
    assert empty["rankings"] == []
    assert "CFBD games fetch failed" in empty["degraded"][0]
    stored = read_ai_rankings("cfb/2026-w07", store_dir=tmp_path)
    assert stored["rankings"]
    assert stored["week_label"] == "2026-w07"


def test_degraded_cfb_does_not_overwrite_latest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    good = run_cfb_board(
        season=2026,
        week=7,
        store_dir=tmp_path,
        cfbd=CfbdClient(
            api_key="test",
            fetch=lambda path, params: json.loads(
                (CFBD / ("games.json" if path == "/games" else "rankings.json")).read_text()
            ),
        ),
        complete=_fake_cfb_complete,
    )
    assert good["rankings"]
    monkeypatch.delenv("SJ_CFBD_API_KEY", raising=False)
    monkeypatch.delenv("CFBD_API_KEY", raising=False)
    empty = run_cfb_board(season=2026, week=8, store_dir=tmp_path, persist=True)
    assert empty["rankings"] == []
    latest = read_ai_rankings("cfb/latest", store_dir=tmp_path)
    assert latest["week_label"] == "2026-w07"
    assert latest["rankings"]
    index = read_ai_rankings("cfb/index", store_dir=tmp_path)
    assert "2026-w08" in index["weeks"]
    assert index["latest"] == "2026-w07"


def test_lookup_is_exact_name():
    facts = build_cfb_facts(_games(), 7, 2026, _ap())
    snapshot = assemble_cfb_snapshot(
        facts,
        {
            "headline": "x",
            "methodology": "y",
            "last_week_review": "",
            "rankings": [
                {"rank": 1, "name": "Ohio", "blurb": "Too short — must not match Ohio State."},
            ],
            "also_ranked": [],
        },
        model="test",
        temperature=0.2,
        prior=None,
        degraded=[],
    )
    names = [row["name"] for row in snapshot["rankings"]]
    assert "Ohio State" not in names or snapshot["rankings"][0]["blurb"] != (
        "Too short — must not match Ohio State."
    )
    assert all(row["name"] != "Ohio" for row in snapshot["rankings"])


def test_cfb_movers_drop_from_top25_only():
    facts = build_cfb_facts(_games(), 7, 2026, _ap())
    prior = {
        "rankings": [
            {"rank": 1, "name": "Ohio State"},
            {"rank": 2, "name": "Texas"},
            {"rank": 24, "name": "Iowa"},
        ]
    }
    snapshot = assemble_cfb_snapshot(
        facts,
        {
            "headline": "x",
            "methodology": "y",
            "last_week_review": "",
            "rankings": [
                {"rank": 1, "name": "Ohio State", "blurb": "Still 1."},
                {"rank": 2, "name": "Alabama", "blurb": "In."},
            ],
            "also_ranked": [{"rank": 26, "name": "Kentucky"}],
        },
        model="test",
        temperature=0.2,
        prior=prior,
        degraded=[],
    )
    dropped_names = [row["name"] for row in snapshot["movers"]["dropped"]]
    texas = next(row for row in snapshot["rankings"] if row["name"] == "Texas")
    assert texas["prev_rank"] == 2
    assert (texas["delta"] or 0) < 0
    assert "Iowa" in dropped_names


def test_fantasy_appends_omitted_team():
    facts = {
        "league_id": "football-main",
        "name": "SJ",
        "sport": "football",
        "format": "redraft",
        "season": 2026,
        "week": 1,
        "week_label": "2026-w01",
        "phase": "in_season",
        "teams": [
            {"team_id": 1, "name": "A", "record": "1-0", "points_for": 10},
            {"team_id": 2, "name": "B", "record": "0-1", "points_for": 8},
        ],
    }
    snapshot = assemble_fantasy_snapshot(
        facts,
        {
            "headline": "Only A",
            "methodology": "",
            "last_week_review": "",
            "rankings": [{"rank": 1, "name": "A", "blurb": "Won."}],
        },
        model="test",
        temperature=0.2,
        prior=None,
        degraded=[],
    )
    assert [row["name"] for row in snapshot["rankings"]] == ["A", "B"]
    assert snapshot["degraded"]
