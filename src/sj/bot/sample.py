"""Deterministic synthetic slate + seeded board so /bets?tab=bot is never empty.

Every document is labeled ``simulated: true``. Names are invented clubs —
no real bettor names and no tracker contents.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sj.bot import BOT_KIND_PREFIX, BOT_WHO, SCHEMA_VERSION, SIGNAL_LABELS
from sj.bot.learn import iso_week, note_document
from sj.bot.odds import parse_espn_scoreboard
from sj.bot.signals import default_weights

SAMPLE_LABEL = "Simulated sample data"
SEED_START = date(2026, 10, 20)


def _event(
    *,
    eid: str,
    start: str,
    away: tuple[str, str, str],
    home: tuple[str, str, str],
    spread: float,
    total: float,
    away_ml: int,
    home_ml: int,
    away_rec: str,
    home_rec: str,
    away_score: int | None = None,
    home_score: int | None = None,
    completed: bool = False,
    details: str | None = None,
) -> dict[str, Any]:
    state = "post" if completed else "pre"
    return {
        "id": eid,
        "date": start,
        "competitions": [
            {
                "id": eid,
                "date": start,
                "competitors": [
                    {
                        "id": away[0],
                        "homeAway": "away",
                        "score": None if away_score is None else str(away_score),
                        "team": {
                            "id": away[0],
                            "abbreviation": away[1],
                            "displayName": away[2],
                        },
                        "records": [{"type": "total", "summary": away_rec}],
                    },
                    {
                        "id": home[0],
                        "homeAway": "home",
                        "score": None if home_score is None else str(home_score),
                        "team": {
                            "id": home[0],
                            "abbreviation": home[1],
                            "displayName": home[2],
                        },
                        "records": [{"type": "total", "summary": home_rec}],
                    },
                ],
                "odds": [
                    {
                        "provider": {"name": "ESPN BET"},
                        "details": details or f"{away[1]} {-spread:+g}",
                        "spread": spread,
                        "overUnder": total,
                        "awayTeamOdds": {"moneyLine": away_ml, "spreadOdds": -110},
                        "homeTeamOdds": {"moneyLine": home_ml, "spreadOdds": -110},
                        "overOdds": -110,
                        "underOdds": -110,
                    }
                ],
                "status": {
                    "type": {
                        "state": state,
                        "completed": completed,
                        "name": "STATUS_FINAL" if completed else "STATUS_SCHEDULED",
                    }
                },
            }
        ],
    }


def sample_espn_scoreboard(
    sport: str, day: date, *, final: bool = False, steam: float = 0.0
) -> dict[str, Any]:
    """Tiny invented slate. ``steam`` shifts the spread toward the away side."""
    start = datetime(day.year, day.month, day.day, 17, 0, tzinfo=timezone.utc)
    iso = start.isoformat()
    if sport == "NFL":
        spread = -3.0 - steam
        return {
            "events": [
                _event(
                    eid=f"syn-nfl-{day.isoformat()}",
                    start=iso,
                    away=("91", "RED", "Red River Foxes"),
                    home=("92", "BAY", "Bayou Lanterns"),
                    spread=spread,
                    total=44.5 + steam,
                    away_ml=-155,
                    home_ml=135,
                    away_rec="6-2",
                    home_rec="4-4",
                    away_score=27 if final else None,
                    home_score=20 if final else None,
                    completed=final,
                    details=f"RED {spread:+g}",
                )
            ]
        }
    if sport == "CFB":
        spread = -7.5 - steam
        return {
            "events": [
                _event(
                    eid=f"syn-cfb-{day.isoformat()}",
                    start=iso,
                    away=("81", "OAK", "Oak Ridge Owls"),
                    home=("82", "PINE", "Pine State Pilots"),
                    spread=spread,
                    total=51.5,
                    away_ml=-260,
                    home_ml=210,
                    away_rec="7-1",
                    home_rec="3-5",
                    away_score=31 if final else None,
                    home_score=24 if final else None,
                    completed=final,
                    details=f"OAK {spread:+g}",
                )
            ]
        }
    spread = 2.5 - steam
    return {
        "events": [
            _event(
                eid=f"syn-nba-{day.isoformat()}",
                start=iso,
                away=("71", "COB", "Cobalt Flyers"),
                home=("72", "MAR", "Marble City"),
                spread=spread,
                total=221.5,
                away_ml=120,
                home_ml=-140,
                away_rec="3-2",
                home_rec="4-1",
                away_score=110 if final else None,
                home_score=104 if final else None,
                completed=final,
                details=f"MAR {-spread:+g}",
            )
        ]
    }


def sample_group_sidecars() -> tuple[dict[str, Any], dict[str, Any]]:
    """Synthetic record_splits / tailing_legs. Poster labels are invented."""
    splits = {
        "schema_version": SCHEMA_VERSION,
        "source": "sample",
        "simulated": True,
        "splits": [
            {
                "who": "*",
                "kind": "single_team",
                "sport": None,
                "section": "main",
                "wins": 12,
                "losses": 8,
                "pushes": 1,
                "win_pct": 0.6,
            }
        ],
        "sports": [
            {
                "who": "*",
                "kind": "single_team",
                "sport": "NFL",
                "section": "sport",
                "wins": 7,
                "losses": 3,
                "pushes": 0,
                "win_pct": 0.7,
            },
            {
                "who": "*",
                "kind": "single_team",
                "sport": "NBA",
                "section": "sport",
                "wins": 3,
                "losses": 5,
                "pushes": 0,
                "win_pct": 0.375,
            },
        ],
        "checks": [],
    }
    tailing = {
        "schema_version": SCHEMA_VERSION,
        "source": "sample",
        "simulated": True,
        "views": [
            {
                "who": "*",
                "overall": {
                    "n": 20,
                    "wins": 12,
                    "losses": 8,
                    "pushes": 0,
                    "record": "12-8-0",
                    "tail_110": 2.9,
                    "fade_110": -2.9,
                    "signal": "tail",
                },
                "splits": {
                    "sport": [
                        {
                            "key": "NFL",
                            "n": 10,
                            "wins": 7,
                            "losses": 3,
                            "tail_110": 3.4,
                            "fade_110": -3.4,
                        }
                    ]
                },
            }
        ],
        "legs": [],
    }
    return splits, tailing


def _pick(
    *,
    pid: str,
    day: date,
    sport: str,
    market: str,
    side: str,
    selection: str,
    game_id: str,
    line: float | None,
    american: int,
    units: float,
    result: str,
    units_pl: float | None,
    clv: float | None,
    reason: str,
    signals: list[dict[str, Any]],
) -> dict[str, Any]:
    start = datetime(day.year, day.month, day.day, 17, 0, tzinfo=timezone.utc)
    placed = start - timedelta(hours=8)
    graded = start + timedelta(hours=4) if result != "Pending" else None
    return {
        "id": pid,
        "who": BOT_WHO,
        "placed_at": placed.isoformat(),
        "graded_at": graded.isoformat() if graded else None,
        "sport": sport,
        "market": market,
        "side": side,
        "selection": selection,
        "game_id": game_id,
        "start": start.isoformat(),
        "american": american,
        "line": line,
        "units": units,
        "reason": reason,
        "signals": signals,
        "result": result,
        "units_pl": units_pl,
        "clv": clv,
        "closing_line": (line - 0.5) if line is not None and result != "Pending" else None,
        "closing_american": american - 5 if result != "Pending" else None,
        "book": "ESPN BET",
        "score": 0.22,
    }


def _sig(sid: str, weight: float, value: float, note: str) -> dict[str, Any]:
    return {
        "id": sid,
        "label": SIGNAL_LABELS[sid],
        "weight": weight,
        "value": value,
        "note": note,
    }


def seeded_picks() -> list[dict[str, Any]]:
    """Five graded days + a few still-open slips. All invented."""
    w = default_weights()
    nfl = [
        _sig("line_move", w["line_move"]["weight"], 0.6, "opened -2.5, now -3.5 (toward this side)"),
        _sig("group_hot", w["group_hot"]["weight"], 0.7, "group NFL single_team is 7-3 (70%)"),
        _sig("team_form", w["team_form"]["weight"], 0.4, "RED 75% vs opp 50%"),
        _sig("tail", w["tail"]["weight"], 0.5, "tail @ −110 is +3.4u over 10 legs"),
        _sig("fade", w["fade"]["weight"], 0.0, "tail weight leads, fade parked"),
        _sig("clv", w["clv"]["weight"], 0.2, "own NFL spread CLV avg +0.40 over 4"),
        _sig("own_form", w["own_form"]["weight"], 0.3, "own NFL spread is 3-1"),
    ]
    nba = [
        _sig("team_form", w["team_form"]["weight"], 0.35, "COB 60% vs opp 80%"),
        _sig("line_move", w["line_move"]["weight"], -0.2, "opened +2.5, now +3.0 (away from this side)"),
        _sig("group_hot", w["group_hot"]["weight"], -0.3, "group NBA single_team is 3-5 (38%)"),
        _sig("own_form", w["own_form"]["weight"], 0.0, "own NBA spread sample is 2"),
        _sig("clv", w["clv"]["weight"], 0.0, "not enough of our own CLV yet"),
        _sig("tail", w["tail"]["weight"], 0.1, "tail @ −110 is +0.4u over 6 legs"),
        _sig("fade", w["fade"]["weight"], 0.0, "tail weight leads, fade parked"),
    ]
    cfb = [
        _sig("team_form", w["team_form"]["weight"], 0.7, "OAK 88% vs opp 38%"),
        _sig("line_move", w["line_move"]["weight"], 0.3, "opened -6.5, now -7.5 (toward this side)"),
        _sig("group_hot", w["group_hot"]["weight"], 0.2, "group CFB single_team is 5-4 (56%)"),
        _sig("own_form", w["own_form"]["weight"], 0.1, "own CFB spread is 2-2"),
        _sig("clv", w["clv"]["weight"], 0.15, "own CFB spread CLV avg +0.25 over 4"),
        _sig("tail", w["tail"]["weight"], 0.2, "tail @ −110 is +1.1u over 8 legs"),
        _sig("fade", w["fade"]["weight"], 0.0, "tail weight leads, fade parked"),
    ]
    d0 = SEED_START
    d1 = SEED_START + timedelta(days=1)
    d2 = SEED_START + timedelta(days=2)
    d3 = SEED_START + timedelta(days=3)
    d4 = SEED_START + timedelta(days=4)
    open_day = SEED_START + timedelta(days=5)
    return [
        _pick(
            pid="BOT-20261020-1",
            day=d0,
            sport="NFL",
            market="spread",
            side="away",
            selection="RED -3",
            game_id=f"syn-nfl-{d0.isoformat()}",
            line=-3.0,
            american=-110,
            units=1.0,
            result="W",
            units_pl=0.9091,
            clv=0.5,
            reason="Paper RED -3: Line movement (opened -2.5, now -3.5); Group heat (group NFL single_team is 7-3).",
            signals=nfl,
        ),
        _pick(
            pid="BOT-20261020-2",
            day=d0,
            sport="NBA",
            market="ml",
            side="away",
            selection="COB ML",
            game_id=f"syn-nba-{d0.isoformat()}",
            line=None,
            american=120,
            units=1.0,
            result="W",
            units_pl=1.2,
            clv=0.02,
            reason="Paper COB ML: Team form (COB 60% vs opp 80% inverted on the moneyline dog).",
            signals=nba,
        ),
        _pick(
            pid="BOT-20261021-1",
            day=d1,
            sport="CFB",
            market="spread",
            side="away",
            selection="OAK -7.5",
            game_id=f"syn-cfb-{d1.isoformat()}",
            line=-7.5,
            american=-110,
            units=1.0,
            result="L",
            units_pl=-1.0,
            clv=-0.5,
            reason="Paper OAK -7.5: Team form (OAK 88% vs opp 38%); Line movement (opened -6.5, now -7.5).",
            signals=cfb,
        ),
        _pick(
            pid="BOT-20261022-1",
            day=d2,
            sport="NFL",
            market="total",
            side="over",
            selection="Over 44.5",
            game_id=f"syn-nfl-{d2.isoformat()}",
            line=44.5,
            american=-110,
            units=1.0,
            result="W",
            units_pl=0.9091,
            clv=0.5,
            reason="Paper Over 44.5: Team form (Over: combined win rate 62%); Group heat (group NFL is hot).",
            signals=nfl,
        ),
        _pick(
            pid="BOT-20261023-1",
            day=d3,
            sport="NBA",
            market="spread",
            side="home",
            selection="MAR -2.5",
            game_id=f"syn-nba-{d3.isoformat()}",
            line=-2.5,
            american=-110,
            units=1.0,
            result="L",
            units_pl=-1.0,
            clv=0.0,
            reason="Paper MAR -2.5: Team form (MAR 80% vs opp 60%).",
            signals=nba,
        ),
        _pick(
            pid="BOT-20261024-1",
            day=d4,
            sport="NFL",
            market="spread",
            side="away",
            selection="RED -3.5",
            game_id=f"syn-nfl-{d4.isoformat()}",
            line=-3.5,
            american=-110,
            units=1.0,
            result="W",
            units_pl=0.9091,
            clv=1.0,
            reason="Paper RED -3.5: Line movement (opened -2.5, now -3.5); Tail the group (tail @ −110 is +3.4u).",
            signals=nfl,
        ),
        _pick(
            pid="BOT-20261025-1",
            day=open_day,
            sport="NFL",
            market="spread",
            side="away",
            selection="RED -3.5",
            game_id=f"syn-nfl-{open_day.isoformat()}",
            line=-3.5,
            american=-110,
            units=1.0,
            result="Pending",
            units_pl=None,
            clv=None,
            reason="Paper RED -3.5: Line movement (opened -3, now -3.5); Group heat (group NFL single_team is 7-3).",
            signals=nfl,
        ),
        _pick(
            pid="BOT-20261025-2",
            day=open_day,
            sport="CFB",
            market="spread",
            side="away",
            selection="OAK -7.5",
            game_id=f"syn-cfb-{open_day.isoformat()}",
            line=-7.5,
            american=-110,
            units=1.0,
            result="Pending",
            units_pl=None,
            clv=None,
            reason="Paper OAK -7.5: Team form (OAK 88% vs opp 38%).",
            signals=cfb,
        ),
        _pick(
            pid="BOT-20261025-3",
            day=open_day,
            sport="NBA",
            market="total",
            side="under",
            selection="Under 221.5",
            game_id=f"syn-nba-{open_day.isoformat()}",
            line=221.5,
            american=-110,
            units=1.0,
            result="Pending",
            units_pl=None,
            clv=None,
            reason="Paper Under 221.5: own NBA totals have been quiet; fading a high number.",
            signals=nba,
        ),
    ]


def seeded_weights() -> dict[str, dict[str, Any]]:
    weights = default_weights()
    weights["line_move"]["alpha"] = 7.0
    weights["line_move"]["beta"] = 4.0
    weights["line_move"]["hits"] = 3
    weights["line_move"]["misses"] = 0
    weights["line_move"]["weight"] = 7.0 / 11.0
    weights["group_hot"]["alpha"] = 6.0
    weights["group_hot"]["beta"] = 4.0
    weights["group_hot"]["hits"] = 2
    weights["group_hot"]["weight"] = 6.0 / 10.0
    weights["team_form"]["alpha"] = 5.0
    weights["team_form"]["beta"] = 6.0
    weights["team_form"]["hits"] = 1
    weights["team_form"]["misses"] = 2
    weights["team_form"]["weight"] = 5.0 / 11.0
    return weights


def seeded_board() -> dict[str, Any]:
    picks = seeded_picks()
    weights = seeded_weights()
    before = default_weights()
    note = note_document(
        week=iso_week(datetime(2026, 10, 26, tzinfo=timezone.utc)),
        before=before,
        after=weights,
        graded=6,
        simulated=True,
    )
    series = [
        {"date": "start", "bankroll": 100.0},
        {"date": "2026-10-20", "bankroll": 102.1091},
        {"date": "2026-10-21", "bankroll": 101.1091},
        {"date": "2026-10-22", "bankroll": 102.0182},
        {"date": "2026-10-23", "bankroll": 101.0182},
        {"date": "2026-10-24", "bankroll": 101.9273},
    ]
    open_picks = [p for p in picks if p["result"] == "Pending"]
    recent = [p for p in picks if p["result"] != "Pending"]
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_board",
        "who": BOT_WHO,
        "simulated": True,
        "simulated_label": SAMPLE_LABEL,
        "synced_at": "2026-10-26T12:00:00+00:00",
        "staking": "flat",
        "bankroll_start": 100.0,
        "bankroll": 101.9273,
        "record": "4-2-0",
        "wins": 4,
        "losses": 2,
        "pushes": 0,
        "pending": 3,
        "units_pl": 1.9273,
        "bankroll_series": series,
        "open": open_picks,
        "recent": list(reversed(recent)),
        "weights": [weights[sid] for sid in weights],
        "note": note,
        "pick_count": len(picks),
        "source": "sample",
    }


def write_seed(store_dir, *, also_group: bool = False) -> dict[str, Any]:
    """Persist the seeded sample under ``bets/bot/`` (and optional group sidecars)."""
    from sj.bot.paths import BANKROLL, BOARD, NOTE_LATEST, PICKS, SCORECARD, WEIGHTS, write_named
    from sj.store import write_bets

    board = seeded_board()
    picks = {
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_picks",
        "who": BOT_WHO,
        "simulated": True,
        "simulated_label": SAMPLE_LABEL,
        "staking": "flat",
        "picks": seeded_picks(),
        "source": "sample",
    }
    weights = {
        "schema_version": SCHEMA_VERSION,
        "kind": f"{BOT_KIND_PREFIX}_weights",
        "simulated": True,
        "signals": seeded_weights(),
        "source": "sample",
    }
    write_named(board, BOARD, store_dir=store_dir)
    write_named(picks, PICKS, store_dir=store_dir)
    write_named(weights, WEIGHTS, store_dir=store_dir)
    write_named(
        {
            "schema_version": SCHEMA_VERSION,
            "kind": f"{BOT_KIND_PREFIX}_scorecard",
            "simulated": True,
            "rows": [
                {
                    "sport": "NFL",
                    "market": "spread",
                    "wins": 2,
                    "losses": 0,
                    "pushes": 0,
                    "n": 2,
                    "avg_clv": 0.75,
                    "clv_n": 2,
                },
                {
                    "sport": "NFL",
                    "market": "total",
                    "wins": 1,
                    "losses": 0,
                    "pushes": 0,
                    "n": 1,
                    "avg_clv": 0.5,
                    "clv_n": 1,
                },
                {
                    "sport": "CFB",
                    "market": "spread",
                    "wins": 0,
                    "losses": 1,
                    "pushes": 0,
                    "n": 1,
                    "avg_clv": -0.5,
                    "clv_n": 1,
                },
                {
                    "sport": "NBA",
                    "market": "ml",
                    "wins": 1,
                    "losses": 0,
                    "pushes": 0,
                    "n": 1,
                    "avg_clv": 0.02,
                    "clv_n": 1,
                },
                {
                    "sport": "NBA",
                    "market": "spread",
                    "wins": 0,
                    "losses": 1,
                    "pushes": 0,
                    "n": 1,
                    "avg_clv": 0.0,
                    "clv_n": 1,
                },
            ],
            "source": "sample",
        },
        SCORECARD,
        store_dir=store_dir,
    )
    write_named(board["note"], NOTE_LATEST, store_dir=store_dir)
    write_named(
        {
            "schema_version": SCHEMA_VERSION,
            "kind": f"{BOT_KIND_PREFIX}_bankroll",
            "simulated": True,
            "start": 100.0,
            "current": 101.9273,
            "series": board["bankroll_series"],
            "source": "sample",
        },
        BANKROLL,
        store_dir=store_dir,
    )
    if also_group:
        splits, tailing = sample_group_sidecars()
        write_bets(splits, "record_splits", store_dir=store_dir)
        write_bets(tailing, "tailing_legs", store_dir=store_dir)
    return board


class ReplayOddsProvider:
    """Walks a canned ESPN-shaped timeline for ``sj bot backtest``."""

    name = "replay"

    def __init__(self, slates: dict[tuple[str, str], dict[str, Any]]):
        self.slates = slates

    def scoreboard(self, sport: str, day: date) -> dict[str, Any]:
        return self.slates.get((sport.upper(), day.isoformat()), {"events": []})


def backtest_slates(days: int = 5) -> dict[tuple[str, str], dict[str, Any]]:
    slates: dict[tuple[str, str], dict[str, Any]] = {}
    for offset in range(days):
        day = SEED_START + timedelta(days=offset)
        steam = 0.5 if offset else 0.0
        for sport in ("NFL", "CFB", "NBA"):
            slates[(sport, day.isoformat())] = sample_espn_scoreboard(
                sport, day, final=offset < days - 1, steam=steam
            )
    return slates


def parsed_sample_games(sport: str = "NFL", day: date | None = None) -> list[dict[str, Any]]:
    day = day or SEED_START
    return parse_espn_scoreboard(sample_espn_scoreboard(sport, day), sport)
