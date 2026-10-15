"""Bond and curve maths, cross-checked against QuantLib (the reference implementation)."""

import itertools
import math
from datetime import date

import numpy as np
import pytest

from tessera import bonds, curves

ql = pytest.importorskip("QuantLib")

DC = {
    "ACT/ACT": ql.ActualActual(ql.ActualActual.ISMA),
    "30/360": ql.Thirty360(ql.Thirty360.BondBasis),
}


def ql_date(d: date):
    return ql.Date(d.day, d.month, d.year)


def ql_bond(spec: bonds.BondSpec, settlement: date):
    ql.Settings.instance().evaluationDate = ql_date(settlement)
    tenor = ql.Period(
        {1: ql.Annual, 2: ql.Semiannual, 4: ql.Quarterly, 12: ql.Monthly}[spec.frequency]
    )
    start = bonds.add_months(spec.maturity, -12 * 40)  # long before settlement
    schedule = ql.Schedule(
        ql_date(start), ql_date(spec.maturity), tenor, ql.NullCalendar(),
        ql.Unadjusted, ql.Unadjusted, ql.DateGeneration.Backward, spec.maturity.day >= 28,
    )  # fmt: skip
    dc = DC[spec.day_count]
    if spec.day_count == "ACT/ACT":
        dc = ql.ActualActual(ql.ActualActual.ISMA, schedule)
    bond = ql.FixedRateBond(0, spec.face, schedule, [spec.coupon], dc)
    rate = lambda y: ql.InterestRate(y, dc, ql.Compounded, tenor.frequency())  # noqa: E731
    return bond, rate


CASES = [
    (bonds.BondSpec(0.0425, date(2036, 8, 15), 2, "ACT/ACT"), date(2026, 10, 15), 0.0461),
    (bonds.BondSpec(0.0300, date(2031, 11, 30), 2, "ACT/ACT"), date(2026, 10, 15), 0.0350),
    (bonds.BondSpec(0.0550, date(2030, 3, 1), 2, "30/360"), date(2026, 10, 15), 0.0620),
    (bonds.BondSpec(0.0200, date(2035, 6, 1), 1, "ACT/ACT"), date(2026, 10, 15), 0.0335),
    (bonds.BondSpec(0.0700, date(2029, 1, 31), 4, "ACT/ACT"), date(2026, 10, 15), 0.0500),
    (bonds.BondSpec(0.0000, date(2028, 5, 15), 2, "ACT/ACT"), date(2026, 10, 15), 0.0400),
]


@pytest.mark.parametrize(("spec", "settle", "y"), CASES)
def test_prices_and_accrued_match_quantlib(spec, settle, y):
    bond, rate = ql_bond(spec, settle)
    assert bonds.accrued(spec, settle) == pytest.approx(
        bond.accruedAmount(ql_date(settle)), abs=1e-9
    )
    ql_clean = ql.BondFunctions.cleanPrice(bond, rate(y), ql_date(settle))
    assert bonds.clean_price(spec, settle, y) == pytest.approx(ql_clean, abs=1e-8)


@pytest.mark.parametrize(("spec", "settle", "y"), CASES)
def test_yield_round_trips(spec, settle, y):
    clean = bonds.clean_price(spec, settle, y)
    assert bonds.yield_from_clean(spec, settle, clean) == pytest.approx(y, abs=1e-10)


@pytest.mark.parametrize(("spec", "settle", "y"), CASES)
def test_duration_and_convexity_match_quantlib(spec, settle, y):
    bond, rate = ql_bond(spec, settle)
    r = bonds.risk(spec, settle, y)
    d = ql_date(settle)
    assert r.modified == pytest.approx(
        ql.BondFunctions.duration(bond, rate(y), ql.Duration.Modified, d), rel=1e-6
    )
    assert r.macaulay == pytest.approx(
        ql.BondFunctions.duration(bond, rate(y), ql.Duration.Macaulay, d), rel=1e-6
    )
    assert r.convexity == pytest.approx(ql.BondFunctions.convexity(bond, rate(y), d), rel=1e-6)


def test_dv01_approximates_a_one_basis_point_bump():
    spec, settle, y = CASES[0]
    bumped = bonds.dirty_price(spec, settle, y - 0.00005) - bonds.dirty_price(
        spec, settle, y + 0.00005
    )
    assert bonds.risk(spec, settle, y).dv01 == pytest.approx(bumped, rel=1e-6)


def test_end_of_month_schedules_stay_at_month_end():
    prev, dates = bonds.coupon_dates(bonds.BondSpec(0.03, date(2031, 11, 30)), date(2026, 10, 15))
    assert prev == date(2026, 5, 31)
    assert dates[:2] == [date(2026, 11, 30), date(2027, 5, 31)]


def test_z_spread_over_a_flat_curve_equals_the_continuous_yield_gap():
    spec, settle, _ = CASES[0]
    dirty = bonds.dirty_price(spec, settle, 0.05)
    s = bonds.z_spread(spec, settle, dirty, lambda t: 0.03)
    assert 0.015 < s < 0.025  # 5% semi-annual ≈ 4.94% continuous, ACT/365 vs coupon-period time
    assert bonds.z_spread(spec, settle, dirty, lambda t: 0.03 + s) == pytest.approx(0.0, abs=1e-10)


def test_bootstrapped_curve_reprices_par_bonds():
    tenors, par = [0.5, 1, 2, 5, 10, 30], [4.0, 4.2, 4.4, 4.6, 4.8, 5.0]
    grid, dfs = curves.bootstrap_par_semiannual(tenors, par)
    par_at = curves.interpolator(tenors, par)
    for n in (4, 10, 20, 60):  # 2y, 5y, 10y, 30y
        c = par_at(grid[n - 1]) / 100
        assert c / 2 * sum(dfs[:n]) + dfs[n - 1] == pytest.approx(1.0, abs=1e-12)


def test_flat_curve_has_equal_zero_and_forward_rates():
    out = curves.from_spot_continuous([1, 10, 30], [3.0, 3.0, 3.0])
    assert all(z == pytest.approx(3.0) for z in out.zero)
    assert all(f is None or f == pytest.approx(3.0) for f in out.forward_1y)
    assert out.par[out.years.index(10.0)] == pytest.approx((math.exp(0.03) - 1) * 100, rel=1e-9)


def test_monotone_cubic_removes_forward_jumps_at_quoted_tenors(monkeypatch):
    # A humped long end (20Y above 30Y), as in the U.S. Treasury curve.
    tenors, par = [0.5, 1, 2, 5, 10, 20, 30], [4.3, 4.5, 4.8, 5.0, 5.2, 5.6, 5.5]

    def max_step() -> float:
        fwd = [f for f in curves.from_par_semiannual(tenors, par).forward_1y if f is not None]
        return max(abs(b - a) for a, b in itertools.pairwise(fwd))

    smooth = max_step()
    monkeypatch.setattr(
        curves, "interpolator", lambda xs, ys: lambda x: float(np.interp(x, xs, ys))
    )
    linear = max_step()
    assert smooth < 0.3 and linear > 3 * smooth  # ≈0.25 vs ≈0.94 pp between half-years
