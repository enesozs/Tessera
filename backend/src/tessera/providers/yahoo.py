"""Yahoo Finance: equities, indices, futures — search, profile, prices, statements, news.

Yahoo is the only free source with broad international equity coverage, but it is an
unofficial API: fields come and go, and its terms allow personal/educational use only.
Everything here is labelled as delayed or end-of-day, and the statements are Yahoo's own
standardisation of company filings (not the filings themselves).
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from typing import Any, Literal, cast

import pandas as pd
import yfinance as yf
from pydantic import BaseModel

from tessera import http
from tessera.cache import cached
from tessera.errors import NotFoundError, UpstreamError
from tessera.models import Envelope, Provenance

SOURCE = "Yahoo Finance"
DELAY_NOTE = "Exchange data delayed by up to 15–20 min; not for trading."


def _num(value: Any) -> float | None:
    """Yahoo returns NaN, 'Infinity', strings and None for missing values; normalise them."""
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def _stamp(value: Any) -> pd.Timestamp:
    """`pd.Timestamp()` is typed as possibly NaT; Yahoo's index labels never are."""
    return cast(pd.Timestamp, pd.Timestamp(value))


# ── Search ────────────────────────────────────────────────────────────────────


class SecurityHit(BaseModel):
    symbol: str
    name: str
    exchange: str | None = None
    type: str | None = None
    sector: str | None = None


@cached(ttl=3600)
def search(query: str) -> Envelope[list[SecurityHit]]:
    try:
        result = yf.Search(query, max_results=8, news_count=0, enable_fuzzy_query=True)
        quotes = result.quotes
    except Exception as exc:
        raise UpstreamError(f"Yahoo search failed: {exc}") from exc
    hits = [
        SecurityHit(
            symbol=q["symbol"],
            name=q.get("longname") or q.get("shortname") or q["symbol"],
            exchange=q.get("exchDisp") or q.get("exchange"),
            type=q.get("typeDisp") or q.get("quoteType"),
            sector=q.get("sectorDisp"),
        )
        for q in quotes
        if q.get("symbol")
    ]
    return Envelope(data=hits, meta=Provenance(source=SOURCE, freshness="delayed"))


# ── Profile (DES) ─────────────────────────────────────────────────────────────


class Officer(BaseModel):
    name: str
    title: str | None = None


class Profile(BaseModel):
    symbol: str
    name: str
    quote_type: str | None
    exchange: str | None
    currency: str | None
    financial_currency: str | None
    country: str | None
    sector: str | None
    industry: str | None
    website: str | None
    employees: int | None
    summary: str | None
    officers: list[Officer]
    timezone: str | None
    market_time: datetime | None
    market_state: str | None
    # Quote
    price: float | None
    previous_close: float | None
    change: float | None
    change_pct: float | None
    open: float | None
    day_low: float | None
    day_high: float | None
    low_52w: float | None
    high_52w: float | None
    volume: float | None
    avg_volume_3m: float | None
    # Valuation & fundamentals (None when Yahoo has no value)
    market_cap: float | None
    enterprise_value: float | None
    shares_outstanding: float | None
    float_shares: float | None
    trailing_pe: float | None
    forward_pe: float | None
    price_to_book: float | None
    ev_to_ebitda: float | None
    ev_to_revenue: float | None
    eps_ttm: float | None
    eps_forward: float | None
    dividend_yield: float | None
    payout_ratio: float | None
    beta: float | None
    revenue_ttm: float | None
    ebitda: float | None
    gross_margin: float | None
    operating_margin: float | None
    profit_margin: float | None
    return_on_equity: float | None
    return_on_assets: float | None
    debt_to_equity: float | None
    current_ratio: float | None
    total_cash: float | None
    total_debt: float | None
    free_cash_flow: float | None
    target_mean_price: float | None
    analyst_count: int | None
    recommendation: str | None


