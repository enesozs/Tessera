import pytest

from tessera import dcf, valuation
from tessera.providers import fx, research


def assumptions(**overrides) -> dcf.DcfAssumptions:
    base = dict(
        years=3,
        revenue_growth_start=0.10,
        terminal_growth=0.02,
        ebit_margin_start=0.20,
        ebit_margin_target=0.20,
        tax_rate=0.25,
        da_pct_revenue=0.05,
        capex_pct_revenue=0.05,
        nwc_pct_delta_revenue=0.10,
        risk_free=0.03,
        equity_risk_premium=0.05,
        beta=1.0,
        cost_of_debt=0.05,
        mid_year=False,
    )
    return dcf.DcfAssumptions(**{**base, **overrides})


CAP = dcf.CapitalStructure(
    base_revenue=100, market_cap=1000, total_debt=0, cash=10, minority_interest=0, shares=10
)


def test_dcf_matches_a_hand_computed_case():
    v = dcf.value(assumptions(), CAP)
    assert v.wacc.wacc == pytest.approx(0.08)  # all equity: rf + β·ERP
    # Growth fades 10% → 6% → 2%; FCFF = 0.75·EBIT + D&A − capex − 10%·ΔR (D&A = capex here).
    revenues = [110.0, 116.6, 118.932]
    fcff = [
        0.15 * r - 0.1 * (r - p) for r, p in zip(revenues, [100.0, *revenues[:-1]], strict=True)
    ]
    assert [y.revenue for y in v.projection] == pytest.approx(revenues)
    assert [y.fcff for y in v.projection] == pytest.approx(fcff)
    r4 = revenues[-1] * 1.02
    tv = (0.15 * r4 - 0.1 * (r4 - revenues[-1])) / (0.08 - 0.02)
    assert v.terminal_value == pytest.approx(tv)
    ev = sum(f / 1.08**t for t, f in enumerate(fcff, 1)) + tv / 1.08**3
    assert v.enterprise_value == pytest.approx(ev)
    assert v.per_share == pytest.approx((ev + 10) / 10)


def test_mid_year_convention_pulls_every_cash_flow_half_a_year_closer():
    end = dcf.value(assumptions(), CAP)
    mid = dcf.value(assumptions(mid_year=True), CAP)
    assert mid.enterprise_value == pytest.approx(end.enterprise_value * 1.08**0.5)


def test_wacc_blends_after_tax_debt_at_market_weights():
    cap = CAP.model_copy(update={"market_cap": 750, "total_debt": 250})
    w = dcf.compute_wacc(assumptions(), cap)
    assert w.wacc == pytest.approx(0.75 * 0.08 + 0.25 * 0.05 * 0.75)


def test_terminal_growth_must_stay_below_wacc():
    with pytest.raises(dcf.DcfError):
        dcf.value(assumptions(terminal_growth=0.055, beta=0.5), CAP)  # WACC = 5.5%


def test_sensitivity_grid_is_centred_on_the_base_case():
    a = assumptions()
    base = dcf.value(a, CAP)
    grid = dcf.sensitivity(a, CAP, base.wacc.wacc)

    def at(i: int, j: int) -> float:
        cell = grid.per_share[i][j]
        assert cell is not None
        return cell

    assert at(2, 2) == pytest.approx(base.per_share)
    # Higher WACC lowers value; higher terminal growth raises it.
    assert at(3, 2) < at(2, 2) < at(1, 2)
    assert at(2, 3) > at(2, 2)


def history(revenues, **extra):
    return [
        valuation.HistoryYear(
            period=f"{2022 + i}-12-31",
            revenue=r,
            growth=None,
            ebit=r * 0.2,
            margin=0.2,
            tax_rate=0.25,
            da=r * 0.04,
            capex=r * 0.06,
            delta_nwc=extra.get("dnwc", r * 0.01),
            fcff=None,
        )
        for i, r in enumerate(revenues)
    ]


def test_defaults_prefer_consensus_growth_and_say_so():
    a, src = valuation.default_assumptions(
        history([100, 110, 121, 133.1]), (0.07, 22), 0.035, 1.2, 3, 100
    )
    assert a.revenue_growth_start == 0.07
    assert "22 analysts" in src["revenue_growth_start"]
    assert a.cost_of_debt == pytest.approx(0.035)  # 3% interest / debt floored at rf
    assert a.da_pct_revenue == pytest.approx(0.04) and a.capex_pct_revenue == pytest.approx(0.06)


def test_defaults_fall_back_to_historical_cagr():
    a, src = valuation.default_assumptions(
        history([100, 110, 121, 133.1]), None, 0.04, None, None, 0
    )
    assert a.revenue_growth_start == pytest.approx(0.10)
    assert src["revenue_growth_start"] == "3Y revenue CAGR"
    assert a.beta == 1.0 and a.cost_of_debt == pytest.approx(0.055)
    assert a.terminal_growth == pytest.approx(0.025)


def test_banks_are_flagged_as_financials():
    assert valuation.is_financial("Financial Services", "Banks - Regional")
    assert not valuation.is_financial("Consumer Cyclical", "Auto Manufacturers")


def test_peer_median_ignores_negative_multiples_and_missing_values():
    rows = [
        valuation.CompRow(symbol="A", name="A", is_target=False, trailing_pe=10, gross_margin=0.2),
        valuation.CompRow(symbol="B", name="B", is_target=False, trailing_pe=-5, gross_margin=0.4),
        valuation.CompRow(symbol="C", name="C", is_target=False, trailing_pe=30, gross_margin=None),
    ]
    m = valuation.median_of(rows)
    assert m["trailing_pe"] == 20
    assert m["gross_margin"] == pytest.approx(0.3)
    assert m["beta"] is None


def test_annual_dividends_and_growth_skip_the_current_partial_year():
    pays = [
        research.Payment(date=d, amount=a)
        for d, a in [("2024-04-22", 2.0), ("2025-04-22", 2.5), ("2026-04-20", 1.0)]
    ]
    out = research.annual_totals(pays, current_year=2026)
    assert [(a.year, a.total) for a in out] == [(2024, 2.0), (2025, 2.5), (2026, 1.0)]
    assert out[1].growth == pytest.approx(0.25)
    assert out[2].growth is None


def test_spot_handles_minor_currency_units(monkeypatch):
    monkeypatch.setattr(
        fx, "_latest", lambda b, q: type("E", (), {"data": fx.FxPoint(date="d", rate=1.25)})()
    )
    assert fx.spot("USD", "USD") == 1.0
    assert fx.spot("GBp", "USD") == pytest.approx(0.0125)  # 1 penny = 1/100 GBP
    assert fx.spot("EUR", "GBp") == pytest.approx(125.0)


def test_industry_peers_drop_unweighted_members_and_the_target():
    import pandas as pd

    top = pd.DataFrame(
        {"market weight": [0.91, 0.05, 0.0003, float("nan"), 0.02]},
        index=["TSLA", "GM", "WCHS", "CYD", "RACE"],
    )
    assert research.peers_from_top(top, {"RACE"}) == ["TSLA", "GM"]
