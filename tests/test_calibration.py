import pandas as pd
import pytest

from ffa.calibration import dispersion_direction, quantile_calibration

# 20 realized values placed in known bands relative to the quantile sets below.
REALIZED = [3, 10, 15, 20, 24, 30, 35, 40, 45, 48, 55, 60, 65, 70, 72, 80, 85, 88, 92, 100]
# Quantiles the REALIZED values are perfectly calibrated against.
CAL_Q = {0.05: 5, 0.25: 25, 0.5: 50, 0.75: 75, 0.95: 95}
# A narrower interval -> reality spills both tails (under-dispersed).
NARROW_Q = {0.05: 20, 0.25: 35, 0.5: 50, 0.75: 65, 0.95: 80}


def _players(realized, qmap, position="WR"):
    df = pd.DataFrame({"points_realized": list(realized), "position": position})
    for q, v in qmap.items():
        df[f"q{int(round(q * 100)):02d}"] = v
    return df


def test_calibration_coverage_is_exact_for_calibrated_population():
    cal = quantile_calibration(_players(REALIZED, CAL_Q), by=None)
    row = cal.iloc[0]
    assert row["group"] == "ALL"
    assert row["n"] == 20
    assert row["cov_q05"] == pytest.approx(0.05)
    assert row["cov_q25"] == pytest.approx(0.25)
    assert row["cov_q50"] == pytest.approx(0.50)
    assert row["cov_q75"] == pytest.approx(0.75)
    assert row["cov_q95"] == pytest.approx(0.95)
    assert row["central"] == pytest.approx(0.90)
    assert row["central_nominal"] == pytest.approx(0.90)
    assert row["cal_mae"] == pytest.approx(0.0)
    assert dispersion_direction(row) == "calibrated"


def test_calibration_flags_under_dispersion():
    cal = quantile_calibration(_players(REALIZED, NARROW_Q), by=None)
    row = cal.iloc[0]
    # Narrow interval: too many land at/below q05 and inside-out of q95.
    assert row["cov_q05"] == pytest.approx(0.20)
    assert row["cov_q95"] == pytest.approx(0.80)
    assert row["central"] == pytest.approx(0.65)
    assert row["cal_mae"] == pytest.approx(0.10)
    assert dispersion_direction(row) == "under-dispersed"


def test_by_position_puts_all_first_then_worst_calibrated():
    good = _players(REALIZED, CAL_Q, position="WR")
    bad = _players(REALIZED, NARROW_Q, position="RB")
    cal = quantile_calibration(pd.concat([good, bad], ignore_index=True), by="position")

    assert list(cal["position"])[0] == "ALL"
    # RB (cal_mae 0.10) is worse than WR (0.0) -> sorts ahead of WR.
    ranked = list(cal["position"])[1:]
    assert ranked == ["RB", "WR"]
    wr = cal.loc[cal["position"] == "WR"].iloc[0]
    rb = cal.loc[cal["position"] == "RB"].iloc[0]
    assert wr["cal_mae"] == pytest.approx(0.0)
    assert rb["cal_mae"] == pytest.approx(0.10)


def test_over_dispersion_direction():
    # Wide projected interval: everything lands comfortably inside.
    wide = _players(REALIZED, {0.05: -100, 0.25: 0, 0.5: 50, 0.75: 200, 0.95: 1000}, "TE")
    row = quantile_calibration(wide, by=None).iloc[0]
    assert row["central"] == pytest.approx(1.0)
    assert dispersion_direction(row) == "over-dispersed"


def test_empty_or_missing_quantiles_returns_empty():
    assert quantile_calibration(pd.DataFrame()).empty
    # realized present but no q-columns
    assert quantile_calibration(pd.DataFrame({"points_realized": [1, 2]})).empty
