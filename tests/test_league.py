from ffa.league import LeagueConfig


def test_defaults_are_standard_non_ppr():
    cfg = LeagueConfig()
    assert cfg.passing.yards_per_point == 25.0
    assert cfg.passing.td_points == 4.0
    assert cfg.rushing.td_points == 6.0
    assert cfg.receiving.reception_points == 0.0
    assert cfg.misc.fumble_lost == -2.0


def test_ppr_overrides_only_reception_points(ppr):
    assert ppr.receiving.reception_points == 1.0
    assert ppr.rushing.td_points == 6.0  # untouched


def test_half_ppr(half_ppr):
    assert half_ppr.receiving.reception_points == 0.5


def test_superflex_bonus_loads_bonuses(superflex_bonus):
    assert superflex_bonus.passing.td_points == 6.0
    thresholds = [b.threshold for b in superflex_bonus.rushing.bonuses]
    assert thresholds == [100, 200]
