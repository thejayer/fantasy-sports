"""SJ Bot — paper-betting simulation (roadmap P.12).

Never writes the Google tracker. Never writes human ``bets/*.json``
sidecars. Artifacts live under ``bets/bot/`` on the same store the
``sj bets`` job already uses.
"""

from __future__ import annotations

import os

BOT_WHO = "SJ Bot"
BOT_KIND_PREFIX = "sj_bot"
SCHEMA_VERSION = 1
DEFAULT_BANKROLL = 100.0
DEFAULT_UNIT = 1.0
DEFAULT_KELLY_FRACTION = 0.25
DEFAULT_KELLY_CAP = 2.0
MIN_PICKS = 3
MAX_PICKS = 8
SPORTS = ("NFL", "CFB", "NBA")
MARKETS = ("spread", "total", "ml")
SIGNAL_IDS = (
    "line_move",
    "clv",
    "group_hot",
    "tail",
    "fade",
    "own_form",
    "team_form",
)
SIGNAL_LABELS = {
    "line_move": "Line movement",
    "clv": "Closing-line value",
    "group_hot": "Group heat",
    "tail": "Tail the group",
    "fade": "Fade the group",
    "own_form": "Own scorecard",
    "team_form": "Team form",
}


def bot_sync_enabled() -> bool:
    """On by default so the existing sj-bets job also refreshes the bot."""
    return os.environ.get("SJ_BOT_SYNC", "1") != "0"


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def staking_mode() -> str:
    mode = os.environ.get("SJ_BOT_STAKING", "flat").strip().lower()
    return "kelly" if mode == "kelly" else "flat"
