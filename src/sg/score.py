"""End-of-day golf week scorer (roadmap 6.3 / 6.4d).

Pure functions of locked lineups + round file + league settings. No live tour
API calls — hub reads precomputed scoreboard artifacts.
"""

from __future__ import annotations

from typing import Any

from sg.lineup import default_lineup_from_roster
from sg.rounds import (
    MIDWEEK_ROUNDS,
    ROUND_LABELS,
    WEEKEND_ROUNDS,
    fixture_event_rounds,
    index_rounds,
)
from sg.settings import GolfSettings, validate_golf_settings


def to_par_points(to_par: float | None) -> float:
    """``neg_to_par``: birdie (-1) → +1 fantasy point."""
    if to_par is None:
        return 0.0
    return -float(to_par)


def _status(row: dict[str, Any] | None) -> str:
    if not row:
        return "dns"
    return str(row.get("status") or "dns")


def _is_out(row: dict[str, Any] | None) -> bool:
    return _status(row) in {"mc", "wd", "dns"}


def _slot_points(row: dict[str, Any] | None) -> float:
    if not row or _status(row) != "active":
        return 0.0
    return to_par_points(row.get("to_par"))


def score_round_slots(
    *,
    starters: list[int],
    alt1: int | None,
    alt2: int | None,
    round_num: int,
    by_player: dict[int, dict[int, dict[str, Any]]],
    settings: GolfSettings,
) -> dict[str, Any]:
    """Score one calendar round for one team."""
    mode = settings.missed_cut.mode
    weekend = round_num in WEEKEND_ROUNDS
    alt_queue: list[tuple[str, int]] = []
    if weekend and mode in {"alt1", "alt1_2"} and alt1 is not None:
        alt_queue.append(("alt1", int(alt1)))
    if weekend and mode == "alt1_2" and alt2 is not None:
        alt_queue.append(("alt2", int(alt2)))

    slots: list[dict[str, Any]] = []
    for starter_id in starters:
        row = by_player.get(int(starter_id), {}).get(round_num)
        source = "starter"
        player_id = int(starter_id)
        used_row = row
        if weekend and mode != "off" and _is_out(row):
            replaced = False
            while alt_queue:
                src, alt_id = alt_queue.pop(0)
                alt_row = by_player.get(alt_id, {}).get(round_num)
                if alt_row is not None and _status(alt_row) == "active":
                    player_id = alt_id
                    used_row = alt_row
                    source = src
                    replaced = True
                    break
            if not replaced:
                used_row = None
        pts = _slot_points(used_row)
        slots.append(
            {
                "player_id": player_id,
                "starter_id": int(starter_id),
                "source": source,
                "status": _status(used_row) if used_row else (
                    _status(row) if row else "dns"
                ),
                "to_par": None if used_row is None else used_row.get("to_par"),
                "points": pts,
            }
        )

    if round_num in MIDWEEK_ROUNDS:
        keep_n = settings.scoring.thu_fri_count
        ranked = sorted(
            enumerate(slots),
            key=lambda item: (-item[1]["points"], item[0]),
        )
        keep_idx = {idx for idx, _ in ranked[:keep_n]}
        counted = [slots[i] for i in range(len(slots)) if i in keep_idx]
        dropped = [slots[i] for i in range(len(slots)) if i not in keep_idx]
        points = sum(float(s["points"]) for s in counted)
    else:
        counted = list(slots)
        dropped = []
        points = sum(float(s["points"]) for s in slots)

    return {
        "round": round_num,
        "label": ROUND_LABELS.get(round_num, str(round_num)),
        "points": float(points),
        "slots": slots,
        "counted_player_ids": [int(s["player_id"]) for s in counted],
        "dropped_player_ids": [int(s["player_id"]) for s in dropped],
    }