@cached(ttl=300)
def profile(symbol: str) -> Envelope[Profile]:
    try:
        info: dict[str, Any] = yf.Ticker(symbol).info or {}
    except Exception as exc:
        raise UpstreamError(f"Yahoo profile failed for {symbol}: {exc}") from exc
    price = _num(info.get("regularMarketPrice") or info.get("currentPrice"))
    if not info.get("quoteType") or price is None:
        raise NotFoundError(f"No security found for '{symbol}'")

    prev = _num(info.get("regularMarketPreviousClose") or info.get("previousClose"))
    change = price - prev if prev else None
    market_time = info.get("regularMarketTime")
    stamp = datetime.fromtimestamp(market_time, UTC) if isinstance(market_time, int) else None
    employees = info.get("fullTimeEmployees")
    analysts = info.get("numberOfAnalystOpinions")
    dividend_yield = _num(info.get("dividendYield"))

    data = Profile(
        symbol=info.get("symbol", symbol),
        name=info.get("longName") or info.get("shortName") or symbol,
        quote_type=info.get("quoteType"),
        exchange=info.get("fullExchangeName") or info.get("exchange"),
        currency=info.get("currency"),
        financial_currency=info.get("financialCurrency"),
        country=info.get("country"),
        sector=info.get("sectorDisp") or info.get("sector"),
        industry=info.get("industryDisp") or info.get("industry"),
        website=info.get("website"),
        employees=int(employees) if isinstance(employees, int | float) else None,
        summary=info.get("longBusinessSummary"),
        officers=[
            Officer(name=o["name"], title=o.get("title"))
            for o in (info.get("companyOfficers") or [])[:5]
            if o.get("name")
        ],
        timezone=info.get("exchangeTimezoneName"),
        market_time=stamp,
        market_state=info.get("marketState"),
        price=price,
        previous_close=prev,
        change=change,
        change_pct=change / prev if change is not None and prev else None,
        open=_num(info.get("regularMarketOpen") or info.get("open")),
        day_low=_num(info.get("regularMarketDayLow") or info.get("dayLow")),
        day_high=_num(info.get("regularMarketDayHigh") or info.get("dayHigh")),
        low_52w=_num(info.get("fiftyTwoWeekLow")),
        high_52w=_num(info.get("fiftyTwoWeekHigh")),
        volume=_num(info.get("regularMarketVolume") or info.get("volume")),
        avg_volume_3m=_num(info.get("averageVolume")),
        market_cap=_num(info.get("marketCap")),
        enterprise_value=_num(info.get("enterpriseValue")),
        shares_outstanding=_num(info.get("sharesOutstanding")),
        float_shares=_num(info.get("floatShares")),
        trailing_pe=_num(info.get("trailingPE")),
        forward_pe=_num(info.get("forwardPE")),
        price_to_book=_num(info.get("priceToBook")),
        ev_to_ebitda=_num(info.get("enterpriseToEbitda")),
        ev_to_revenue=_num(info.get("enterpriseToRevenue")),
        eps_ttm=_num(info.get("trailingEps")),
        eps_forward=_num(info.get("forwardEps")),
        # yfinance ≥ 0.2.50 reports dividendYield in percent; store a fraction like the rest.
        dividend_yield=dividend_yield / 100 if dividend_yield is not None else None,
        payout_ratio=_num(info.get("payoutRatio")),
        beta=_num(info.get("beta")),
        revenue_ttm=_num(info.get("totalRevenue")),
        ebitda=_num(info.get("ebitda")),
        gross_margin=_num(info.get("grossMargins")),
        operating_margin=_num(info.get("operatingMargins")),
        profit_margin=_num(info.get("profitMargins")),
        return_on_equity=_num(info.get("returnOnEquity")),
        return_on_assets=_num(info.get("returnOnAssets")),
        # Yahoo quotes D/E in percent (e.g. 85.3 = 0.853×).
        debt_to_equity=(d / 100 if (d := _num(info.get("debtToEquity"))) is not None else None),
        current_ratio=_num(info.get("currentRatio")),
        total_cash=_num(info.get("totalCash")),
        total_debt=_num(info.get("totalDebt")),
        free_cash_flow=_num(info.get("freeCashflow")),
        target_mean_price=_num(info.get("targetMeanPrice")),
        analyst_count=int(analysts) if isinstance(analysts, int | float) else None,
        recommendation=info.get("recommendationKey"),
    )
    notes = [DELAY_NOTE]
    if data.financial_currency and data.currency and data.financial_currency != data.currency:
        notes.append(
            f"Quote in {data.currency}; company reports in {data.financial_currency}. "
            "Ratios mixing the two are converted by Yahoo."
        )
    return Envelope(
        data=data,
        meta=Provenance(
            source=SOURCE,
            source_url=f"https://finance.yahoo.com/quote/{symbol}",
            freshness="delayed",
            as_of=stamp,
            notes=notes,
        ),
    )


