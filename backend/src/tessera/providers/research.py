"""Yahoo research data: industry peers, analyst estimates and earnings, dividends, movers.

Same caveats as `yahoo.py`: unofficial API, personal/educational use. Estimates are the
consensus Yahoo aggregates from contributing analysts, not our own forecasts.
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime
from typing import Any, Literal

import pandas as pd
import yfinance as yf
from pydantic import BaseModel

from tessera.cache import cached
from tessera.errors import NotFoundError, UpstreamError
from tessera.models import Envelope, Provenance
from tessera.providers.yahoo import SOURCE, _num, _stamp, profile


def _date(value: Any) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, datetime | date):
        return value.isoformat()[:10]
    try:
        return _stamp(value).strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return None


# ── Peers (COMP) ──────────────────────────────────────────────────────────────


class Peers(BaseModel):
    symbol: str
    industry: str | None
    peers: list[str]


def peers_from_top(
    top: pd.DataFrame | None, exclude: set[str], min_weight: float = 0.001
) -> list[str]:
    """Industry members with a real index weight (drops shells and micro-caps Yahoo lists)."""
    if top is None or top.empty:
        return []
    weights = top["market weight"] if "market weight" in top else pd.Series(dtype=float)
    return [
        str(s)
        for s, w in weights.items()
        if str(s).upper() not in exclude and (v := _num(w)) is not None and v >= min_weight
    ]


@cached(ttl=24 * 3600)
def industry_peers(symbol: str, limit: int = 6) -> Envelope[Peers]:
    """Largest companies in the security's Yahoo industry (US listings only)."""
    p = profile(symbol).data
    if not p.industry_key:
        raise NotFoundError(f"Yahoo has no industry classification for '{symbol}'")
    try:
        top = yf.Industry(p.industry_key).top_companies
    except Exception as exc:
        raise UpstreamError(f"Yahoo industry lookup failed: {exc}") from exc
    own = {symbol.upper(), symbol.upper().split(".")[0]}
    symbols = peers_from_top(top, own)
    return Envelope(
        data=Peers(symbol=symbol, industry=p.industry, peers=symbols[:limit]),
        meta=Provenance(
            source=SOURCE,
            source_url=f"https://finance.yahoo.com/sectors/{p.industry_key}",
            freshness="delayed",
            notes=["Default peers are the largest U.S.-listed companies in Yahoo's industry."],
        ),
    )


# ── Earnings & estimates (ERN) ────────────────────────────────────────────────


class EarningsEvent(BaseModel):
    date: str
    eps_estimate: float | None
    eps_actual: float | None
    surprise_pct: float | None  # fraction


class Estimate(BaseModel):
    period: str  # 0q current quarter, +1q next quarter, 0y current year, +1y next year
    avg: float | None
    low: float | None
    high: float | None
    analysts: int | None
    year_ago: float | None
    growth: float | None


class EpsRevision(BaseModel):
    period: str
    current: float | None
    days_7: float | None
    days_30: float | None
    days_60: float | None
    days_90: float | None


class Earnings(BaseModel):
    symbol: str
    currency: str | None
    next_date: str | None
    history: list[EarningsEvent]
    revenue_estimates: list[Estimate]
    eps_estimates: list[Estimate]
    eps_revisions: list[EpsRevision]


PERIOD_ORDER = ["0q", "+1q", "0y", "+1y"]


def _estimates(frame: pd.DataFrame | None) -> list[Estimate]:
    if frame is None or frame.empty:
        return []
    rows: dict[Any, dict[str, Any]] = frame.to_dict("index")
    out = []
    for period in PERIOD_ORDER:
        r = rows.get(period)
        if r is None:
            continue
        analysts = _num(r.get("numberOfAnalysts"))
        out.append(
            Estimate(
                period=period,
                avg=_num(r.get("avg")),
                low=_num(r.get("low")),
                high=_num(r.get("high")),
                analysts=int(analysts) if analysts is not None else None,
                year_ago=_num(r.get("yearAgoRevenue", r.get("yearAgoEps"))),
                growth=_num(r.get("growth")),
            )
        )
    return out


