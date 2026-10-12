"""AI rankings (roadmap 7.16). Offline — canned CFBD + injected model."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from sj.ai_rankings import (
    DEFAULT_TEMPERATURE,
    DEFAULT_XAI_BASE,
    DEFAULT_XAI_MODEL,
    assemble_cfb_snapshot,
    assemble_fantasy_snapshot,
    attach_movers,
    build_cfb_facts,
    build_fantasy_facts,
    extract_json_object,
    openai_compatible_body,
    persist_snapshot,
    rankings_llm_config_from_env,
    run_cfb_board,
    run_fantasy_board,
    week_label,
)
from sj.cfbd import (
    CfbdClient,
    accumulate_records,
    compact_week_results,
    default_cfb_season,
    latest_completed_week,
    parse_ap_poll,
    parse_games,
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


def test_ai_rankings_rel_strips_traversal():
    assert ai_rankings_rel("cfb/2026-w08") == "ai_rankings/cfb/2026-w08.json"
    assert ai_rankings_rel("fantasy/football-main/2026-w14.json") == (
        "ai_rankings/fantasy/football-main/2026-w14.json"
    )
    assert ".." not in ai_rankings_rel("cfb/../secret")
    with pytest.raises(ValueError):
        ai_rankings_rel("///")


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
    body = openai_compatible_body(config, "sys", "user")
    assert body["temperature"] == DEFAULT_TEMPERATURE
    assert body["messages"][0]["content"] == "sys"
    assert rankings_llm_config_from_env({}) is None


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


def test_fantasy_facts_and_board(tmp_path: Path):
    store = FileStore(FIXTURES)
    snap = store.read("football-main", 2026)
    assert snap is not None
    facts = build_fantasy_facts(snap)
    assert facts["league_id"] == "football-main"
    assert facts["week_label"] == "2026-w14"
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
