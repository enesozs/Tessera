import math

import numpy as np
import pandas as pd
import pytest

from tessera import portfolio, risk

RNG = np.random.default_rng(0)
COV = np.array([[0.04, 0.006, 0.0], [0.006, 0.09, 0.012], [0.0, 0.012, 0.0225]]) / 252
RETURNS = RNG.multivariate_normal([0.0004, 0.0002, 0.0003], COV, size=500)


def test_ledoit_wolf_matches_scikit_learn():
    sklearn = pytest.importorskip("sklearn.covariance")
    ref = sklearn.LedoitWolf().fit(RETURNS)
    cov, shrink = risk.ledoit_wolf(RETURNS)
    assert shrink == pytest.approx(ref.shrinkage_, rel=1e-9)
    assert cov == pytest.approx(ref.covariance_, rel=1e-9)


def test_shrinkage_is_zero_when_the_sample_is_already_the_target():
    x = np.array([[1.0, 0.0], [-1.0, 0.0], [0.0, 1.0], [0.0, -1.0]])  # sample cov ∝ identity
    _, shrink = risk.ledoit_wolf(x)
    assert shrink == 0.0


def test_euler_contributions_sum_to_portfolio_volatility():
    w = np.array([0.5, 0.3, 0.2])
    cov = COV * 252
    rc = risk.risk_contributions(w, cov)
    assert rc.sum() == pytest.approx(math.sqrt(w @ cov @ w))


def test_historical_var_and_expected_shortfall_on_a_known_sample():
    r = np.linspace(-0.10, 0.09, 20)  # -10%, -9%, ..., +9%
    v = risk.historical_var(r, 0.90)
    assert v.var == pytest.approx(-np.quantile(r, 0.10))
    assert v.es == pytest.approx(0.095)  # mean of the two worst days


def test_parametric_var_is_z_sigma_minus_mean():
    v = risk.parametric_var(0.001, 0.02, 0.99)
    assert v.var == pytest.approx(2.326347874 * 0.02 - 0.001, rel=1e-8)
    assert v.es > v.var


def test_monte_carlo_var_converges_to_parametric():
    w = np.array([0.4, 0.4, 0.2])
    mean = RETURNS.mean(axis=0)
    mc = risk.monte_carlo_var(w, mean, COV, 0.95, paths=200_000)
    par = risk.parametric_var(float(mean @ w), math.sqrt(w @ COV @ w), 0.95)
    assert mc.var == pytest.approx(par.var, rel=0.02)


def test_minimum_variance_two_uncorrelated_assets():
    cov = np.diag([0.04, 0.01])
    assert risk.minimum_variance(cov) == pytest.approx([0.2, 0.8], abs=1e-6)  # w ∝ 1/σ²


def test_risk_parity_equalises_contributions():
    cov = COV * 252
    w = risk.risk_parity(cov)
    rc = risk.risk_contributions(w, cov)
    assert rc == pytest.approx(np.full(3, rc.mean()), rel=1e-6)
    assert risk.risk_parity(np.diag([0.04, 0.01])) == pytest.approx(
        [1 / 3, 2 / 3], abs=1e-6
    )  # ∝ 1/σ


def test_max_drawdown_of_a_known_path():
    r = np.array([0.10, -0.20, 0.05, -0.10, 0.30])
    # Wealth 1.1, 0.88, 0.924, 0.8316, 1.081: worst is 0.8316 / 1.1 − 1.
    assert risk.max_drawdown(r) == pytest.approx(0.8316 / 1.1 - 1)


def test_window_return_uses_last_close_on_or_before_each_date_and_detects_missing_history():
    s = pd.Series(
        [100.0, 110.0, 99.0], index=pd.to_datetime(["2020-02-18", "2020-02-21", "2020-03-23"])
    )
    assert portfolio._window_return(s, "2020-02-19", "2020-03-23") == pytest.approx(-0.01)
    assert portfolio._window_return(s, "2019-01-01", "2020-03-23") is None


def test_thin_keeps_the_last_point():
    out = portfolio.thin(list(range(1001)), target=400)
    assert out[0] == 0 and out[-1] == 1000 and len(out) <= 402