# ── Price history (GP / HP) ───────────────────────────────────────────────────

Span = Literal["intraday1d", "intraday5d", "daily", "weekly"]

# span -> (Yahoo period, Yahoo interval, cache ttl seconds)
SPANS: dict[str, tuple[str, str, int]] = {
    "intraday1d": ("1d", "5m", 60),
    "intraday5d": ("5d", "15m", 120),
    "daily": ("10y", "1d", 600),
    "weekly": ("max", "1wk", 3600),
}


class Bar(BaseModel):
    # 'YYYY-MM-DD' for daily/weekly bars, unix seconds for intraday bars.
    time: str | int
    open: float
    high: float
    low: float
    close: float
    adj_close: float | None
    volume: float


class Event(BaseModel):
    time: str
    kind: Literal["dividend", "split"]
    value: float


class History(BaseModel):
    symbol: str
    span: Span
    interval: str
    currency: str | None
    timezone: str | None
    bars: list[Bar]
    events: list[Event]


def _fetch_history(symbol: str, span: Span) -> Envelope[History]:
    period, interval, _ = SPANS[span]
    try:
        ticker = yf.Ticker(symbol)
        frame = ticker.history(
            period=period, interval=interval, auto_adjust=False, actions=True, raise_errors=True
        )
        meta = ticker.history_metadata or {}
    except Exception as exc:
        message = str(exc).lower()
        if "delisted" in message or "no data" in message or "not found" in message:
            raise NotFoundError(f"No price history for '{symbol}'") from exc
        raise UpstreamError(f"Yahoo history failed for {symbol}: {exc}") from exc
    frame = frame.dropna(subset=["Open", "High", "Low", "Close"])
    if frame.empty:
        raise NotFoundError(f"No price history for '{symbol}'")

    intraday = span.startswith("intraday")
    bars: list[Bar] = []
    events: list[Event] = []
    rows: dict[Any, dict[str, Any]] = frame.to_dict("index")
    for stamp, row in rows.items():
        ts = _stamp(stamp)
        t: str | int = int(ts.timestamp()) if intraday else ts.strftime("%Y-%m-%d")
        bars.append(
            Bar(
                time=t,
                open=float(row["Open"]),
                high=float(row["High"]),
                low=float(row["Low"]),
                close=float(row["Close"]),
                adj_close=_num(row.get("Adj Close")),
                volume=_num(row.get("Volume")) or 0.0,
            )
        )
        day = ts.strftime("%Y-%m-%d")
        if (div := _num(row.get("Dividends"))) and div > 0:
            events.append(Event(time=day, kind="dividend", value=div))
        if (split := _num(row.get("Stock Splits"))) and split > 0:
            events.append(Event(time=day, kind="split", value=split))

    if not intraday:  # weekly resampling can repeat the last date; keep the latest bar
        unique: dict[str | int, Bar] = {b.time: b for b in bars}
        bars = list(unique.values())

    last: datetime = _stamp(frame.index[-1]).to_pydatetime()
    return Envelope(
        data=History(
            symbol=symbol,
            span=span,
            interval=interval,
            currency=meta.get("currency"),
            timezone=meta.get("exchangeTimezoneName"),
            bars=bars,
            events=events,
        ),
        meta=Provenance(
            source=SOURCE,
            source_url=f"https://finance.yahoo.com/quote/{symbol}/history",
            freshness="delayed" if intraday else "end_of_day",
            as_of=last,
            notes=[
                "OHLC adjusted for splits but not dividends; adj_close is total-return adjusted.",
                DELAY_NOTE,
            ],
        ),
    )


