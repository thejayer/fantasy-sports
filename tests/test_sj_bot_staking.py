"""Flat and capped fractional Kelly staking."""

from __future__ import annotations

from sj.bot.staking import StakeConfig, kelly_full, score_to_p_win, stake_units


def test_flat_ignores_edge():
    cfg = StakeConfig(mode="flat", unit=1.0)
    assert stake_units(cfg, -110, 0.9) == 1.0
    assert stake_units(cfg, 250, 0.1) == 1.0


def test_kelly_positive_edge_is_capped():
    cfg = StakeConfig(
        mode="kelly",
        unit=1.0,
        bankroll=100.0,
        kelly_fraction=0.25,
        kelly_cap=2.0,
    )
    # Huge edge would be many units at full Kelly; quarter Kelly is capped at 2u.
    units = stake_units(cfg, -110, 0.7)
    assert 0 < units <= 2.0
    assert kelly_full(-110, 0.7) > 0
    assert kelly_full(-110, 0.4) < 0
    assert stake_units(cfg, -110, 0.4) == 0.0


def test_score_to_p_win_stays_near_the_market():
    implied = score_to_p_win(0.0, -110)
    assert 0.51 < implied < 0.53
    hotter = score_to_p_win(1.0, -110)
    colder = score_to_p_win(-1.0, -110)
    assert hotter > implied > colder
    assert 0.05 < colder < hotter < 0.95
