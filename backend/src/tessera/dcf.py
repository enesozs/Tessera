"""Discounted cash flow (FCFF) valuation — pure math, no I/O.

The model, in the order the UI presents it:

1. Revenue grows from `revenue_growth_start` in year 1, fading linearly to the terminal
   growth rate `g` by the final explicit year.
2. EBIT margin moves linearly from `ebit_margin_start` to `ebit_margin_target`.
3. Free cash flow to the firm:  FCFF = EBIT·(1−t) + D&A − Capex − ΔNWC
   with D&A and capex as % of revenue and ΔNWC as % of the revenue *increase*.
4. WACC = E/(D+E)·(rf + β·ERP) + D/(D+E)·kd·(1−t), weights at market value of equity and
   book value of debt (the usual practitioner shortcut).
5. Terminal value (Gordon growth) on year N+1's FCFF: TV = FCFF₍N+1₎ / (WACC − g).
6. Discounting uses the mid-year convention by default (cash arrives on average mid-year),
   so year t is discounted at t − ½ and the terminal value — a perpetuity of mid-year flows
   starting in year N+1 — at N − ½.
7. Equity = EV − debt + cash − minority interest; per share = equity / shares outstanding.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class DcfAssumptions(BaseModel):
    years: int = Field(5, ge=3, le=10)
    revenue_growth_start: float = Field(ge=-0.5, le=1.0)
    terminal_growth: float = Field(ge=-0.02, le=0.06)
    ebit_margin_start: float = Field(ge=-1.0, le=1.0)
    ebit_margin_target: float = Field(ge=-1.0, le=1.0)
    tax_rate: float = Field(ge=0.0, le=0.6)
    da_pct_revenue: float = Field(ge=0.0, le=0.5)
    capex_pct_revenue: float = Field(ge=0.0, le=0.6)
    nwc_pct_delta_revenue: float = Field(ge=-1.0, le=1.0)
    risk_free: float = Field(ge=-0.01, le=0.2)
    equity_risk_premium: float = Field(ge=0.0, le=0.15)
    beta: float = Field(ge=0.0, le=4.0)
    cost_of_debt: float = Field(ge=0.0, le=0.3, description="Pre-tax")
    mid_year: bool = True


class CapitalStructure(BaseModel):
    """Balance-sheet and market inputs, all in the company's reporting currency."""

    base_revenue: float
    market_cap: float
    total_debt: float
    cash: float
    minority_interest: float
    shares: float


class ProjectionYear(BaseModel):
    year: int
    revenue: float
    growth: float
    ebit: float
    margin: float
    taxes: float
    nopat: float
    da: float
    capex: float
    delta_nwc: float
    fcff: float
    discount_factor: float
    present_value: float


class Wacc(BaseModel):
    cost_of_equity: float
    cost_of_debt_after_tax: float
    weight_equity: float
    weight_debt: float
    wacc: float


class DcfValuation(BaseModel):
    wacc: Wacc
    projection: list[ProjectionYear]
    terminal_fcff: float
    terminal_value: float
    pv_terminal_value: float
    sum_pv_fcff: float
    enterprise_value: float
    equity_value: float
    per_share: float
    terminal_share_of_ev: float
    implied_exit_ev_ebitda: float | None


class DcfError(ValueError):
    pass


def compute_wacc(a: DcfAssumptions, cap: CapitalStructure) -> Wacc:
    equity = max(cap.market_cap, 0.0)
    debt = max(cap.total_debt, 0.0)
    total = equity + debt
    if total <= 0:
        raise DcfError("Market value of equity and debt are both zero")
    ke = a.risk_free + a.beta * a.equity_risk_premium
    kd = a.cost_of_debt * (1 - a.tax_rate)
    we, wd = equity / total, debt / total
    return Wacc(
        cost_of_equity=ke,
        cost_of_debt_after_tax=kd,
        weight_equity=we,
        weight_debt=wd,
        wacc=we * ke + wd * kd,
    )


def _path(start: float, end: float, n: int) -> list[float]:
    """Linear interpolation from start (year 1) to end (year n)."""
    if n == 1:
        return [start]
    return [start + (end - start) * i / (n - 1) for i in range(n)]


