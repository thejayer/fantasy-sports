import numpy as np
import pandas as pd
import pytest

from ffa.calibration import (
    dispersion_decomposition,
    dispersion_direction,
    quantile_calibration,
)

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


# ---------- dispersion_decomposition ----------


def test_decomposition_splits_modeled_vs_unmodeled_variance():
    # Posterior SD is a constant 10 (modeled var 100). Construct residuals
    # with a known std of 20 (residual var 400) -> ratio 2, frac_modeled 0.25.
    rng = np.random.default_rng(0)
    resid = rng.normal(0, 20, size=20000)
    resid = (resid - resid.mean()) / resid.std() * 20.0  # force exact std=20, mean=0
    players = pd.DataFrame(
        {
            "position": "WR",
            "points_mean": 100.0,
            "points_sd": 10.0,
            "points_realized": 100.0 + resid,
        }
    )
    row = dispersion_decomposition(players, by=None).iloc[0]
    assert row["modeled_sd"] == pytest.approx(10.0)
    assert row["resid_sd"] == pytest.approx(20.0)
    assert row["ratio"] == pytest.approx(2.0)
    assert row["frac_modeled"] == pytest.approx(0.25)
    assert row["bias"] == pytest.approx(0.0, abs=1e-9)


def test_decomposition_well_dispersed_gives_ratio_one():
    rng = np.random.default_rng(1)
    resid = rng.normal(0, 15, size=20000)
    resid = (resid - resid.mean()) / resid.std() * 15.0
    players = pd.DataFrame(
        {"position": "RB", "points_mean": 50.0, "points_sd": 15.0, "points_realized": 50.0 + resid}
    )
    row = dispersion_decomposition(players, by=None).iloc[0]
    assert row["ratio"] == pytest.approx(1.0)
    assert row["frac_modeled"] == pytest.approx(1.0)


def test_decomposition_missing_columns_returns_empty():
    assert dispersion_decomposition(pd.DataFrame({"points_mean": [1.0]})).empty
