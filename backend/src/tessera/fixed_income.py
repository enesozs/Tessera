"""Fixed-income workflows: curve analytics for YC and the bond calculator (BOND)."""

from __future__ import annotations

from datetime import date
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from tessera import bonds, curves
from tessera.cache import cached
from tessera.errors import NotApplicableError
from tessera.models import Envelope, Provenance
from tessera.providers import rates

Region = Literal["US", "EA"]


@cached(ttl=1800)
def curve_analytics(
    region: Region, issuers: Literal["AAA", "ALL"] = "AAA"
) -> Envelope[curves.CurveAnalytics]:
    env = rates.us_curve() if region == "US" else rates.ea_curve(issuers)
    c = env.data
    latest = c.snapshots[0]
    data = (
        curves.from_par_semiannual(c.tenor_years, latest.yields)
        if region == "US"
        else curves.from_spot_continuous(c.tenor_years, latest.yields)
    )
    return Envelope(
        data=data,
        meta=env.meta.model_copy(update={"notes": [data.method + f", curve of {latest.date}."]}),
    )


class BondRequest(BaseModel):
    coupon: float = Field(ge=0, lt=1, description="Annual coupon, fraction")
    maturity: date
    frequency: Literal[1, 2, 4, 12] = 2
    day_count: bonds.DayCount = "ACT/ACT"
    quote: Literal["price", "yield"] = "price"
    value: float = Field(description="Clean price per 100, or yield as a fraction")
    curve: Region = "US"
    settlement: date | None = None


class CashFlow(BaseModel):
    date: date
    coupon: float
    principal: float
    t: float
    present_value: float


class Shock(BaseModel):
    bp: int
    clean: float
    change: float
    duration_estimate: float
    duration_convexity_estimate: float


class Benchmark(BaseModel):
    curve: str
    years: float
    par_yield: float | None  # fraction
    g_spread_bp: float | None
    z_spread_bp: float | None


class BondAnalysis(BaseModel):
    settlement: date
    previous_coupon: date
    next_coupon: date
    days_accrued: int
    accrued: float
    clean: float
    dirty: float
    ytm: float
    current_yield: float | None
    risk: dict[str, float]
    cash_flows: list[CashFlow]
    shocks: list[Shock]
    price_yield: list[tuple[float, float]]  # (yield, clean)
    benchmark: Benchmark


SHOCKS_BP = (-200, -100, -50, -25, 25, 50, 100, 200)


def analyze(req: BondRequest) -> Envelope[BondAnalysis]:
    settle = req.settlement or date.today()
    try:
        spec = bonds.BondSpec(req.coupon, req.maturity, req.frequency, req.day_count)
        if req.quote == "price":
            if req.value <= 0:
                raise ValueError("price must be positive")
            clean = req.value
            ytm = bonds.yield_from_clean(spec, settle, clean)
        else:
            ytm = req.value
            clean = bonds.clean_price(spec, settle, ytm)
        position = bonds.position(spec, settle)
    except ValueError as exc:
        raise NotApplicableError(str(exc)) from exc

    accrued = bonds.accrued(spec, settle)
    dirty = clean + accrued
    r = bonds.risk(spec, settle, ytm)
    f = req.frequency
    flows = [
        CashFlow(
            date=d,
            coupon=c,
            principal=p,
            t=(k + position.w) / f,
            present_value=(c + p) / (1 + ytm / f) ** (k + position.w),
        )
        for k, (d, c, p) in enumerate(position.flows)
    ]
    shocks = []
    for bp in SHOCKS_BP:
        dy = bp / 10_000
        new = bonds.clean_price(spec, settle, ytm + dy)
        shocks.append(
            Shock(
                bp=bp,
                clean=new,
                change=new - clean,
                duration_estimate=-r.modified * dirty * dy,
                duration_convexity_estimate=-r.modified * dirty * dy
                + 0.5 * r.convexity * dirty * dy * dy,
            )
        )
    grid = np.linspace(max(ytm - 0.03, -0.01), ytm + 0.03, 49)
    price_yield = [(float(y), bonds.clean_price(spec, settle, float(y))) for y in grid]

    analytics = curve_analytics(req.curve).data
    years = (req.maturity - settle).days / 365.25
    par = float(np.interp(years, analytics.years, analytics.par)) / 100
    zero_years, zero = analytics.years, [z / 100 for z in analytics.zero]

    def zero_rate(t: float) -> float:
        return float(np.interp(t, zero_years, zero))

    try:
        z = bonds.z_spread(spec, settle, dirty, zero_rate) * 10_000
    except ValueError:
        z = None
    label = "U.S. Treasury (bootstrapped)" if req.curve == "US" else "Euro-area AAA (ECB)"
    return Envelope(
        data=BondAnalysis(
            settlement=settle,
            previous_coupon=position.previous,
            next_coupon=position.flows[0][0],
            days_accrued=(settle - position.previous).days,
            accrued=accrued,
            clean=clean,
            dirty=dirty,
            ytm=ytm,
            current_yield=req.coupon * 100 / clean if clean else None,
            risk={
                "macaulay": r.macaulay,
                "modified": r.modified,
                "convexity": r.convexity,
                "dv01": r.dv01,
            },
            cash_flows=flows,
            shocks=shocks,
            price_yield=price_yield,
            benchmark=Benchmark(
                curve=label,
                years=years,
                par_yield=par,
                g_spread_bp=(ytm - par) * 10_000,
                z_spread_bp=z,
            ),
        ),
        meta=Provenance(
            source="Tessera bond model · " + label,
            freshness="end_of_day",
            notes=[
                f"Settlement {settle.isoformat()} (no settlement lag or holiday calendar). "
                "Street-convention yield; prices per 100 face.",
                "G-spread: yield minus the interpolated benchmark par yield. Z-spread: constant "
                "spread over continuously compounded zero rates that reprices the bond.",
            ],
        ),
    )