def score_team_week(
    lineup: dict[str, Any],
    round_file: dict[str, Any],
    settings: GolfSettings | dict[str, Any] | None,
    *,
    multiplier: float = 1.0,
    through_round: int = 4,
) -> dict[str, Any]:
    """Score one team's locked lineup for one event.

    ``through_round`` (1–4) limits which EOD rounds count — provisional boards
    as rounds land (roadmap 8.3). Remaining rounds are projected from the
    per-round average of completed counted points (disclosed heuristic, not a
    tour model).
    """
    golf = validate_golf_settings(settings)
    by_player = index_rounds(round_file)
    starters = [int(x) for x in (lineup.get("starters") or [])]
    captain = int(lineup["captain"])
    alt1 = lineup.get("alt1")
    alt2 = lineup.get("alt2")
    alt1_id = int(alt1) if alt1 is not None else None
    alt2_id = int(alt2) if alt2 is not None else None
    last_round = max(1, min(4, int(through_round or 4)))

    by_round: dict[str, Any] = {}
    week_raw = 0.0
    captain_week = 0.0
    golfer_week: dict[int, float] = {pid: 0.0 for pid in starters}
    for rnd in range(1, last_round + 1):
        result = score_round_slots(
            starters=starters,
            alt1=alt1_id,
            alt2=alt2_id,
            round_num=rnd,
            by_player=by_player,
            settings=golf,
        )
        by_round[str(rnd)] = result
        week_raw += float(result["points"])
        # Attribute counted slot points back to the original starter slot.
        counted = {int(x) for x in result["counted_player_ids"]}
        for slot in result["slots"]:
            if int(slot["player_id"]) in counted:
                sid = int(slot["starter_id"])
                golfer_week[sid] = golfer_week.get(sid, 0.0) + float(slot["points"])
        # Captain TB: points from rounds where the captain's score counted.
        if captain in result["counted_player_ids"]:
            for slot in result["slots"]:
                if (
                    int(slot["player_id"]) == captain
                    and slot["source"] == "starter"
                ):
                    captain_week += float(slot["points"])
                    break

    dropped_worst_id: int | None = None
    if golf.scoring.drop_worst_golfer and golfer_week:
        dropped_worst_id = min(
            golfer_week.items(), key=lambda item: (item[1], item[0])
        )[0]
        week_raw -= float(golfer_week[dropped_worst_id])

    # Forward fill remaining rounds from completed per-round average.
    remaining = 4 - last_round
    if remaining > 0 and last_round > 0:
        avg = week_raw / float(last_round)
        projected_raw = week_raw + avg * remaining
    else:
        projected_raw = week_raw

    status = "final" if last_round >= 4 else "in_progress"
    week_total = week_raw * float(multiplier)
    week_projected = projected_raw * float(multiplier)
    return {
        "starters": starters,
        "captain": captain,
        "alt1": alt1_id,
        "alt2": alt2_id,
        "week_raw": float(week_raw),
        "week_total": float(week_total),
        "week_projected": float(week_projected),
        "captain_week": float(captain_week),
        "multiplier": float(multiplier),
        "through_round": last_round,
        "status": status,
        "dropped_worst_player_id": dropped_worst_id,
        "by_round": by_round,
    }


def compare_h2h(
    home: dict[str, Any],
    away: dict[str, Any],
    *,
    captain_tiebreaker: bool = True,
) -> str:
    """Return outcome from home perspective: ``W`` / ``L`` / ``T``."""
    ht = float(home["week_total"])
    at = float(away["week_total"])
    if ht > at:
        return "W"
    if ht < at:
        return "L"
    if captain_tiebreaker:
        hc = float(home.get("captain_week") or 0.0)
        ac = float(away.get("captain_week") or 0.0)
        if hc > ac:
            return "W"
        if hc < ac:
            return "L"
    return "T"


def event_multiplier(
    settings: GolfSettings | dict[str, Any] | None,
    tier: str | None,
) -> float:
    golf = validate_golf_settings(settings)
    key = (tier or "regular").lower()
    table = golf.multipliers.model_dump(mode="json")
    return float(table.get(key) or table.get("regular") or 1.0)


