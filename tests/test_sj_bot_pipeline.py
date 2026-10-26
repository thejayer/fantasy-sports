"""Seed, backtest, and store isolation for SJ Bot."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from typer.testing import CliRunner

from sj.bot.odds import FixtureOddsProvider
from sj.bot.pipeline import build_board, run_bot
from sj.bot.sample import SEED_START, backtest_slates, seeded_board, write_seed
from sj.cli import app
from sj.store import FileStore, read_bets

runner = CliRunner()


def test_seed_writes_simulated_board_without_touching_human_bets(tmp_path: Path):
    store = FileStore(tmp_path)
    store.write_bets({"bets": [{"id": "H-1", "who": "Poster A"}], "bet_count": 1}, "bets")
    board = write_seed(tmp_path)
    assert board["simulated"] is True
    assert board["who"] == "SJ Bot"
    assert board["record"] == "4-2-0"
    assert (tmp_path / "bets" / "bot" / "board.json").exists()
    humans = read_bets("bets", store_dir=tmp_path)
    assert humans["bets"][0]["who"] == "Poster A"
    assert all(p["who"] != "SJ Bot" for p in humans["bets"])


def test_seeded_board_is_labeled_sample():
    board = seeded_board()
    assert board["simulated"] is True
    assert "Simulated" in (board.get("simulated_label") or "")
    assert board["note"]["simulated"] is True
    assert board["open"]
    assert board["recent"]
    assert board["weights"]
    assert board["bankroll_series"]


def test_backtest_replays_without_network(tmp_path: Path):
    slates = backtest_slates(4)
    provider = FixtureOddsProvider(slates)
    last = None
    for offset in range(4):
        day = SEED_START + timedelta(days=offset)
        now = datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc)
        last = run_bot(
            store_dir=tmp_path,
            provider=provider,
            now=now,
            simulated=True,
        )
    board = last["board"]
    assert board["simulated"] is True
    assert board["pick_count"] >= 3
    assert (tmp_path / "bets" / "bot" / "lines" / "index.json").exists()
    rebuilt = build_board(store_dir=tmp_path)
    assert rebuilt["record"]


def test_cli_seed_and_bot_help(tmp_path: Path):
    result = runner.invoke(app, ["bot", "--help"])
    assert result.exit_code == 0
    assert "snapshot" in result.stdout
    assert "pick" in result.stdout
    assert "grade" in result.stdout
    assert "learn" in result.stdout
    seeded = runner.invoke(app, ["bot", "seed", "--store-dir", str(tmp_path)])
    assert seeded.exit_code == 0
    assert "simulated" in seeded.stdout.lower()
    assert (tmp_path / "bets" / "bot" / "board.json").exists()