# Intraday bars go stale in a minute, decades of weekly bars barely change: one cached
# wrapper per span, each with its own TTL.
_HISTORY_FETCHERS = {span: cached(ttl)(_fetch_history) for span, (_, _, ttl) in SPANS.items()}


def history(symbol: str, span: Span) -> Envelope[History]:
    return _HISTORY_FETCHERS[span](symbol, span)


# ── Batch quotes (WEI / CMDTY / WL) ───────────────────────────────────────────


class Quote(BaseModel):
    symbol: str
    last: float
    previous_close: float | None
    change: float | None
    change_pct: float | None
    change_1m_pct: float | None
    change_ytd_pct: float | None
    high_52w: float | None
    low_52w: float | None
    as_of: date
    spark: list[float]


@cached(ttl=90)
def quotes(symbols: tuple[str, ...]) -> Envelope[list[Quote]]:
    """Last daily bar per symbol plus simple derived changes, from one batched download."""
    if not symbols:
        return Envelope(data=[], meta=Provenance(source=SOURCE, freshness="delayed"))
    try:
        frame = yf.download(
            list(symbols),
            period="1y",
            interval="1d",
            auto_adjust=False,
            progress=False,
            group_by="column",
            threads=True,
        )
    except Exception as exc:
        raise UpstreamError(f"Yahoo quote download failed: {exc}") from exc
    if frame is None or frame.empty:
        raise UpstreamError("Yahoo returned no quote data")

    closes = frame["Close"]
    if isinstance(closes, pd.Series):  # single symbol
        closes = closes.to_frame(symbols[0])
    out: list[Quote] = []
    for symbol in symbols:
        if symbol not in closes:
            continue
        points = [
            (_stamp(t), v)
            for t, raw in closes[symbol].dropna().items()
            if (v := _num(raw)) is not None
        ]
        if points:
            out.append(_quote_from_closes(symbol, points))
    as_of = max((q.as_of for q in out), default=None)
    return Envelope(
        data=out,
        meta=Provenance(
            source=SOURCE,
            source_url="https://finance.yahoo.com/markets/",
            freshness="delayed",
            as_of=datetime.combine(as_of, datetime.min.time(), UTC) if as_of else None,
            notes=["Last = latest daily bar (intraday while the session is open).", DELAY_NOTE],
        ),
    )


def _quote_from_closes(symbol: str, points: list[tuple[pd.Timestamp, float]]) -> Quote:
    """Derive a quote from daily closes [(timestamp, close)], oldest first."""
    last_day, last = points[-1]
    prev = points[-2][1] if len(points) > 1 else None

    def pct_since(cutoff: pd.Timestamp) -> float | None:
        before = [close for t, close in points if t <= cutoff]
        return last / before[-1] - 1 if before and before[-1] else None

    tz = last_day.tz
    year_start = _stamp(
        pd.Timestamp(year=last_day.year, month=1, day=1, tz=tz) - pd.Timedelta(days=1)
    )
    return Quote(
        symbol=symbol,
        last=last,
        previous_close=prev,
        change=last - prev if prev is not None else None,
        change_pct=last / prev - 1 if prev else None,
        change_1m_pct=pct_since(_stamp(last_day - pd.DateOffset(months=1))),
        change_ytd_pct=pct_since(year_start),
        high_52w=max(close for _, close in points),
        low_52w=min(close for _, close in points),
        as_of=last_day.date(),
        spark=[round(close, 6) for _, close in points[-30:]],
    )


# ── Financial statements (FA) ─────────────────────────────────────────────────

Statement = Literal["income", "balance", "cashflow"]
Period = Literal["annual", "quarterly"]