def _year(
    a: DcfAssumptions, year: int, prev_revenue: float, growth: float, margin: float
) -> tuple[float, float, float, float, float, float, float, float]:
    revenue = prev_revenue * (1 + growth)
    ebit = revenue * margin
    # No tax shield on losses: a simplification that keeps negative-EBIT years conservative.
    taxes = max(ebit, 0.0) * a.tax_rate
    nopat = ebit - taxes
    da = revenue * a.da_pct_revenue
    capex = revenue * a.capex_pct_revenue
    delta_nwc = (revenue - prev_revenue) * a.nwc_pct_delta_revenue
    fcff = nopat + da - capex - delta_nwc
    return revenue, ebit, taxes, nopat, da, capex, delta_nwc, fcff


def value(a: DcfAssumptions, cap: CapitalStructure, wacc: float | None = None) -> DcfValuation:
    if cap.base_revenue <= 0:
        raise DcfError("Base-year revenue must be positive for a revenue-driven DCF")
    if cap.shares <= 0:
        raise DcfError("Shares outstanding unknown")
    w = compute_wacc(a, cap)
    rate = w.wacc if wacc is None else wacc
    g = a.terminal_growth
    if rate - g < 0.005:
        raise DcfError(
            f"WACC ({rate:.2%}) must exceed terminal growth ({g:.2%}) by at least 0.5 pp"
        )

    n = a.years
    growths = _path(a.revenue_growth_start, g, n)
    margins = _path(a.ebit_margin_start, a.ebit_margin_target, n)
    shift = 0.5 if a.mid_year else 0.0

    rows: list[ProjectionYear] = []
    revenue = cap.base_revenue
    for t in range(1, n + 1):
        prev = revenue
        revenue, ebit, taxes, nopat, da, capex, dnwc, fcff = _year(
            a, t, prev, growths[t - 1], margins[t - 1]
        )
        factor = (1 + rate) ** -(t - shift)
        rows.append(
            ProjectionYear(
                year=t,
                revenue=revenue,
                growth=growths[t - 1],
                ebit=ebit,
                margin=margins[t - 1],
                taxes=taxes,
                nopat=nopat,
                da=da,
                capex=capex,
                delta_nwc=dnwc,
                fcff=fcff,
                discount_factor=factor,
                present_value=fcff * factor,
            )
        )

    *_, terminal_fcff = _year(a, n + 1, revenue, g, a.ebit_margin_target)
    terminal_value = terminal_fcff / (rate - g)
    pv_tv = terminal_value * (1 + rate) ** -(n - shift)
    sum_pv = sum(r.present_value for r in rows)
    ev = sum_pv + pv_tv
    equity = ev - cap.total_debt + cap.cash - cap.minority_interest
    last = rows[-1]
    ebitda_n = last.ebit + last.da
    return DcfValuation(
        wacc=w if wacc is None else w.model_copy(update={"wacc": rate}),
        projection=rows,
        terminal_fcff=terminal_fcff,
        terminal_value=terminal_value,
        pv_terminal_value=pv_tv,
        sum_pv_fcff=sum_pv,
        enterprise_value=ev,
        equity_value=equity,
        per_share=equity / cap.shares,
        terminal_share_of_ev=pv_tv / ev if ev else 0.0,
        implied_exit_ev_ebitda=terminal_value / ebitda_n if ebitda_n > 0 else None,
    )


class Sensitivity(BaseModel):
    waccs: list[float]
    growths: list[float]
    per_share: list[list[float | None]]  # [wacc index][growth index]


def sensitivity(
    a: DcfAssumptions, cap: CapitalStructure, base_wacc: float, step: float = 0.005, size: int = 2
) -> Sensitivity:
    """Per-share value over a grid of WACC × terminal growth around the base case."""
    offsets = [i * step for i in range(-size, size + 1)]
    waccs = [base_wacc + o for o in offsets]
    growths = [a.terminal_growth + o for o in offsets]
    grid: list[list[float | None]] = []
    for w in waccs:
        row: list[float | None] = []
        for g in growths:
            try:
                row.append(
                    value(a.model_copy(update={"terminal_growth": g}), cap, wacc=w).per_share
                )
            except DcfError:
                row.append(None)
        grid.append(row)
    return Sensitivity(waccs=waccs, growths=growths, per_share=grid)
