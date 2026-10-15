import math

import pytest
from derivlab import Market
from derivlab.data.cleaning import clean_chain
from derivlab.data.synthetic import SyntheticSpec, synthetic_chain

from tessera import options
from tessera.providers import rates


def test_leg_price_prefers_a_sane_mid_then_falls_back_to_last():
    assert options.leg_price(1.0, 1.2, 0.9) == (pytest.approx(1.1), "mid")
    assert options.leg_price(0.1, 1.0, 0.5) == (0.5, "last")  # spread > 50% of mid
    assert options.leg_price(0.0, 0.0, 0.7) == (0.7, "last")  # market closed
    assert options.leg_price(None, None, None) is None


def test_implied_vol_round_trips_a_black_scholes_price():
    # ATM call, 1y, r = 5%, no dividends, σ = 20% → 10.4506 (Hull's textbook value).
    vol, greeks = options.analyse_leg(
        "call", 100.0, 10.450583572185565, 1.0, Market(100.0, 0.05, 0.0)
    )
    assert vol == pytest.approx(0.20, abs=1e-8)
    assert greeks.delta == pytest.approx(0.6368, abs=1e-4)


def test_prices_outside_no_arbitrage_bounds_have_no_implied_vol():
    vol, greeks = options.analyse_leg("call", 100.0, 0.0001 + 100.0, 1.0, Market(100.0, 0.05, 0.0))
    assert vol is None and greeks is None


def test_realised_vol_of_a_constant_growth_series_is_zero_and_needs_history():
    closes = [100 * math.exp(0.001 * i) for i in range(30)]
    assert options.realized_vol(closes, 21) == pytest.approx(0.0, abs=1e-12)
    assert options.realized_vol(closes[:10], 21) is None


def test_smile_summary_on_a_synthetic_heston_chain():
    chain = synthetic_chain(SyntheticSpec(expiry_days=(91,)))
    data = clean_chain(chain, rate=0.04)
    s = options.smile_slice(data.slices[0])
    assert 0.05 < s.atm_vol < 0.6
    assert len(s.fit_iv) == 41 and s.rmse is not None and s.rmse < 0.01
    # Heston with negative spot–vol correlation gives a downward equity skew.
    assert s.skew_90_110 is not None and s.skew_90_110 > 0


def test_risk_free_rate_interpolates_the_par_curve(monkeypatch):
    curve = rates.YieldCurve(
        region="US",
        name="t",
        basis="t",
        tenors=["1M", "1Y", "2Y"],
        tenor_years=[1 / 12, 1.0, 2.0],
        snapshots=[rates.CurveSnapshot(label="Latest", date="2026-10-14", yields=[4.0, 4.5, None])],
        history=rates.TenorHistory(dates=[], series={}),
    )
    env = type("E", (), {"data": curve})()
    monkeypatch.setattr(rates, "us_curve", lambda: env)
    r, _ = rates.risk_free_rate(0.5)
    y = 4.0 + (4.5 - 4.0) * (0.5 - 1 / 12) / (1 - 1 / 12)
    assert r == pytest.approx(2 * math.log(1 + y / 200))
    assert rates.risk_free_rate(5.0)[0] == pytest.approx(2 * math.log(1 + 4.5 / 200))  # flat beyond
