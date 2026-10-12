"""Weekly AI rankings (roadmap 7.16).

One configurable OpenAI-compatible model ranks:

* College football (CFBD completed FBS results + optional AP poll)
* Fantasy power rankings for baseball-dynasty / football-main /
  football-dynasty / hockey-main (ESPN snapshots already in the store)

Temperature is pinned low. The public snapshot and a sibling ``.trace`` file
(prompt + raw response) land under ``ai_rankings/`` so movers and history work.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import date, datetime, timezone
from typing import Any

from sj.cfbd import (
    CfbdClient,
    accumulate_records,
    cfbd_api_key,
    compact_team_facts,
    compact_week_results,
    default_cfb_season,
    estimated_cfb_week,
    fbs_teams,
    latest_completed_week,
    parse_week_label,
    week_label,
)
from sj.registry import load_registry
from sj.store import read_ai_rankings, resolve_store, write_ai_rankings

SCHEMA_VERSION = 1
BOARD_CFB = "cfb"
BOARD_FANTASY = "fantasy"
FANTASY_LEAGUES = (
    "baseball-dynasty",
    "football-main",
    "football-dynasty",
    "hockey-main",
)
TOP_N = 25
MAX_H2H_WEEK = 25
DEFAULT_PROVIDER = "xai"
DEFAULT_XAI_MODEL = "grok-4-fast"
DEFAULT_OPENAI_MODEL = "gpt-4.1-mini"
DEFAULT_XAI_BASE = "https://api.x.ai/v1"
DEFAULT_OPENAI_BASE = "https://api.openai.com/v1"
DEFAULT_TEMPERATURE = 0.2
DEFAULT_MAX_TOKENS = 6000
DEFAULT_LLM_TIMEOUT_SECONDS = 600.0
DEFAULT_LLM_MAX_ATTEMPTS = 3
DEFAULT_LLM_RETRY_BACKOFF_SECONDS = 5.0
RETRYABLE_LLM_HTTP = frozenset({408, 429, 500, 502, 503, 504})
USER_AGENT = "sj-ai-rankings/1 (Strictly Jayers hub)"

CompleteFn = Callable[[str, str], str]


class RankingsLlmConfig:
    def __init__(
        self,
        provider: str,
        api_key: str,
        model: str,
        base_url: str,
        temperature: float = DEFAULT_TEMPERATURE,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        timeout_s: float = DEFAULT_LLM_TIMEOUT_SECONDS,
        max_attempts: int = DEFAULT_LLM_MAX_ATTEMPTS,
    ) -> None:
        self.provider = provider
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout_s = timeout_s
        self.max_attempts = max_attempts

    @property
    def label(self) -> str:
        return f"{self.provider}/{self.model}"


def rankings_llm_config_from_env(
    env: dict[str, str] | None = None,
) -> RankingsLlmConfig | None:
    source = env if env is not None else os.environ
    provider = (source.get("SJ_RANKINGS_PROVIDER") or DEFAULT_PROVIDER).strip().lower()
    key = (
        source.get("SJ_RANKINGS_API_KEY")
        or source.get("XAI_API_KEY")
        or source.get("OPENAI_API_KEY")
        or ""
    ).strip()
    if not key:
        return None
    if provider in {"xai", "grok"}:
        base = (source.get("SJ_RANKINGS_BASE_URL") or DEFAULT_XAI_BASE).strip()
        model = (source.get("SJ_RANKINGS_MODEL") or DEFAULT_XAI_MODEL).strip()
        provider = "xai"
    else:
        base = (source.get("SJ_RANKINGS_BASE_URL") or DEFAULT_OPENAI_BASE).strip()
        model = (source.get("SJ_RANKINGS_MODEL") or DEFAULT_OPENAI_MODEL).strip()
        provider = "openai"
    try:
        temperature = float(source.get("SJ_RANKINGS_TEMPERATURE") or DEFAULT_TEMPERATURE)
    except (TypeError, ValueError):
        temperature = DEFAULT_TEMPERATURE
    try:
        max_tokens = int(source.get("SJ_RANKINGS_MAX_TOKENS") or DEFAULT_MAX_TOKENS)
    except (TypeError, ValueError):
        max_tokens = DEFAULT_MAX_TOKENS
    try:
        timeout_s = float(source.get("SJ_RANKINGS_TIMEOUT_S") or DEFAULT_LLM_TIMEOUT_SECONDS)
    except (TypeError, ValueError):
        timeout_s = DEFAULT_LLM_TIMEOUT_SECONDS
    try:
        max_attempts = int(source.get("SJ_RANKINGS_MAX_ATTEMPTS") or DEFAULT_LLM_MAX_ATTEMPTS)
    except (TypeError, ValueError):
        max_attempts = DEFAULT_LLM_MAX_ATTEMPTS
    return RankingsLlmConfig(
        provider=provider,
        api_key=key,
        model=model,
        base_url=base,
        temperature=max(0.0, min(temperature, 1.0)),
        max_tokens=max(256, max_tokens),
        timeout_s=max(30.0, timeout_s),
        max_attempts=max(1, max_attempts),
    )


def rankings_force(env: dict[str, str] | None = None) -> bool:
    source = env if env is not None else os.environ
    return (source.get("SJ_RANKINGS_FORCE") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _is_retryable_llm_error(exc: BaseException) -> bool:
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in RETRYABLE_LLM_HTTP
    if isinstance(exc, urllib.error.URLError):
        reason = exc.reason
        if isinstance(reason, BaseException) and _is_retryable_llm_error(reason):
            return True
        return "timed out" in str(reason).lower() or "timeout" in str(reason).lower()
    return isinstance(exc, (TimeoutError, ConnectionError))


def _wrap_llm_http_error(config: RankingsLlmConfig, exc: BaseException) -> RuntimeError:
    if isinstance(exc, urllib.error.HTTPError):
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:240]
        except Exception:  # noqa: BLE001 - body is optional on some HTTPError stubs
            detail = str(exc.reason or exc)
        return RuntimeError(f"{config.provider} {exc.code}: {detail}")
    if isinstance(exc, urllib.error.URLError):
        return RuntimeError(f"{config.provider} network error: {exc.reason}")
    return RuntimeError(f"{config.provider} network error: {exc}")


def openai_compatible_body(
    config: RankingsLlmConfig,
    system: str,
    prompt: str,
) -> dict[str, Any]:
    return {
        "model": config.model,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    }


def _openai_compatible_once(
    config: RankingsLlmConfig,
    system: str,
    prompt: str,
    timeout_s: float,
) -> str:
    body = json.dumps(openai_compatible_body(config, system, prompt)).encode("utf-8")
    request = urllib.request.Request(
        f"{config.base_url}/chat/completions",
        data=body,
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {config.api_key}",
            "user-agent": USER_AGENT,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        payload = json.loads(response.read().decode("utf-8"))
    choices = payload.get("choices") if isinstance(payload, dict) else None
    first = choices[0] if isinstance(choices, list) and choices else None
    message = first.get("message") if isinstance(first, dict) else None
    text = message.get("content") if isinstance(message, dict) else None
    if not text:
        raise RuntimeError(f"{config.provider} returned no text")
    return str(text)


def complete_openai_compatible(
    config: RankingsLlmConfig,
    system: str,
    prompt: str,
    *,
    sleeper: Callable[[float], None] | None = None,
) -> str:
    """POST /chat/completions with timeout + exponential backoff on transients.

    Grok 4.7 on the full FBS prompt can take several minutes; the default
    ``SJ_RANKINGS_TIMEOUT_S`` is 600s (was a hard 120s). Timeouts, URL
    errors, and 408/429/5xx retry up to ``SJ_RANKINGS_MAX_ATTEMPTS``.
    """
    attempts = max(1, int(config.max_attempts))
    timeout_s = float(config.timeout_s)
    sleep = sleeper or time.sleep
    last_exc: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return _openai_compatible_once(config, system, prompt, timeout_s)
        except RuntimeError:
            raise
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last_exc = exc
            if attempt >= attempts or not _is_retryable_llm_error(exc):
                raise _wrap_llm_http_error(config, exc) from exc
            sleep(DEFAULT_LLM_RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1)))
    assert last_exc is not None  # pragma: no cover
    raise _wrap_llm_http_error(config, last_exc) from last_exc


def extract_json_object(text: str) -> dict[str, Any]:
    trimmed = text.strip()
    fenced = None
    if "```" in trimmed:
        start = trimmed.find("```")
        rest = trimmed[start + 3 :]
        if rest.lstrip().lower().startswith("json"):
            rest = rest.lstrip()[4:]
        end = rest.find("```")
        fenced = rest if end < 0 else rest[:end]
    candidate = (fenced or trimmed).strip()
    begin = candidate.find("{")
    finish = candidate.rfind("}")
    if begin < 0 or finish <= begin:
        raise ValueError("model did not return JSON")
    parsed = json.loads(candidate[begin : finish + 1])
    if not isinstance(parsed, dict):
        raise TypeError("model JSON was not an object")
    return parsed


def facts_hash(facts: dict[str, Any]) -> str:
    blob = json.dumps(facts, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]


def _now_iso(now: datetime | None = None) -> str:
    stamp = now or datetime.now(timezone.utc)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.isoformat()


def _norm_name(value: str) -> str:
    return " ".join(value.lower().split())


def attach_movers(
    rankings: list[dict[str, Any]],
    prior: list[dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    prior_rank = {
        _norm_name(str(row.get("name") or "")): int(row["rank"])
        for row in (prior or [])
        if row.get("name") and row.get("rank") is not None
    }
    decorated: list[dict[str, Any]] = []
    for row in rankings:
        item = dict(row)
        key = _norm_name(str(item.get("name") or ""))
        previous = prior_rank.get(key)
        item["prev_rank"] = previous
        item["delta"] = None if previous is None else previous - int(item["rank"])
        decorated.append(item)
    current_names = {_norm_name(str(row.get("name") or "")) for row in decorated}
    risers = [row for row in decorated if (row.get("delta") or 0) > 0]
    fallers = [row for row in decorated if (row.get("delta") or 0) < 0]
    newcomers = [row for row in decorated if row.get("prev_rank") is None and prior]
    dropped = [
        {"name": row.get("name"), "prev_rank": row.get("rank")}
        for row in (prior or [])
        if _norm_name(str(row.get("name") or "")) not in current_names
    ]
    risers.sort(key=lambda row: (-int(row["delta"]), int(row["rank"])))
    fallers.sort(key=lambda row: (int(row["delta"]), int(row["rank"])))
    movers = {
        "risers": risers[:8],
        "fallers": fallers[:8],
        "new": newcomers[:8],
        "dropped": dropped[:8],
    }
    return decorated, movers


def attach_ap(rankings: list[dict[str, Any]], ap_poll: list[dict[str, Any]]) -> None:
    by_name = {_norm_name(str(row["name"])): int(row["rank"]) for row in ap_poll if row.get("name")}
    for row in rankings:
        ap_rank = by_name.get(_norm_name(str(row.get("name") or "")))
        row["ap_rank"] = ap_rank
        row["vs_ap"] = None if ap_rank is None else int(row["rank"]) - ap_rank


def _lookup_team(
    name: str,
    known: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    return known.get(_norm_name(name))


def _sanitize_rank_rows(
    raw: Any,
    known: dict[str, dict[str, Any]],
    *,
    require_blurb: bool,
) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    rows: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        rank = item.get("rank")
        try:
            rank_n = int(rank)
        except (TypeError, ValueError):
            continue
        if not name or rank_n < 1:
            continue
        meta = _lookup_team(name, known)
        if meta is None:
            continue
        key = _norm_name(str(meta.get("name") or name))
        if key in seen:
            continue
        seen.add(key)
        blurb = str(item.get("blurb") or "").strip()
        if require_blurb and not blurb:
            continue
        row = {
            "rank": rank_n,
            "name": meta.get("name") or name,
            "team_id": meta.get("team_id") or meta.get("name") or name,
            "conference": meta.get("conference") or "",
            "record": meta.get("record") or "",
            "blurb": blurb,
        }
        for extra in (
            "abbrev",
            "points_for",
            "points_against",
            "standing",
            "wins",
            "losses",
            "ties",
            "phase",
        ):
            if extra in meta:
                row[extra] = meta[extra]
        rows.append(row)
    rows.sort(key=lambda item: item["rank"])
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


CFB_SYSTEM = (
    "You are Strictly Jayers' college football rankings editor. "
    "Rank using only the provided results, margins, opponents, and venues. "
    "Do not invent scores or teams. Return one JSON object, no markdown."
)

FANTASY_SYSTEM = (
    "You are Strictly Jayers' fantasy power-rankings editor. "
    "Rank using only the provided records, points, recent form, and roster notes. "
    "Do not invent numbers or teams. Return one JSON object, no markdown."
)


def cfb_prompt(
    facts: dict[str, Any],
    prior: dict[str, Any] | None,
) -> str:
    prior_top = []
    if prior:
        prior_top = [
            {
                "rank": row.get("rank"),
                "name": row.get("name"),
                "record": row.get("record"),
                "blurb": row.get("blurb"),
            }
            for row in (prior.get("rankings") or [])[:TOP_N]
        ]
    payload = {
        "instruction": (
            f"Produce a Top {TOP_N} for FBS week {facts.get('week')} "
            f"{facts.get('season')}. Write a short blurb per Top 25 team. "
            "You may optionally list a few also_ranked names (rank + name only). "
            "If last week's board is present, write last_week_review: what the "
            "previous ranking got right or wrong after this week's results. "
            "Prefer recent results and strength of schedule implied by opponents; "
            "do not copy the AP poll."
        ),
        "schema": {
            "headline": "string",
            "methodology": "string, 1-2 sentences",
            "last_week_review": "string",
            "rankings": [{"rank": 1, "name": "Team", "blurb": "short"}],
            "also_ranked": [{"rank": 26, "name": "Team"}],
        },
        # AP is applied after the call (attach_ap). Sending it here invites
        # the model to hug the poll we told it not to copy.
        "facts": {key: value for key, value in facts.items() if key != "ap_poll"},
        "last_week_top25": prior_top,
    }
    return json.dumps(payload, indent=2)


def fantasy_prompt(
    facts: dict[str, Any],
    prior: dict[str, Any] | None,
) -> str:
    prior_rows = []
    if prior:
        prior_rows = [
            {"rank": row.get("rank"), "name": row.get("name"), "blurb": row.get("blurb")}
            for row in (prior.get("rankings") or [])
        ]
    payload = {
        "instruction": (
            "Rank every team in this league. Short blurb per team citing the "
            "supplied record / points / form / roster notes. "
            "If last week's board is present, write last_week_review."
        ),
        "schema": {
            "headline": "string",
            "methodology": "string",
            "last_week_review": "string",
            "rankings": [{"rank": 1, "name": "Team", "blurb": "short"}],
        },
        "facts": facts,
        "last_week": prior_rows,
    }
    return json.dumps(payload, indent=2)


def build_cfb_facts(
    games: list,
    week: int,
    season: int,
    ap_poll: list[dict[str, Any]],
) -> dict[str, Any]:
    records = accumulate_records(games)
    teams = fbs_teams(records, games)
    return {
        "season": season,
        "week": week,
        "week_label": week_label(season, week),
        "team_count": len(teams),
        "teams": compact_team_facts(teams),
        "week_results": compact_week_results(games, week),
        "ap_poll": ap_poll,
    }


def _team_recent(outcomes: list[Any] | None, limit: int = 4) -> list[str]:
    marks = [str(item) for item in (outcomes or []) if item and str(item) != "U"]
    return marks[-limit:]


def _clock_date(today: date | None = None) -> date:
    return today or datetime.now(timezone.utc).date()


def offseason_week_label(season: int, today: date | None = None) -> str:
    """Dated offseason/preseason label so Monday jobs keep history and movers."""
    return f"{int(season)}-off-{_clock_date(today).strftime('%Y%m%d')}"


def _season_points_week(sport: str, season: int, today: date) -> int:
    if sport == "baseball":
        start = date(int(season), 3, 20)
    elif sport == "hockey":
        start = date(int(season) - 1, 10, 15)
    else:
        start = date(int(season), 1, 1)
    if today < start:
        return 1
    return min(1 + (today - start).days // 7, MAX_H2H_WEEK)


def fantasy_phase_and_label(
    snapshot: dict[str, Any],
    today: date | None = None,
) -> tuple[str, str, int]:
    """Pick a weekly label that ESPN daily scoring periods must not drive.

    Football H2H uses ``current_week`` when it is a plausible matchup week.
    Baseball/hockey season-points use a calendar week-of-season in-window, and
    ``{season}-off-YYYYMMDD`` in the offseason or preseason (so ``2026-w187``
    and a preseason ``2027-w14`` cannot happen again).
    """
    when = _clock_date(today)
    season = int(snapshot.get("season") or when.year)
    period = int(snapshot.get("current_week") or 0)
    sport = str(snapshot.get("sport") or "").strip().lower()
    scoring = str(
        (snapshot.get("settings") or {}).get("scoring_type")
        or snapshot.get("scoring_type")
        or ""
    )
    daily = sport in {"baseball", "hockey"} or scoring == "TOTAL_SEASON_POINTS"
    if not daily:
        in_window = date(season, 8, 1) <= when <= date(season + 1, 2, 15)
        if in_window and 1 <= period <= MAX_H2H_WEEK:
            return "in_season", week_label(season, period), period
        if date(season, 7, 15) <= when < date(season, 9, 1):
            return "preseason", offseason_week_label(season, when), 0
        return "offseason", offseason_week_label(season, when), 0
    if sport == "baseball":
        if date(season, 2, 15) <= when < date(season, 3, 20):
            phase = "preseason"
        elif date(season, 3, 20) <= when <= date(season, 10, 5):
            phase = "in_season"
        else:
            phase = "offseason"
    elif sport == "hockey":
        start = date(season - 1, 10, 15)
        end = date(season, 6, 15)
        if start <= when <= end:
            phase = "in_season"
        elif date(season - 1, 9, 1) <= when < start:
            phase = "preseason"
        else:
            phase = "offseason"
    else:
        phase = "in_season" if 1 <= period <= MAX_H2H_WEEK else "offseason"
    if phase != "in_season":
        return phase, offseason_week_label(season, when), 0
    week_n = _season_points_week(sport, season, when)
    return "in_season", week_label(season, week_n), week_n


def _top_players(roster: list[Any] | None, limit: int = 4) -> list[dict[str, Any]]:
    players: list[dict[str, Any]] = []
    for player in roster or []:
        if not isinstance(player, dict):
            continue
        name = str(player.get("name") or "").strip()
        if not name:
            continue
        players.append(
            {
                "name": name,
                "pos": player.get("position") or player.get("slot"),
                "fp": player.get("total_points"),
                "proj": player.get("projected_total_points"),
            }
        )
    players.sort(key=lambda row: (row.get("fp") is None, -(row.get("fp") or 0)))
    return players[:limit]


def build_fantasy_facts(
    snapshot: dict[str, Any],
    today: date | None = None,
) -> dict[str, Any]:
    season = int(snapshot.get("season") or 0)
    phase, label, week = fantasy_phase_and_label(snapshot, today)
    teams_out: list[dict[str, Any]] = []
    for team in snapshot.get("teams") or []:
        if not isinstance(team, dict):
            continue
        wins = int(team.get("wins") or 0)
        losses = int(team.get("losses") or 0)
        ties = int(team.get("ties") or 0)
        record = f"{wins}-{losses}-{ties}" if ties else f"{wins}-{losses}"
        teams_out.append(
            {
                "team_id": team.get("team_id"),
                "name": team.get("name"),
                "abbrev": team.get("abbrev"),
                "wins": wins,
                "losses": losses,
                "ties": ties,
                "record": record,
                "points_for": team.get("points_for"),
                "points_against": team.get("points_against"),
                "standing": team.get("standing") or team.get("final_standing"),
                "recent": _team_recent(team.get("outcomes")),
                "top_players": _top_players(team.get("roster")),
            }
        )
    return {
        "league_id": snapshot.get("league_id"),
        "name": snapshot.get("name"),
        "sport": snapshot.get("sport"),
        "format": snapshot.get("format"),
        "season": season,
        "week": week,
        "week_label": label,
        "phase": phase,
        "scoring_type": (snapshot.get("settings") or {}).get("scoring_type")
        or snapshot.get("scoring_type"),
        "teams": teams_out,
    }


def _known_from_cfb(facts: dict[str, Any]) -> dict[str, dict[str, Any]]:
    known: dict[str, dict[str, Any]] = {}
    for team in facts.get("teams") or []:
        name = str(team.get("name") or "")
        if name:
            known[_norm_name(name)] = team
    return known


def _known_from_fantasy(facts: dict[str, Any]) -> dict[str, dict[str, Any]]:
    known: dict[str, dict[str, Any]] = {}
    for team in facts.get("teams") or []:
        name = str(team.get("name") or "")
        if name:
            known[_norm_name(name)] = team
    return known


def assemble_cfb_snapshot(
    facts: dict[str, Any],
    model_json: dict[str, Any],
    *,
    model: str,
    temperature: float,
    prior: dict[str, Any] | None,
    degraded: list[str],
    now: datetime | None = None,
) -> dict[str, Any]:
    known = _known_from_cfb(facts)
    top = _sanitize_rank_rows(model_json.get("rankings"), known, require_blurb=True)
    rest = _sanitize_rank_rows(model_json.get("also_ranked"), known, require_blurb=False)
    top_names = {_norm_name(str(row["name"])) for row in top}
    rest = [row for row in rest if _norm_name(str(row["name"])) not in top_names]
    # Fill any FBS team the model skipped so the full board is cheap-complete.
    used = top_names | {_norm_name(str(row["name"])) for row in rest}
    extras = [
        {
            "rank": 0,
            "name": team["name"],
            "team_id": team.get("name"),
            "conference": team.get("conference") or "",
            "record": team.get("record") or "",
            "blurb": "",
        }
        for key, team in known.items()
        if key not in used
    ]
    extras.sort(key=lambda row: row["name"])
    for index, row in enumerate(rest + extras, start=len(top) + 1):
        row["rank"] = index
    ranked = top + rest + extras
    prior_top = (prior or {}).get("rankings") if prior else None
    top_with_movers, movers = attach_movers(ranked[:TOP_N], prior_top)
    rest_with_movers, _ = attach_movers(ranked[TOP_N:], prior_top)
    ranked = top_with_movers + rest_with_movers
    attach_ap(ranked, facts.get("ap_poll") or [])
    notes: list[str] = []
    if facts.get("ap_poll"):
        notes.append("AP poll attached from CFBD /rankings.")
    else:
        notes.append("AP poll unavailable this week.")
    return {
        "schema_version": SCHEMA_VERSION,
        "board": BOARD_CFB,
        "season": facts["season"],
        "week": facts["week"],
        "week_label": facts["week_label"],
        "generated_at": _now_iso(now),
        "model": model,
        "temperature": temperature,
        "facts_hash": facts_hash(facts),
        "headline": str(model_json.get("headline") or "").strip()
        or f"Week {facts['week']} AI Top 25",
        "methodology": str(model_json.get("methodology") or "").strip(),
        "last_week_review": str(model_json.get("last_week_review") or "").strip(),
        "notes": notes,
        "degraded": list(degraded),
        "rankings": ranked[:TOP_N],
        "full_rankings": ranked,
        "movers": movers,
        "ap_available": bool(facts.get("ap_poll")),
    }


def assemble_fantasy_snapshot(
    facts: dict[str, Any],
    model_json: dict[str, Any],
    *,
    model: str,
    temperature: float,
    prior: dict[str, Any] | None,
    degraded: list[str],
    now: datetime | None = None,
) -> dict[str, Any]:
    known = _known_from_fantasy(facts)
    ranked = _sanitize_rank_rows(model_json.get("rankings"), known, require_blurb=True)
    known_names = set(known)
    have = {_norm_name(str(row["name"])) for row in ranked}
    for key, team in known.items():
        if key in have:
            continue
        ranked.append(
            {
                "rank": len(ranked) + 1,
                "name": team.get("name"),
                "team_id": team.get("team_id"),
                "abbrev": team.get("abbrev"),
                "record": team.get("record"),
                "blurb": "Held in place — the model skipped this club.",
                "points_for": team.get("points_for"),
                "points_against": team.get("points_against"),
                "standing": team.get("standing"),
            }
        )
    if len(have) < len(known_names) and "model omitted a team" not in degraded:
        degraded = [*degraded, "Model omitted a team; missing clubs were appended."]
    ranked, movers = attach_movers(ranked, (prior or {}).get("rankings") if prior else None)
    return {
        "schema_version": SCHEMA_VERSION,
        "board": BOARD_FANTASY,
        "league_id": facts["league_id"],
        "name": facts.get("name"),
        "sport": facts.get("sport"),
        "format": facts.get("format"),
        "season": facts["season"],
        "week": facts["week"],
        "week_label": facts["week_label"],
        "phase": facts.get("phase"),
        "generated_at": _now_iso(now),
        "model": model,
        "temperature": temperature,
        "facts_hash": facts_hash(facts),
        "headline": str(model_json.get("headline") or "").strip()
        or f"{facts.get('name') or facts['league_id']} power rankings",
        "methodology": str(model_json.get("methodology") or "").strip(),
        "last_week_review": str(model_json.get("last_week_review") or "").strip(),
        "notes": [],
        "degraded": list(degraded),
        "rankings": ranked,
        "movers": movers,
    }


def _index_name(board: str, league_id: str | None = None) -> str:
    if board == BOARD_CFB:
        return "cfb/index"
    return f"fantasy/{league_id}/index"


def _week_name(board: str, week_lbl: str, league_id: str | None = None) -> str:
    if board == BOARD_CFB:
        return f"cfb/{week_lbl}"
    return f"fantasy/{league_id}/{week_lbl}"


def persist_snapshot(
    document: dict[str, Any],
    *,
    prompt: str,
    raw_response: str,
    store_dir: Any = None,
    promote_latest: bool | None = None,
) -> dict[str, str]:
    board = document["board"]
    league_id = document.get("league_id")
    week_lbl = document["week_label"]
    public_name = _week_name(board, week_lbl, league_id)
    latest_name = _week_name(board, "latest", league_id)
    index_name = _index_name(board, league_id)
    has_ranks = bool(document.get("rankings"))
    if promote_latest is None:
        promote_latest = has_ranks
    trace = {
        "schema_version": SCHEMA_VERSION,
        "board": board,
        "week_label": week_lbl,
        "league_id": league_id,
        "generated_at": document.get("generated_at"),
        "model": document.get("model"),
        "temperature": document.get("temperature"),
        "facts_hash": document.get("facts_hash"),
        "prompt": prompt,
        "raw_response": raw_response,
    }
    paths = {
        "snapshot": write_ai_rankings(document, public_name, store_dir=store_dir),
        "trace": write_ai_rankings(trace, f"{public_name}.trace", store_dir=store_dir),
    }
    if promote_latest:
        paths["latest"] = write_ai_rankings(document, latest_name, store_dir=store_dir)
    index = read_ai_rankings(index_name, store_dir=store_dir) or {
        "board": board,
        "league_id": league_id,
        "weeks": [],
    }
    weeks = [str(item) for item in index.get("weeks") or [] if item != week_lbl]
    weeks.append(week_lbl)
    weeks = sorted(set(weeks), key=_week_sort_key)
    latest = week_lbl if promote_latest else index.get("latest")
    if latest not in weeks and weeks:
        latest = weeks[-1]
    index = {
        "board": board,
        "league_id": league_id,
        "latest": latest,
        "weeks": weeks,
        "updated_at": document.get("generated_at"),
    }
    paths["index"] = write_ai_rankings(index, index_name, store_dir=store_dir)
    return paths


def _week_sort_key(label: str) -> tuple[int, int]:
    parsed = parse_week_label(label)
    return parsed if parsed else (0, 0)


def load_prior(
    board: str,
    week_lbl: str,
    league_id: str | None = None,
    store_dir: Any = None,
) -> dict[str, Any] | None:
    index = read_ai_rankings(_index_name(board, league_id), store_dir=store_dir)
    if not index:
        latest = read_ai_rankings(_week_name(board, "latest", league_id), store_dir=store_dir)
        if latest and latest.get("week_label") != week_lbl and latest.get("rankings"):
            return latest
        return None
    current = parse_week_label(week_lbl) or (0, 0)
    prior_labels = []
    for item in index.get("weeks") or []:
        label = str(item)
        parsed = parse_week_label(label)
        if parsed and parsed < current:
            prior_labels.append((parsed, label))
    prior_labels.sort()
    for _parsed, label in reversed(prior_labels):
        prior = read_ai_rankings(
            _week_name(board, label, league_id), store_dir=store_dir
        )
        if prior and prior.get("rankings"):
            return prior
    return None


def _reuse_if_unchanged(
    board: str,
    week_lbl: str,
    digest: str,
    league_id: str | None = None,
    store_dir: Any = None,
) -> dict[str, Any] | None:
    existing = read_ai_rankings(_week_name(board, week_lbl, league_id), store_dir=store_dir)
    if (
        existing
        and existing.get("facts_hash") == digest
        and existing.get("rankings")
    ):
        return existing
    return None


def _unavailable_cfb_snapshot(
    *,
    season: int,
    week: int,
    degraded: list[str],
    now: datetime | None = None,
) -> dict[str, Any]:
    facts = {
        "season": season,
        "week": week,
        "week_label": week_label(season, week),
        "team_count": 0,
        "teams": [],
        "week_results": [],
        "ap_poll": [],
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "board": BOARD_CFB,
        "season": season,
        "week": week,
        "week_label": facts["week_label"],
        "generated_at": _now_iso(now),
        "model": "none",
        "temperature": DEFAULT_TEMPERATURE,
        "facts_hash": facts_hash(facts),
        "headline": "CFB rankings unavailable",
        "methodology": "",
        "last_week_review": "",
        "notes": [],
        "degraded": degraded,
        "rankings": [],
        "full_rankings": [],
        "movers": {"risers": [], "fallers": [], "new": [], "dropped": []},
        "ap_available": False,
    }


def resolve_cfb_week_number(
    week: int | None,
    today: date | None = None,
) -> int:
    if week is not None:
        return int(week)
    return estimated_cfb_week(today)


def _complete(
    config: RankingsLlmConfig | None,
    system: str,
    prompt: str,
    complete: CompleteFn | None,
) -> tuple[str, str, dict[str, Any]]:
    if complete is not None:
        raw = complete(system, prompt)
        return "injected/test", raw, extract_json_object(raw)
    if config is None:
        raise RuntimeError(
            "Rankings model key is not configured. Set SJ_RANKINGS_API_KEY "
            "(Secret Manager sj-rankings-api-key) or XAI_API_KEY / OPENAI_API_KEY."
        )
    raw = complete_openai_compatible(config, system, prompt)
    return config.label, raw, extract_json_object(raw)


def run_cfb_board(
    *,
    season: int | None = None,
    week: int | None = None,
    store_dir: Any = None,
    cfbd: CfbdClient | None = None,
    llm: RankingsLlmConfig | None = None,
    complete: CompleteFn | None = None,
    now: datetime | None = None,
    today: date | None = None,
    persist: bool = True,
    force: bool = False,
) -> dict[str, Any]:
    degraded: list[str] = []
    year = season or default_cfb_season(today)
    client = cfbd or CfbdClient(api_key=cfbd_api_key())
    if not client.available and cfbd is None:
        degraded.append(
            "College Football Data API key missing (Secret Manager sj-cfbd-api-key / "
            "SJ_CFBD_API_KEY). No games were fetched."
        )
        snapshot = _unavailable_cfb_snapshot(
            season=year,
            week=resolve_cfb_week_number(week, today),
            degraded=degraded,
            now=now,
        )
        if persist:
            persist_snapshot(snapshot, prompt="", raw_response="", store_dir=store_dir)
        return snapshot

    fetch_failed = False
    try:
        games = client.games(year)
    except RuntimeError as exc:
        degraded.append(f"CFBD games fetch failed: {exc}")
        games = []
        fetch_failed = True
    if not games:
        if "CFBD games fetch failed" not in " ".join(degraded):
            degraded.append(f"CFBD returned no FBS games for {year}.")
        snapshot = _unavailable_cfb_snapshot(
            season=year,
            week=resolve_cfb_week_number(week, today),
            degraded=degraded,
            now=now,
        )
        # Transient CFBD outages must not overwrite or index a published week.
        if persist and not fetch_failed:
            persist_snapshot(snapshot, prompt="", raw_response="", store_dir=store_dir)
        return snapshot
    resolved_week = week or latest_completed_week(games)
    try:
        ap_poll = client.rankings(year, resolved_week)
    except RuntimeError as exc:
        degraded.append(f"AP poll fetch failed: {exc}")
        ap_poll = []
    facts = build_cfb_facts(games, resolved_week, year, ap_poll)
    if not force:
        reused = _reuse_if_unchanged(
            BOARD_CFB, facts["week_label"], facts_hash(facts), store_dir=store_dir
        )
        if reused is not None:
            return reused
    prior = load_prior(BOARD_CFB, facts["week_label"], store_dir=store_dir)
    prompt = cfb_prompt(facts, prior)
    model, raw, parsed = _complete(llm or rankings_llm_config_from_env(), CFB_SYSTEM, prompt, complete)
    snapshot = assemble_cfb_snapshot(
        facts,
        parsed,
        model=model,
        temperature=(llm or rankings_llm_config_from_env() or RankingsLlmConfig(
            "none", "", "none", "", DEFAULT_TEMPERATURE
        )).temperature,
        prior=prior,
        degraded=degraded,
        now=now,
    )
    if persist:
        persist_snapshot(snapshot, prompt=prompt, raw_response=raw, store_dir=store_dir)
    snapshot["_prompt"] = prompt
    snapshot["_raw_response"] = raw
    return snapshot


def run_fantasy_board(
    league_id: str,
    *,
    season: int | None = None,
    week: int | None = None,
    store_dir: Any = None,
    registry_path: Any = None,
    llm: RankingsLlmConfig | None = None,
    complete: CompleteFn | None = None,
    now: datetime | None = None,
    today: date | None = None,
    persist: bool = True,
    force: bool = False,
) -> dict[str, Any]:
    spec = load_registry(registry_path).by_id(league_id)
    year = season or spec.current_season
    snapshot = resolve_store(store_dir).read(spec.id, year)
    if snapshot is None:
        raise FileNotFoundError(f"No snapshot for {spec.id} season {year}")
    clock = today or (now.date() if now is not None else None)
    facts = build_fantasy_facts(snapshot, today=clock)
    if week is not None:
        if 1 <= int(week) <= MAX_H2H_WEEK:
            facts["week"] = int(week)
            facts["week_label"] = week_label(year, int(week))
            facts["phase"] = "in_season"
        else:
            facts["week"] = 0
            facts["week_label"] = offseason_week_label(year, clock)
            facts["phase"] = "offseason"
    if not force:
        reused = _reuse_if_unchanged(
            BOARD_FANTASY,
            facts["week_label"],
            facts_hash(facts),
            spec.id,
            store_dir=store_dir,
        )
        if reused is not None:
            return reused
    prior = load_prior(BOARD_FANTASY, facts["week_label"], spec.id, store_dir=store_dir)
    prompt = fantasy_prompt(facts, prior)
    config = llm or rankings_llm_config_from_env()
    model, raw, parsed = _complete(config, FANTASY_SYSTEM, prompt, complete)
    document = assemble_fantasy_snapshot(
        facts,
        parsed,
        model=model,
        temperature=(config or RankingsLlmConfig("none", "", "none", "", DEFAULT_TEMPERATURE)).temperature,
        prior=prior,
        degraded=[],
        now=now,
    )
    if persist:
        persist_snapshot(document, prompt=prompt, raw_response=raw, store_dir=store_dir)
    document["_prompt"] = prompt
    document["_raw_response"] = raw
    return document


def run_all_fantasy(
    *,
    league_ids: list[str] | None = None,
    season: int | None = None,
    week: int | None = None,
    store_dir: Any = None,
    registry_path: Any = None,
    llm: RankingsLlmConfig | None = None,
    complete: CompleteFn | None = None,
    now: datetime | None = None,
    persist: bool = True,
    force: bool = False,
) -> list[dict[str, Any]]:
    wanted = list(league_ids or FANTASY_LEAGUES)
    results: list[dict[str, Any]] = []
    for league_id in wanted:
        results.append(
            run_fantasy_board(
                league_id,
                season=season,
                week=week,
                store_dir=store_dir,
                registry_path=registry_path,
                llm=llm,
                complete=complete,
                now=now,
                persist=persist,
                force=force,
            )
        )
    return results
