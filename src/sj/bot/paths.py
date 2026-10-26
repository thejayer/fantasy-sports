"""Read/write ``bets/bot/...`` through the existing bets sidecar store."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sj.store import read_bets, write_bets

BOARD = "bot/board"
PICKS = "bot/picks"
WEIGHTS = "bot/weights"
SCORECARD = "bot/scorecard"
NOTE_LATEST = "bot/notes/latest"
LINES_INDEX = "bot/lines/index"
BANKROLL = "bot/bankroll"


def write_bot(document: dict[str, Any], name: str, store_dir: Path | str | None = None) -> str:
    return write_bets(document, f"bot/{name}" if not str(name).startswith("bot/") else name, store_dir=store_dir)


def read_bot(name: str, store_dir: Path | str | None = None) -> dict[str, Any] | None:
    key = f"bot/{name}" if not str(name).startswith("bot/") else name
    return read_bets(key, store_dir=store_dir)


def write_named(document: dict[str, Any], rel: str, store_dir: Path | str | None = None) -> str:
    return write_bets(document, rel, store_dir=store_dir)


def read_named(rel: str, store_dir: Path | str | None = None) -> dict[str, Any] | None:
    return read_bets(rel, store_dir=store_dir)


def write_lines_snapshot(
    document: dict[str, Any], stamp: str, store_dir: Path | str | None = None
) -> str:
    return write_named(document, f"bot/lines/{stamp}", store_dir=store_dir)


def read_lines_snapshot(stamp: str, store_dir: Path | str | None = None) -> dict[str, Any] | None:
    return read_named(f"bot/lines/{stamp}", store_dir=store_dir)


def write_note_week(
    document: dict[str, Any], week: str, store_dir: Path | str | None = None
) -> str:
    return write_named(document, f"bot/notes/{week}", store_dir=store_dir)