def build_scoreboard_payload(
    snapshot: dict[str, Any],
    *,
    scored_at: str,
    event_ids: list[str] | None = None,
    round_files: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build hub ``scoreboard`` concern from lineups + fixture (or provided) rounds."""
    lineups = snapshot.get("lineups") or {}
    events = list(lineups.get("events") or [])
    if event_ids is not None:
        wanted = set(event_ids)
        events = [e for e in events if e.get("event_id") in wanted]
    settings_block = (snapshot.get("settings") or {}).get("golf")
    golf = validate_golf_settings(settings_block)
    team_lineups = lineups.get("teams") or {}
    teams_meta = {int(t["team_id"]): t for t in (snapshot.get("teams") or [])}

    # Field = union of tee_times keys + all rostered ids.
    field_ids: set[int] = set()
    for event in events:
        for key in (event.get("tee_times") or {}):
            try:
                field_ids.add(int(key))
            except (TypeError, ValueError):
                pass
    for team in snapshot.get("teams") or []:
        for player in team.get("roster") or []:
            if player.get("id") is not None:
                field_ids.add(int(player["id"]))

    scored_events: list[dict[str, Any]] = []
    for event in events:
        event_id = str(event["event_id"])
        tier = str(event.get("multiplier_tier") or "regular")
        mult = event_multiplier(golf, tier)
        rounds = (round_files or {}).get(event_id) or fixture_event_rounds(
            event_id, sorted(field_ids)
        )
        try:
            through = int(event.get("through_round") or 4)
        except (TypeError, ValueError):
            through = 4
        through = max(1, min(4, through))
        team_scores: dict[str, Any] = {}
        for team_id_key, team_meta in teams_meta.items():
            by_event = team_lineups.get(str(team_id_key)) or {}
            lineup = by_event.get(event_id) if isinstance(by_event, dict) else None
            if not isinstance(lineup, dict):
                if not golf.missed_deadline.auto_pick:
                    continue
                roster = list(team_meta.get("roster") or [])
                if len(roster) < golf.roster.starters:
                    continue
                lineup = default_lineup_from_roster(
                    roster, golf, saved_at=scored_at
                )
                lineup["source"] = "auto_pick"
            team_scores[str(team_id_key)] = score_team_week(
                lineup,
                rounds,
                golf,
                multiplier=mult,
                through_round=through,
            )

        # Pair 1–2, 3–4, … for fixture H2H cards.
        # In-progress events compare projected week totals; finals use week_total.
        ordered = sorted((int(tid) for tid in team_scores), key=lambda x: x)
        pairings: list[dict[str, Any]] = []
        for i in range(0, len(ordered) - 1, 2):
            home_id, away_id = ordered[i], ordered[i + 1]
            home = team_scores[str(home_id)]
            away = team_scores[str(away_id)]
            home_cmp = {
                **home,
                "week_total": home.get("week_projected", home["week_total"])
                if through < 4
                else home["week_total"],
            }
            away_cmp = {
                **away,
                "week_total": away.get("week_projected", away["week_total"])
                if through < 4
                else away["week_total"],
            }
            outcome = compare_h2h(
                home_cmp,
                away_cmp,
                captain_tiebreaker=golf.captain_tiebreaker,
            )
            pairings.append(
                {
                    "home_team_id": home_id,
                    "away_team_id": away_id,
                    "home_name": (teams_meta.get(home_id) or {}).get("name"),
                    "away_name": (teams_meta.get(away_id) or {}).get("name"),
                    "home_total": home_cmp["week_total"],
                    "away_total": away_cmp["week_total"],
                    "home_captain_week": home["captain_week"],
                    "away_captain_week": away["captain_week"],
                    "outcome": outcome,
                }
            )

        scored_events.append(
            {
                "event_id": event_id,
                "name": event.get("name"),
                "week": event.get("week"),
                "segment_id": event.get("segment_id"),
                "multiplier_tier": tier,
                "multiplier": mult,
                "through_round": through,
                "status": "final" if through >= 4 else "in_progress",
                "scored_at": scored_at,
                "teams": team_scores,
                "pairings": pairings,
            }
        )

    current = None
    if scored_events:
        current = lineups.get("current_event_id") or scored_events[0]["event_id"]
    return {
        "period_label": "event",
        "current_event_id": current,
        "events": scored_events,
    }