@cached(ttl=6 * 3600)
def earnings(symbol: str) -> Envelope[Earnings]:
    try:
        t = yf.Ticker(symbol)
        dates = t.get_earnings_dates(limit=16)
        revenue = t.revenue_estimate
        eps = t.earnings_estimate
        trend = t.eps_trend
    except Exception as exc:
        raise UpstreamError(f"Yahoo earnings data failed for {symbol}: {exc}") from exc

    history: list[EarningsEvent] = []
    if dates is not None and not dates.empty:
        records: dict[Any, dict[str, Any]] = dates.to_dict("index")
        for stamp, r in records.items():
            surprise = _num(r.get("Surprise(%)"))
            history.append(
                EarningsEvent(
                    date=_stamp(stamp).strftime("%Y-%m-%d"),
                    eps_estimate=_num(r.get("EPS Estimate")),
                    eps_actual=_num(r.get("Reported EPS")),
                    surprise_pct=surprise / 100 if surprise is not None else None,
                )
            )
    history.sort(key=lambda e: e.date)
    today = date.today().isoformat()
    upcoming = [e.date for e in history if e.date >= today and e.eps_actual is None]

    revisions: list[EpsRevision] = []
    currency = None
    if trend is not None and not trend.empty:
        trows: dict[Any, dict[str, Any]] = trend.to_dict("index")
        for period in PERIOD_ORDER:
            r = trows.get(period)
            if r is None:
                continue
            currency = currency or r.get("currency")
            revisions.append(
                EpsRevision(
                    period=period,
                    current=_num(r.get("current")),
                    days_7=_num(r.get("7daysAgo")),
                    days_30=_num(r.get("30daysAgo")),
                    days_60=_num(r.get("60daysAgo")),
                    days_90=_num(r.get("90daysAgo")),
                )
            )
    if not history and not revisions:
        raise NotFoundError(f"No earnings data for '{symbol}'")
    data = Earnings(
        symbol=symbol,
        currency=currency,
        next_date=upcoming[0] if upcoming else None,
        history=history,
        revenue_estimates=_estimates(revenue),
        eps_estimates=_estimates(eps),
        eps_revisions=revisions,
    )
    reported = [e.date for e in history if e.eps_actual is not None]
    return Envelope(
        data=data,
        meta=Provenance(
            source=SOURCE,
            source_url=f"https://finance.yahoo.com/quote/{symbol}/analysis",
            freshness="periodic",
            as_of=datetime.fromisoformat(reported[-1]).replace(tzinfo=UTC) if reported else None,
            notes=[
                "Consensus estimates aggregated by Yahoo; EPS on the company's reporting basis."
            ],
        ),
    )


# ── Dividends (DVD) ───────────────────────────────────────────────────────────


class Payment(BaseModel):
    date: str  # ex-dividend date
    amount: float


class AnnualDividend(BaseModel):
    year: int
    total: float
    payments: int
    growth: float | None


class Split(BaseModel):
    date: str
    ratio: float


class Dividends(BaseModel):
    symbol: str
    currency: str | None
    payments: list[Payment]
    annual: list[AnnualDividend]
    splits: list[Split]
    next_ex_date: str | None
    next_pay_date: str | None
    trailing_12m: float | None


def annual_totals(payments: list[Payment], current_year: int) -> list[AnnualDividend]:
    """Sum payments by calendar year; the current (incomplete) year is excluded from growth."""
    by_year: dict[int, list[float]] = {}
    for p in payments:
        by_year.setdefault(int(p.date[:4]), []).append(p.amount)
    out: list[AnnualDividend] = []
    for year in sorted(by_year):
        total = sum(by_year[year])
        prev = out[-1] if out and out[-1].year == year - 1 else None
        growth = total / prev.total - 1 if prev and prev.total and year < current_year else None
        out.append(
            AnnualDividend(year=year, total=total, payments=len(by_year[year]), growth=growth)
        )
    return out