# (Yahoo row label, display label, emphasis, indent). Order is the display order; rows
# Yahoo does not report for a company are skipped.
LAYOUTS: dict[str, list[tuple[str, str, bool, int]]] = {
    "income": [
        ("Total Revenue", "Revenue", True, 0),
        ("Cost Of Revenue", "Cost of revenue", False, 1),
        ("Gross Profit", "Gross profit", True, 0),
        ("Research And Development", "R&D", False, 1),
        ("Selling General And Administration", "SG&A", False, 1),
        ("Operating Expense", "Operating expenses", False, 1),
        ("Operating Income", "Operating income", True, 0),
        ("EBITDA", "EBITDA", False, 0),
        ("EBIT", "EBIT", False, 0),
        ("Interest Expense", "Interest expense", False, 1),
        ("Interest Income", "Interest income", False, 1),
        ("Pretax Income", "Pre-tax income", True, 0),
        ("Tax Provision", "Income tax", False, 1),
        ("Net Income Common Stockholders", "Net income to common", True, 0),
        ("Basic EPS", "EPS (basic)", False, 0),
        ("Diluted EPS", "EPS (diluted)", False, 0),
        ("Diluted Average Shares", "Diluted shares", False, 0),
    ],
    "balance": [
        ("Cash And Cash Equivalents", "Cash & equivalents", False, 1),
        ("Other Short Term Investments", "Short-term investments", False, 1),
        ("Receivables", "Receivables", False, 1),
        ("Inventory", "Inventory", False, 1),
        ("Current Assets", "Current assets", True, 0),
        ("Net PPE", "Net PP&E", False, 1),
        ("Goodwill And Other Intangible Assets", "Goodwill & intangibles", False, 1),
        ("Total Non Current Assets", "Non-current assets", False, 0),
        ("Total Assets", "Total assets", True, 0),
        ("Accounts Payable", "Accounts payable", False, 1),
        ("Current Debt And Capital Lease Obligation", "Short-term debt", False, 1),
        ("Current Liabilities", "Current liabilities", True, 0),
        ("Long Term Debt And Capital Lease Obligation", "Long-term debt", False, 1),
        (
            "Total Non Current Liabilities Net Minority Interest",
            "Non-current liabilities",
            False,
            0,
        ),
        ("Total Liabilities Net Minority Interest", "Total liabilities", True, 0),
        ("Stockholders Equity", "Shareholders' equity", True, 0),
        ("Minority Interest", "Minority interest", False, 1),
        ("Total Debt", "Total debt", False, 0),
        ("Net Debt", "Net debt", False, 0),
        ("Working Capital", "Working capital", False, 0),
        ("Ordinary Shares Number", "Shares outstanding", False, 0),
    ],
    "cashflow": [
        ("Net Income From Continuing Operations", "Net income", False, 1),
        ("Depreciation And Amortization", "D&A", False, 1),
        ("Change In Working Capital", "Change in working capital", False, 1),
        ("Operating Cash Flow", "Cash from operations", True, 0),
        ("Capital Expenditure", "Capital expenditure", False, 1),
        ("Investing Cash Flow", "Cash from investing", True, 0),
        ("Cash Dividends Paid", "Dividends paid", False, 1),
        ("Repurchase Of Capital Stock", "Share repurchases", False, 1),
        ("Net Issuance Payments Of Debt", "Net debt issuance", False, 1),
        ("Financing Cash Flow", "Cash from financing", True, 0),
        ("Free Cash Flow", "Free cash flow", True, 0),
        ("End Cash Position", "Ending cash", False, 0),
    ],
}

PER_SHARE_ROWS = {"Basic EPS", "Diluted EPS"}
COUNT_ROWS = {"Diluted Average Shares", "Ordinary Shares Number"}


class StatementRow(BaseModel):
    key: str
    label: str
    emphasis: bool
    indent: int
    unit: Literal["currency", "per_share", "shares"]
    values: list[float | None]


class Statements(BaseModel):
    symbol: str
    statement: Statement
    period: Period
    currency: str | None
    periods: list[str]
    rows: list[StatementRow]


def _frame_for(ticker: yf.Ticker, statement: Statement, period: Period) -> pd.DataFrame:
    quarterly = period == "quarterly"
    if statement == "income":
        return ticker.quarterly_income_stmt if quarterly else ticker.income_stmt
    if statement == "balance":
        return ticker.quarterly_balance_sheet if quarterly else ticker.balance_sheet
    return ticker.quarterly_cashflow if quarterly else ticker.cashflow


