"""Valuation workflows: DCF inputs/results (DCF) and peer comparison (COMP).

Inputs are assembled from the other providers; every default assumption records where it
came from so the UI can show "3Y average" or "consensus, 22 analysts" next to the number.
"""

from __future__ import annotations

import statistics
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from pydantic import BaseModel

from tessera import dcf
from tessera.cache import cached
from tessera.errors import NotApplicableError, NotFoundError
from tessera.models import Envelope, Provenance
from tessera.providers import fx, rates, research, yahoo

# ── DCF ───────────────────────────────────────────────────────────────────────


class HistoryYear(BaseModel):
    period: str
    revenue: float | None
    growth: float | None
    ebit: float | None
    margin: float | None
    tax_rate: float | None
    da: float | None
    capex: float | None
    delta_nwc: float | None
    fcff: float | None


class DcfInputs(BaseModel):
    symbol: str
    name: str
    currency: str  # quote currency of the share price
    financial_currency: str  # reporting currency of the statements
    fx_rate: float  # units of quote currency per one unit of reporting currency
    price: float
    base_period: str
    capital: dcf.CapitalStructure
    history: list[HistoryYear]
    defaults: dcf.DcfAssumptions
    sources: dict[str, str]


def _clamp(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def _mean(values: list[float | None]) -> float | None:
    vs = [v for v in values if v is not None]
    return sum(vs) / len(vs) if vs else None


def _getter(s: yahoo.Statements):
    rows = {r.key: r.values for r in s.rows}

    def get(key: str, i: int) -> float | None:
        values = rows.get(key)
        return values[i] if values and -len(values) <= i < len(values) else None

    return get, len(s.periods)


def build_history(inc: yahoo.Statements, cf: yahoo.Statements) -> list[HistoryYear]:
    gi, _ = _getter(inc)
    gc, _ = _getter(cf)
    cf_index = {p: i for i, p in enumerate(cf.periods)}
    out: list[HistoryYear] = []
    for i, period in enumerate(inc.periods):
        j = cf_index.get(period)
        revenue = gi("Total Revenue", i)
        prev = gi("Total Revenue", i - 1) if i > 0 else None
        ebit = gi("Operating Income", i)
        pretax, tax = gi("Pretax Income", i), gi("Tax Provision", i)
        tax_rate = tax / pretax if tax is not None and pretax and pretax > 0 else None
        da = gc("Depreciation And Amortization", j) if j is not None else None
        capex_raw = gc("Capital Expenditure", j) if j is not None else None
        ciwc = gc("Change In Working Capital", j) if j is not None else None
        capex = -capex_raw if capex_raw is not None else None
        dnwc = -ciwc if ciwc is not None else None
        fcff = None
        if None not in (ebit, da, capex, dnwc):
            fcff = ebit * (1 - (tax_rate or 0)) + da - capex - dnwc  # type: ignore[operator]
        out.append(
            HistoryYear(
                period=period,
                revenue=revenue,
                growth=revenue / prev - 1 if revenue and prev else None,
                ebit=ebit,
                margin=ebit / revenue if ebit is not None and revenue else None,
                tax_rate=tax_rate,
                da=da,
                capex=capex,
                delta_nwc=dnwc,
                fcff=fcff,
            )
        )
    return [h for h in out if h.revenue]  # Yahoo pads old periods with empty columns


def default_assumptions(
    history: list[HistoryYear],
    consensus_growth: tuple[float, int | None] | None,
    risk_free: float,
    beta: float | None,
    interest_expense: float | None,
    total_debt: float,
) -> tuple[dcf.DcfAssumptions, dict[str, str]]:
    """Derive defaults from the last three fiscal years, each with a stated source."""
    last3 = history[-3:]
    sources: dict[str, str] = {}

    if consensus_growth is not None:
        growth, analysts = consensus_growth
        sources["revenue_growth_start"] = (
            f"Consensus current-year estimate ({analysts or '?'} analysts)"
        )
    else:
        first, last = history[max(0, len(history) - 4)], history[-1]
        years = len(history[max(0, len(history) - 4) :]) - 1
        if years >= 1 and first.revenue and last.revenue and first.revenue > 0:
            growth = (last.revenue / first.revenue) ** (1 / years) - 1
            sources["revenue_growth_start"] = f"{years}Y revenue CAGR"
        else:
            growth = 0.04
            sources["revenue_growth_start"] = "Fallback (no usable history)"
    growth = _clamp(growth, -0.2, 0.4)

    margin = history[-1].margin if history[-1].margin is not None else 0.1
    sources["ebit_margin_start"] = f"FY{history[-1].period[:4]} operating margin"
    sources["ebit_margin_target"] = "Held at the latest margin"

    tax = _mean([h.tax_rate for h in last3])
    sources["tax_rate"] = "3Y average effective rate" if tax is not None else "Fallback 25%"
    tax = _clamp(tax if tax is not None else 0.25, 0.0, 0.4)

    def ratio(attr: str) -> float | None:
        return _mean(
            [
                getattr(h, attr) / h.revenue if getattr(h, attr) is not None and h.revenue else None
                for h in last3
            ]
        )

    da = ratio("da")
    capex = ratio("capex")
    sources["da_pct_revenue"] = "3Y average D&A / revenue" if da is not None else "Fallback 4%"
    sources["capex_pct_revenue"] = (
        "3Y average capex / revenue" if capex is not None else "Fallback 5%"
    )

    dnwc_sum = sum(h.delta_nwc for h in last3 if h.delta_nwc is not None)
    drev = [
        b.revenue - a.revenue
        for a, b in zip(history[-4:], history[-3:], strict=False)
        if a.revenue and b.revenue
    ]
    # The ratio is only meaningful when revenue grew noticeably; bounded because ΔNWC is noisy.
    if len(drev) >= 2 and sum(drev) > 0.05 * (history[-1].revenue or 0):
        nwc = _clamp(dnwc_sum / sum(drev), -0.2, 0.3)
        sources["nwc_pct_delta_revenue"] = "3Y ΔNWC / Δrevenue"
    else:
        nwc = 0.1
        sources["nwc_pct_delta_revenue"] = "Fallback 10%"

    b = _clamp(beta, 0.3, 3.0) if beta is not None else 1.0
    sources["beta"] = "Yahoo 5Y monthly beta" if beta is not None else "Fallback 1.0"
    sources["risk_free"] = "10Y government yield (see footer)"
    sources["equity_risk_premium"] = "Assumption (typical range 4–6%)"

    if interest_expense and total_debt > 0:
        kd = _clamp(interest_expense / total_debt, risk_free, risk_free + 0.08)
        sources["cost_of_debt"] = "Interest expense / total debt (bounded below by rf)"
    else:
        kd = risk_free + 0.015
        sources["cost_of_debt"] = "Risk-free + 1.5%"
    sources["terminal_growth"] = "Assumption (≈ long-run nominal GDP, capped at rf)"

    assumptions = dcf.DcfAssumptions(
        years=5,
        revenue_growth_start=round(growth, 4),
        terminal_growth=round(min(0.025, risk_free), 4),
        ebit_margin_start=round(margin, 4),
        ebit_margin_target=round(margin, 4),
        tax_rate=round(tax, 4),
        da_pct_revenue=round(_clamp(da if da is not None else 0.04, 0, 0.5), 4),
        capex_pct_revenue=round(_clamp(capex if capex is not None else 0.05, 0, 0.6), 4),
        nwc_pct_delta_revenue=round(nwc, 4),
        risk_free=round(risk_free, 4),
        equity_risk_premium=0.05,
        beta=round(b, 3),
        cost_of_debt=round(kd, 4),
        mid_year=True,
    )
    return assumptions, sources


def is_financial(sector: str | None, industry: str | None) -> bool:
    text = f"{sector or ''} {industry or ''}".lower()
    return "financial" in text and any(
        k in text for k in ("bank", "insurance", "capital markets", "credit")
    )


def _risk_free(financial_currency: str) -> tuple[float, str]:
    """10-year government yield in the reporting currency (as a fraction) and its label."""
    if financial_currency == "EUR":
        curve = rates.ea_curve("AAA").data
        label = "Euro-area AAA 10Y spot (ECB)"
    else:
        curve = rates.us_curve().data
        label = "U.S. Treasury 10Y par yield"
        if financial_currency != "USD":
            label += f" — no {financial_currency} curve available, used as a proxy"
    latest = curve.snapshots[0]
    value = latest.yields[curve.tenors.index("10Y")]
    if value is None:
        raise NotFoundError("10-year yield unavailable")
    return value / 100, f"{label}, {latest.date}"


@cached(ttl=1800)
def dcf_inputs(symbol: str) -> Envelope[DcfInputs]:
    prof_env = yahoo.profile(symbol)
    p = prof_env.data
    if p.quote_type not in ("EQUITY", None):
        raise NotApplicableError(f"DCF applies to operating companies, not {p.quote_type}")
    if is_financial(p.sector, p.industry):
        raise NotApplicableError(
            f"An FCFF DCF is not meaningful for {p.industry or 'financial companies'}: debt is "
            "their raw material, not financing. Value them on P/B vs ROE or dividends (COMP, DVD)."
        )
    inc = yahoo.financials(symbol, "income", "annual").data
    bal = yahoo.financials(symbol, "balance", "annual").data
    cf = yahoo.financials(symbol, "cashflow", "annual").data
    history = build_history(inc, cf)
    if not history:
        raise NotFoundError(f"No annual revenue history for '{symbol}'")

    fin_ccy = inc.currency or p.financial_currency or p.currency or "USD"
    quote_ccy = p.currency or fin_ccy
    fx_rate = fx.spot(fin_ccy, quote_ccy)
    gb, _ = _getter(bal)
    gi, _ = _getter(inc)
    price = p.price or 0.0
    shares = p.shares_outstanding or gb("Ordinary Shares Number", -1) or 0.0
    total_debt = gb("Total Debt", -1) or 0.0
    cash = (gb("Cash And Cash Equivalents", -1) or 0.0) + (
        gb("Other Short Term Investments", -1) or 0.0
    )
    capital = dcf.CapitalStructure(
        base_revenue=history[-1].revenue or 0.0,
        market_cap=price * shares / fx_rate,
        total_debt=total_debt,
        cash=cash,
        minority_interest=gb("Minority Interest", -1) or 0.0,
        shares=shares,
    )

    consensus = None
    try:
        for e in research.earnings(symbol).data.revenue_estimates:
            if e.period == "0y" and e.growth is not None:
                consensus = (e.growth, e.analysts)
    except Exception:  # estimates are optional
        consensus = None

    rf, rf_label = _risk_free(fin_ccy)
    defaults, sources = default_assumptions(
        history, consensus, rf, p.beta, gi("Interest Expense", -1), total_debt
    )
    sources["risk_free"] = rf_label
    notes = [
        f"Statements in {fin_ccy}; share price in {quote_ccy}"
        + (f" (converted at {fx_rate:.4f}, ECB reference rate)." if fin_ccy != quote_ccy else "."),
        "Debt, cash and minority interest from the latest annual balance sheet.",
    ]
    return Envelope(
        data=DcfInputs(
            symbol=symbol,
            name=p.name,
            currency=quote_ccy,
            financial_currency=fin_ccy,
            fx_rate=fx_rate,
            price=price,
            base_period=history[-1].period,
            capital=capital,
            history=history,
            defaults=defaults,
            sources=sources,
        ),
        meta=Provenance(
            source="Tessera model on Yahoo Finance statements, Treasury/ECB rates",
            source_url=f"https://finance.yahoo.com/quote/{symbol}/financials",
            freshness="filing",
            as_of=prof_env.meta.as_of,
            notes=notes,
        ),
    )


class DcfResult(BaseModel):
    symbol: str
    currency: str
    financial_currency: str
    fx_rate: float
    price: float
    valuation: dcf.DcfValuation
    per_share_quote: float  # in the share price's currency
    upside: float | None
    sensitivity: dcf.Sensitivity  # per share, quote currency


def dcf_value(symbol: str, assumptions: dcf.DcfAssumptions) -> Envelope[DcfResult]:
    inputs = dcf_inputs(symbol)
    i = inputs.data
    try:
        v = dcf.value(assumptions, i.capital)
        sens = dcf.sensitivity(assumptions, i.capital, v.wacc.wacc)
    except dcf.DcfError as exc:
        raise NotApplicableError(str(exc)) from exc
    sens.per_share = [
        [x * i.fx_rate if x is not None else None for x in row] for row in sens.per_share
    ]
    per_share = v.per_share * i.fx_rate
    return Envelope(
        data=DcfResult(
            symbol=symbol,
            currency=i.currency,
            financial_currency=i.financial_currency,
            fx_rate=i.fx_rate,
            price=i.price,
            valuation=v,
            per_share_quote=per_share,
            upside=per_share / i.price - 1 if i.price else None,
            sensitivity=sens,
        ),
        meta=inputs.meta,
    )


# ── Peer comparison ───────────────────────────────────────────────────────────

COMP_METRICS = [
    "market_cap_usd",
    "trailing_pe",
    "forward_pe",
    "ev_to_ebitda",
    "ev_to_revenue",
    "price_to_book",
    "dividend_yield",
    "gross_margin",
    "operating_margin",
    "profit_margin",
    "return_on_equity",
    "revenue_growth",
    "beta",
]


class CompRow(BaseModel):
    symbol: str
    name: str
    is_target: bool
    country: str | None = None
    currency: str | None = None
    price: float | None = None
    market_cap_usd: float | None = None
    trailing_pe: float | None = None
    forward_pe: float | None = None
    ev_to_ebitda: float | None = None
    ev_to_revenue: float | None = None
    price_to_book: float | None = None
    dividend_yield: float | None = None
    gross_margin: float | None = None
    operating_margin: float | None = None
    profit_margin: float | None = None
    return_on_equity: float | None = None
    revenue_growth: float | None = None
    beta: float | None = None
    error: str | None = None


class Comps(BaseModel):
    symbol: str
    industry: str | None
    peers_source: Literal["industry", "user"]
    rows: list[CompRow]
    median: dict[str, float | None]  # of peers, excluding the target


def _comp_row(symbol: str, is_target: bool) -> CompRow:
    try:
        p = yahoo.profile(symbol).data
    except Exception as exc:
        return CompRow(symbol=symbol, name=symbol, is_target=is_target, error=str(exc))
    cap_usd = None
    if p.price and p.shares_outstanding and p.currency:
        try:
            cap_usd = p.price * p.shares_outstanding * fx.spot(p.currency, "USD")
        except Exception:
            cap_usd = None
    return CompRow(
        symbol=symbol,
        name=p.name,
        is_target=is_target,
        country=p.country,
        currency=p.currency,
        price=p.price,
        market_cap_usd=cap_usd,
        **{k: getattr(p, k) for k in COMP_METRICS if k not in ("market_cap_usd",)},
    )


def median_of(rows: list[CompRow]) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for metric in COMP_METRICS:
        values = [v for r in rows if (v := getattr(r, metric)) is not None]
        # Negative P/E or EV/EBITDA multiples are meaningless; exclude them from the median.
        if metric in (
            "trailing_pe",
            "forward_pe",
            "ev_to_ebitda",
            "ev_to_revenue",
            "price_to_book",
        ):
            values = [v for v in values if v > 0]
        out[metric] = statistics.median(values) if values else None
    return out


def comps(symbol: str, peers: tuple[str, ...] = ()) -> Envelope[Comps]:
    industry = None
    source: Literal["industry", "user"] = "user"
    if not peers:
        found = research.industry_peers(symbol).data
        peers, industry, source = tuple(found.peers), found.industry, "industry"
    symbols = [symbol, *[s for s in peers if s != symbol]][:13]
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(lambda s: _comp_row(s, s == symbol), symbols))
    target = rows[0]
    if target.error:
        raise NotFoundError(target.error)
    return Envelope(
        data=Comps(
            symbol=symbol,
            industry=industry or yahoo.profile(symbol).data.industry,
            peers_source=source,
            rows=rows,
            median=median_of([r for r in rows[1:] if not r.error]),
        ),
        meta=Provenance(
            source=yahoo.SOURCE,
            source_url=f"https://finance.yahoo.com/quote/{symbol}/key-statistics",
            freshness="delayed",
            notes=[
                "Trailing multiples and margins as computed by Yahoo; market caps converted to "
                "USD at ECB reference rates. Medians exclude the target and negative multiples."
            ],
        ),
    )