@cached(ttl=6 * 3600)
def dividends(symbol: str) -> Envelope[Dividends]:
    try:
        t = yf.Ticker(symbol)
        divs = t.dividends
        splits = t.splits
        calendar = t.calendar or {}
        currency = (t.history_metadata or {}).get("currency") or (t.info or {}).get("currency")
    except Exception as exc:
        raise UpstreamError(f"Yahoo dividend data failed for {symbol}: {exc}") from exc
    payments = [
        Payment(date=_stamp(d).strftime("%Y-%m-%d"), amount=v)
        for d, raw in divs.items()
        if (v := _num(raw)) is not None and v > 0
    ]
    split_list = [
        Split(date=_stamp(d).strftime("%Y-%m-%d"), ratio=v)
        for d, raw in splits.items()
        if (v := _num(raw)) is not None and v > 0
    ]
    if not payments and not split_list:
        raise NotFoundError(f"'{symbol}' has no dividend or split history on Yahoo")
    today = date.today()
    cutoff = today.replace(year=today.year - 1).isoformat()
    ex = _date(calendar.get("Ex-Dividend Date"))
    pay = _date(calendar.get("Dividend Date"))
    data = Dividends(
        symbol=symbol,
        currency=currency,
        payments=payments,
        annual=annual_totals(payments, today.year),
        splits=split_list,
        next_ex_date=ex if ex and ex >= today.isoformat() else None,
        next_pay_date=pay if pay and pay >= today.isoformat() else None,
        trailing_12m=sum(p.amount for p in payments if p.date > cutoff) or None,
    )
    return Envelope(
        data=data,
        meta=Provenance(
            source=SOURCE,
            source_url=f"https://finance.yahoo.com/quote/{symbol}/history?filter=div",
            freshness="end_of_day",
            as_of=datetime.fromisoformat(payments[-1].date).replace(tzinfo=UTC)
            if payments
            else None,
            notes=["Cash amounts per share by ex-dividend date, adjusted for later splits."],
        ),
    )


# ── Movers (MOST) ─────────────────────────────────────────────────────────────

MoverKind = Literal["gainers", "losers", "actives"]
SCREENS = {"gainers": "day_gainers", "losers": "day_losers", "actives": "most_actives"}


class Mover(BaseModel):
    symbol: str
    name: str
    exchange: str | None
    currency: str | None
    price: float | None
    change_pct: float | None  # fraction
    volume: float | None
    avg_volume_3m: float | None
    market_cap: float | None


@cached(ttl=120)
def movers(kind: MoverKind) -> Envelope[list[Mover]]:
    try:
        result = yf.screen(SCREENS[kind], count=50)
    except Exception as exc:
        raise UpstreamError(f"Yahoo screener failed: {exc}") from exc
    quotes = (result or {}).get("quotes", [])
    rows = []
    for q in quotes:
        pct = _num(q.get("regularMarketChangePercent"))
        rows.append(
            Mover(
                symbol=q["symbol"],
                name=q.get("shortName") or q.get("longName") or q["symbol"],
                exchange=q.get("fullExchangeName") or q.get("exchange"),
                currency=q.get("currency"),
                price=_num(q.get("regularMarketPrice")),
                change_pct=pct / 100 if pct is not None else None,
                volume=_num(q.get("regularMarketVolume")),
                avg_volume_3m=_num(q.get("averageDailyVolume3Month")),
                market_cap=_num(q.get("marketCap")),
            )
        )
    stamps = [
        q.get("regularMarketTime") for q in quotes if isinstance(q.get("regularMarketTime"), int)
    ]
    return Envelope(
        data=rows,
        meta=Provenance(
            source=SOURCE,
            source_url="https://finance.yahoo.com/markets/stocks/gainers/",
            freshness="delayed",
            as_of=datetime.fromtimestamp(max(stamps), UTC) if stamps else None,
            notes=["Yahoo's predefined U.S. equity screens (liquid, mid-cap and above)."],
        ),
    )
