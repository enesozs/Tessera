"""Fixed-rate bond analytics on real dates (BOND) — pure math, no I/O.

Conventions follow the street (and QuantLib, which the tests use as the reference):

* Coupon dates roll back from maturity in steps of 12/f months (end-of-month preserved).
* Accrued interest = coupon per period × the accrual fraction of the current period under the
  bond's day count: ACT/ACT (ICMA: days elapsed / days in the period — U.S. Treasuries and
  most government bonds) or 30/360 (U.S. corporates). Money-market day counts (ACT/365F,
  ACT/360) size each coupon by its actual days, which this street-convention model does not
  do, so they are deliberately not offered.
* Yield is compounded f times a year. Dirty price for yield y:
      P = Σₖ CFₖ / (1 + y/f)^(k − 1 + w),   w = remaining fraction of the current period
  (ACT/ACT counts it in days, 30/360 in 30-day months).
* Clean price = dirty − accrued. Quotes are per 100 of face value.
* Macaulay duration (years) = Σ tₖ·PVₖ / P with tₖ = (k − 1 + w)/f; modified = Macaulay/(1 + y/f);
  convexity = Σ tₖ(tₖ + 1/f)·PVₖ / (P·(1 + y/f)²); DV01 = modified × dirty × 1bp.
"""

from __future__ import annotations

import calendar
import math
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Literal, cast

from scipy.optimize import brentq

DayCount = Literal["ACT/ACT", "30/360"]


@dataclass(frozen=True)
class BondSpec:
    coupon: float  # annual rate, fraction (0.0425)
    maturity: date
    frequency: int = 2
    day_count: DayCount = "ACT/ACT"
    face: float = 100.0

    def __post_init__(self) -> None:
        if self.frequency not in (1, 2, 4, 12):
            raise ValueError("frequency must be 1, 2, 4 or 12 payments a year")
        if not 0 <= self.coupon < 1:
            raise ValueError("coupon must be a fraction between 0 and 1")


def _root(f: Callable[[float], float], lo: float, hi: float) -> float:
    """Brent's method; SciPy's stubs type the result as possibly a tuple (full_output=True)."""
    return cast(float, brentq(f, lo, hi, xtol=1e-12))


def add_months(d: date, months: int) -> date:
    """Shift by whole months, keeping end-of-month dates at month end."""
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    last = calendar.monthrange(year, month)[1]
    eom = d.day == calendar.monthrange(d.year, d.month)[1]
    return date(year, month, last if eom else min(d.day, last))


def coupon_dates(spec: BondSpec, settlement: date) -> tuple[date, list[date]]:
    """(previous coupon date, coupon dates strictly after settlement up to maturity)."""
    if settlement >= spec.maturity:
        raise ValueError("settlement must be before maturity")
    step = 12 // spec.frequency
    dates = [spec.maturity]
    n = 1
    while True:
        d = add_months(spec.maturity, -step * n)
        if d <= settlement:
            return d, sorted(dates)
        dates.append(d)
        n += 1


def _d30_360(a: date, b: date) -> float:
    d1, d2 = min(a.day, 30), b.day
    if d1 == 30 and d2 == 31:
        d2 = 30
    return 360 * (b.year - a.year) + 30 * (b.month - a.month) + (d2 - d1)


def period_fraction(
    spec: BondSpec, start: date, end: date, period_start: date, period_end: date
) -> float:
    """Fraction of one coupon period between `start` and `end` under the bond's day count."""
    if spec.day_count == "ACT/ACT":
        return (end - start).days / (period_end - period_start).days
    return _d30_360(start, end) / (360 / spec.frequency)


@dataclass(frozen=True)
class Position:
    previous: date
    flows: list[tuple[date, float, float]]  # (date, coupon, principal)
    accrued_fraction: float  # of the current period
    w: float  # fraction of the current period still to run


def position(spec: BondSpec, settlement: date) -> Position:
    previous, dates = coupon_dates(spec, settlement)
    nxt = dates[0]
    elapsed = period_fraction(spec, previous, settlement, previous, nxt)
    per = spec.face * spec.coupon / spec.frequency
    flows = [(d, per, spec.face if d == spec.maturity else 0.0) for d in dates]
    return Position(previous, flows, elapsed, 1.0 - elapsed)


def accrued(spec: BondSpec, settlement: date) -> float:
    p = position(spec, settlement)
    return spec.face * spec.coupon / spec.frequency * p.accrued_fraction


def _terms(spec: BondSpec, p: Position, y: float) -> list[tuple[float, float]]:
    """(t in years, present value) for each remaining cash flow at yield y."""
    f = spec.frequency
    out = []
    for k, (_, cpn, principal) in enumerate(p.flows):
        periods = k + p.w
        out.append((periods / f, (cpn + principal) / (1 + y / f) ** periods))
    return out


def dirty_price(spec: BondSpec, settlement: date, y: float) -> float:
    return sum(pv for _, pv in _terms(spec, position(spec, settlement), y))


def clean_price(spec: BondSpec, settlement: date, y: float) -> float:
    return dirty_price(spec, settlement, y) - accrued(spec, settlement)


def yield_from_clean(spec: BondSpec, settlement: date, clean: float) -> float:
    target = clean + accrued(spec, settlement)
    try:
        return _root(lambda y: dirty_price(spec, settlement, y) - target, -0.2, 2.0)
    except ValueError as exc:
        raise ValueError(
            f"no yield between −20% and 200% reproduces a clean price of {clean}"
        ) from exc


@dataclass(frozen=True)
class Risk:
    macaulay: float
    modified: float
    convexity: float
    dv01: float  # price change per 1bp, per 100 face (positive)


def risk(spec: BondSpec, settlement: date, y: float) -> Risk:
    f = spec.frequency
    terms = _terms(spec, position(spec, settlement), y)
    price = sum(pv for _, pv in terms)
    mac = sum(t * pv for t, pv in terms) / price
    modified = mac / (1 + y / f)
    convexity = sum(t * (t + 1 / f) * pv for t, pv in terms) / (price * (1 + y / f) ** 2)
    return Risk(macaulay=mac, modified=modified, convexity=convexity, dv01=modified * price * 1e-4)


def z_spread(
    spec: BondSpec, settlement: date, dirty: float, zero_rate: Callable[[float], float]
) -> float:
    """Constant spread s over continuously compounded zero rates z(t) that reprices the bond:
    dirty = Σ CFₖ·exp(−(z(tₖ) + s)·tₖ), with tₖ in ACT/365F years from settlement."""
    p = position(spec, settlement)
    times = [((d - settlement).days / 365.0, c + pr) for d, c, pr in p.flows]

    def pv(s: float) -> float:
        return sum(cf * math.exp(-(zero_rate(t) + s) * t) for t, cf in times) - dirty

    return _root(pv, -0.5, 2.0)