def statements_from_frame(
    symbol: str, statement: Statement, period: Period, frame: pd.DataFrame, currency: str | None
) -> Statements:
    """Pick and order the rows of a yfinance statement frame (rows=items, cols=periods)."""
    frame = frame.reindex(sorted(frame.columns), axis=1)  # oldest → newest, left to right
    picked = [row for row in LAYOUTS[statement] if row[0] in frame.index]
    selected = frame.loc[[key for key, *_ in picked]]
    # Yahoo often appends an old period with only a handful of obscure items filled in.
    selected = selected.loc[:, selected.notna().any(axis=0)]
    rows: list[StatementRow] = []
    for key, label, emphasis, indent in picked:
        values = [_num(v) for v in selected.loc[key].tolist()]
        if all(v is None for v in values):
            continue
        unit = (
            "per_share" if key in PER_SHARE_ROWS else "shares" if key in COUNT_ROWS else "currency"
        )
        rows.append(
            StatementRow(
                key=key, label=label, emphasis=emphasis, indent=indent, unit=unit, values=values
            )
        )
    return Statements(
        symbol=symbol,
        statement=statement,
        period=period,
        currency=currency,
        periods=[pd.Timestamp(c).strftime("%Y-%m-%d") for c in selected.columns],
        rows=rows,
    )


@cached(ttl=6 * 3600)
def financials(symbol: str, statement: Statement, period: Period) -> Envelope[Statements]:
    try:
        ticker = yf.Ticker(symbol)
        frame = _frame_for(ticker, statement, period)
        currency = (ticker.info or {}).get("financialCurrency")
    except Exception as exc:
        raise UpstreamError(f"Yahoo statements failed for {symbol}: {exc}") from exc
    if frame is None or frame.empty:
        raise NotFoundError(f"No {period} {statement} statement for '{symbol}'")
    data = statements_from_frame(symbol, statement, period, frame, currency)
    as_of = datetime.fromisoformat(data.periods[-1]).replace(tzinfo=UTC) if data.periods else None
    return Envelope(
        data=data,
        meta=Provenance(
            source=SOURCE,
            source_url=f"https://finance.yahoo.com/quote/{symbol}/financials",
            freshness="filing",
            as_of=as_of,
            notes=[
                "Yahoo's standardised line items, derived from company filings; "
                "not point-in-time (restated figures replace originals).",
            ],
        ),
    )


# ── News (NEWS) ───────────────────────────────────────────────────────────────

RSS_URL = "https://feeds.finance.yahoo.com/rss/2.0/headline"
MARKET_NEWS_SYMBOLS = "^GSPC,^DJI,^IXIC,^STOXX50E"


class Headline(BaseModel):
    title: str
    link: str
    published_at: datetime | None
    summary: str | None


def parse_rss(xml_text: str) -> list[Headline]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise UpstreamError("Could not parse news feed") from exc
    items: list[Headline] = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        published: datetime | None = None
        if pub := item.findtext("pubDate"):
            try:
                published = parsedate_to_datetime(pub)
            except (TypeError, ValueError):
                published = None
        summary = (item.findtext("description") or "").strip() or None
        items.append(Headline(title=title, link=link, published_at=published, summary=summary))
    items.sort(key=lambda h: h.published_at or datetime.min.replace(tzinfo=UTC), reverse=True)
    return items


@cached(ttl=300)
def news(symbol: str | None) -> Envelope[list[Headline]]:
    text = http.get_text(
        RSS_URL, params={"s": symbol or MARKET_NEWS_SYMBOLS, "region": "US", "lang": "en-US"}
    )
    items = parse_rss(text)
    return Envelope(
        data=items,
        meta=Provenance(
            source="Yahoo Finance RSS",
            source_url=f"https://finance.yahoo.com/quote/{symbol}/news" if symbol else None,
            freshness="delayed",
            as_of=items[0].published_at if items else None,
            notes=["Headlines and links only; articles belong to their publishers."],
        ),
    )
