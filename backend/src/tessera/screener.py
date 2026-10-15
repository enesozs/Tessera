"""Equity screening (EQS) with a small query language over Yahoo's server-side screener.

    [FIND EQUITIES WHERE] <condition> [SORT BY <field> [ASC|DESC]] [LIMIT <n>]

    condition := term (OR term)*            term := factor (AND factor)*
    factor    := ( condition ) | field op value | field BETWEEN v AND v | field IN (v, …)
    op        := = > < >= <=
    value     := 12 | 2.5B | 500M | 10% | Italy | "Financial Services"

Examples: `COUNTRY = IT AND ROE > 15% SORT BY MKTCAP DESC`,
`SECTOR = TECHNOLOGY AND PE BETWEEN 5 AND 15 AND COUNTRY IN (DE, FR, NL)`.

Parsing produces a neutral tree (tested offline); `to_yahoo` turns it into the nested
`{"operator", "operands"}` form Yahoo's screener expects. Percent-valued fields are quoted by
Yahoo in percent units, so `ROE > 15%` and `ROE > 15` mean the same.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel

from tessera.cache import cached
from tessera.errors import NotApplicableError, UpstreamError
from tessera.models import Envelope, Provenance

Kind = Literal["category", "money", "percent", "number"]


@dataclass(frozen=True)
class Field:
    yahoo: str
    kind: Kind
    label: str
    group: str


FIELDS: dict[str, Field] = {
    "COUNTRY": Field("region", "category", "Country / region (ISO code or name)", "Universe"),
    "SECTOR": Field("sector", "category", "Sector", "Universe"),
    "INDUSTRY": Field("industry", "category", "Industry", "Universe"),
    "EXCHANGE": Field("exchange", "category", "Exchange code (NMS, NYQ, MIL, GER…)", "Universe"),
    "MKTCAP": Field("intradaymarketcap", "money", "Market capitalisation (local currency)", "Size"),
    "PRICE": Field("intradayprice", "number", "Price", "Size"),
    "VOLUME": Field("dayvolume", "money", "Today's volume (shares)", "Trading"),
    "AVGVOL": Field("avgdailyvol3m", "money", "3-month average daily volume", "Trading"),
    "CHANGE": Field("percentchange", "percent", "Change today", "Trading"),
    "PERF52W": Field("fiftytwowkpercentchange", "percent", "52-week price change", "Trading"),
    "BETA": Field("beta", "number", "Beta", "Trading"),
    "PE": Field("peratio.lasttwelvemonths", "number", "P/E (ttm)", "Valuation"),
    "PB": Field("pricebookratio.quarterly", "number", "Price / book", "Valuation"),
    "EV_EBITDA": Field("lastclosetevebitda.lasttwelvemonths", "number", "EV / EBITDA", "Valuation"),
    "EV_SALES": Field("lastclosetevtotalrevenue.lasttwelvemonths", "number", "EV / sales", "Valuation"),
    "PEG": Field("pegratio_5y", "number", "PEG ratio (5Y)", "Valuation"),
    "DIVYIELD": Field("forward_dividend_yield", "percent", "Forward dividend yield", "Income"),
    "DIVGROWTH_YEARS": Field("consecutive_years_of_dividend_growth_count", "number", "Consecutive years of dividend growth", "Income"),
    "ROE": Field("returnonequity.lasttwelvemonths", "percent", "Return on equity", "Profitability"),
    "ROA": Field("returnonassets.lasttwelvemonths", "percent", "Return on assets", "Profitability"),
    "ROIC": Field("returnontotalcapital.lasttwelvemonths", "percent", "Return on total capital", "Profitability"),
    "GROSS_MARGIN": Field("grossprofitmargin.lasttwelvemonths", "percent", "Gross margin", "Profitability"),
    "EBITDA_MARGIN": Field("ebitdamargin.lasttwelvemonths", "percent", "EBITDA margin", "Profitability"),
    "NET_MARGIN": Field("netincomemargin.lasttwelvemonths", "percent", "Net margin", "Profitability"),
    "REV_GROWTH": Field("totalrevenues1yrgrowth.lasttwelvemonths", "percent", "Revenue growth, 1Y", "Growth"),
    "EPS_GROWTH": Field("epsgrowth.lasttwelvemonths", "percent", "EPS growth, 1Y", "Growth"),
    "DEBT_EQUITY": Field("totaldebtequity.lasttwelvemonths", "percent", "Total debt / equity", "Balance sheet"),
    "NETDEBT_EBITDA": Field("netdebtebitda.lasttwelvemonths", "number", "Net debt / EBITDA", "Balance sheet"),
    "CURRENT_RATIO": Field("currentratio.lasttwelvemonths", "number", "Current ratio", "Balance sheet"),
    "SHORT_FLOAT": Field("short_percentage_of_float.value", "percent", "Short interest, % of float", "Positioning"),
    "INSIDERS": Field("pctheldinsider", "percent", "Held by insiders", "Positioning"),
    "INSTITUTIONS": Field("pctheldinst", "percent", "Held by institutions", "Positioning"),
}  # fmt: skip

SECTORS = [
    "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive",
    "Energy", "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology",
    "Utilities",
]  # fmt: skip
REGIONS = {
    "ae", "ar", "at", "au", "be", "br", "ca", "ch", "cl", "cn", "co", "cz", "de", "dk", "ee",
    "eg", "es", "fi", "fr", "gb", "gr", "hk", "hu", "id", "ie", "il", "in", "is", "it", "jp",
    "kr", "kw", "lk", "lt", "lv", "mx", "my", "nl", "no", "nz", "pe", "ph", "pk", "pl", "pt",
    "qa", "ro", "ru", "sa", "se", "sg", "sr", "th", "tr", "tw", "us", "ve", "vn", "za",
}  # fmt: skip
COUNTRY_NAMES = {
    "UNITED STATES": "us", "USA": "us", "UK": "gb", "UNITED KINGDOM": "gb", "BRITAIN": "gb",
    "ITALY": "it", "GERMANY": "de", "FRANCE": "fr", "SPAIN": "es", "NETHERLANDS": "nl",
    "SWITZERLAND": "ch", "TURKEY": "tr", "TURKIYE": "tr", "JAPAN": "jp", "CHINA": "cn",
    "HONG KONG": "hk", "INDIA": "in", "CANADA": "ca", "BRAZIL": "br", "AUSTRALIA": "au",
    "SWEDEN": "se", "NORWAY": "no", "DENMARK": "dk", "FINLAND": "fi", "BELGIUM": "be",
    "AUSTRIA": "at", "IRELAND": "ie", "PORTUGAL": "pt", "GREECE": "gr", "POLAND": "pl",
    "KOREA": "kr", "SOUTH KOREA": "kr", "TAIWAN": "tw", "SINGAPORE": "sg", "MEXICO": "mx",
    "ISRAEL": "il", "SOUTH AFRICA": "za", "SAUDI ARABIA": "sa",
}  # fmt: skip
SECTOR_ALIASES = {"TECH": "Technology", "FINANCIALS": "Financial Services", "BANKS": "Financial Services", "HEALTH": "Healthcare", "MATERIALS": "Basic Materials", "TELECOM": "Communication Services"}  # fmt: skip

OPS = {"=": "eq", ">": "gt", "<": "lt", ">=": "gte", "<=": "lte"}
TOKEN = re.compile(r'\s*(>=|<=|[=<>(),]|"[^"]*"|\'[^\']*\'|[^\s=<>(),]+)')
MULTIPLIER = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}


class QueryError(ValueError):
    pass


# Neutral tree: ("and" | "or", [nodes]) or ("cmp", op, field, value)
Node = tuple


@dataclass
class Query:
    where: Node
    sort_field: str = "MKTCAP"
    ascending: bool = False
    limit: int = 50


def tokenize(text: str) -> list[str]:
    tokens, pos = [], 0
    text = text.strip()
    while pos < len(text):
        m = TOKEN.match(text, pos)
        if not m:
            raise QueryError(f"Cannot read the query near: {text[pos : pos + 12]!r}")
        tokens.append(m.group(1))
        pos = m.end()
    return tokens


def parse_number(raw: str, kind: Kind) -> float:
    s = raw.upper().replace(",", "").replace("$", "")
    pct = s.endswith("%")
    s = s.rstrip("%")
    mult = 1.0
    if s and s[-1] in MULTIPLIER:
        mult, s = MULTIPLIER[s[-1]], s[:-1]
    try:
        value = float(s) * mult
    except ValueError:
        raise QueryError(f"'{raw}' is not a number") from None
    if pct and kind != "percent":
        raise QueryError(f"'{raw}': % only applies to percentage fields")
    return value


def category_value(field: str, raw: str) -> str:
    v = raw.strip("\"'")
    up = v.upper().replace("_", " ")
    if field == "COUNTRY":
        code = COUNTRY_NAMES.get(up, v.lower())
        if code not in REGIONS:
            raise QueryError(f"Unknown country '{v}' — use an ISO code such as IT, DE, US")
        return code
    if field == "SECTOR":
        if up in SECTOR_ALIASES:
            return SECTOR_ALIASES[up]
        matches = [s for s in SECTORS if s.upper() == up] or [
            s for s in SECTORS if s.upper().startswith(up)
        ]
        if len(matches) != 1:
            raise QueryError(f"Unknown sector '{v}'. Sectors: {', '.join(SECTORS)}")
        return matches[0]
    if field == "EXCHANGE":
        return v.upper()
    return v.title() if v.isupper() else v  # industries are title case on Yahoo


class Parser:
    def __init__(self, tokens: list[str]):
        self.t = tokens
        self.i = 0

    def peek(self, offset: int = 0) -> str | None:
        j = self.i + offset
        return self.t[j].upper() if j < len(self.t) else None

    def take(self, expected: str | None = None, what: str | None = None) -> str:
        """Next token; `expected` demands that exact keyword, `what` only names it in errors."""
        if self.i >= len(self.t):
            missing = expected or what
            raise QueryError(f"Query ended early{f'; expected {missing}' if missing else ''}")
        tok = self.t[self.i]
        if expected and tok.upper() != expected:
            raise QueryError(f"Expected {expected} but found '{tok}'")
        self.i += 1
        return tok

    def query(self) -> Query:
        if self.peek() == "FIND":
            self.take()
            if self.peek() in ("EQUITIES", "STOCKS"):
                self.take()
        if self.peek() == "WHERE":
            self.take()
        where = self.condition()
        q = Query(where)
        while self.peek() is not None:
            word = self.take().upper()
            if word == "SORT":
                self.take("BY")
                q.sort_field = self.field_name()
                if self.peek() in ("ASC", "DESC"):
                    q.ascending = self.take().upper() == "ASC"
            elif word == "LIMIT":
                raw = self.take()
                if not raw.isdigit() or not 1 <= int(raw) <= 250:
                    raise QueryError("LIMIT takes a whole number between 1 and 250")
                q.limit = int(raw)
            else:
                raise QueryError(f"Unexpected '{word}' — combine conditions with AND / OR")
        return q

    def condition(self) -> Node:
        nodes = [self.term()]
        while self.peek() == "OR":
            self.take()
            nodes.append(self.term())
        return nodes[0] if len(nodes) == 1 else ("or", nodes)

    def term(self) -> Node:
        nodes = [self.factor()]
        while self.peek() == "AND":
            self.take()
            nodes.append(self.factor())
        return nodes[0] if len(nodes) == 1 else ("and", nodes)

    def field_name(self) -> str:
        raw = self.take(what="a field").upper()
        aliases = {"REGION": "COUNTRY", "MARKETCAP": "MKTCAP", "MARKET_CAP": "MKTCAP", "YIELD": "DIVYIELD", "P/E": "PE", "P/B": "PB"}  # fmt: skip
        name = aliases.get(raw, raw)
        if name not in FIELDS:
            raise QueryError(f"Unknown field '{raw}'. Try: {', '.join(list(FIELDS)[:12])}, …")
        return name

    def value(self, field: str) -> Any:
        f = FIELDS[field]
        raw = self.take(what="a value")
        if f.kind == "category":
            # Allow unquoted multi-word values: SECTOR = Financial Services
            while self.peek() is not None and self.peek() not in (
                "AND",
                "OR",
                ")",
                ",",
                "SORT",
                "LIMIT",
            ):
                raw += " " + self.take()
            return category_value(field, raw)
        return parse_number(raw, f.kind)

    def factor(self) -> Node:
        if self.peek() == "(":
            self.take()
            node = self.condition()
            self.take(")")
            return node
        field = self.field_name()
        op = self.take(what="an operator")
        upper = op.upper()
        if upper == "BETWEEN":
            if FIELDS[field].kind == "category":
                raise QueryError(f"{field} is a category; use = or IN")
            low = self.value(field)
            self.take("AND")
            return ("cmp", "btwn", field, (low, self.value(field)))
        if upper == "IN":
            self.take("(")
            values = [self.value(field)]
            while self.peek() == ",":
                self.take()
                values.append(self.value(field))
            self.take(")")
            if len(values) == 1:
                return ("cmp", "eq", field, values[0])
            return ("or", [("cmp", "eq", field, v) for v in values])
        if op not in OPS:
            raise QueryError(f"Unknown operator '{op}'; use = > < >= <= BETWEEN or IN")
        if FIELDS[field].kind == "category" and op != "=":
            raise QueryError(f"{field} is a category; use = or IN")
        return ("cmp", OPS[op], field, self.value(field))


def parse(text: str) -> Query:
    tokens = tokenize(text)
    if not tokens:
        raise QueryError("Empty query")
    return Parser(tokens).query()


def to_yahoo(node: Node) -> dict[str, Any]:
    """Neutral tree → Yahoo screener JSON ({"operator", "operands"})."""
    if node[0] in ("and", "or"):
        return {"operator": node[0], "operands": [to_yahoo(n) for n in node[1]]}
    _, op, field, value = node
    name = FIELDS[field].yahoo
    if op == "btwn":
        return {"operator": "btwn", "operands": [name, value[0], value[1]]}
    return {"operator": op, "operands": [name, value]}


def _short(v: float) -> str:
    for size, suffix in ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")):
        if abs(v) >= size:
            return f"{v / size:g}{suffix}"
    return f"{v:g}"


def describe(node: Node) -> str:
    if node[0] in ("and", "or"):
        inner = f" {node[0].upper()} ".join(describe(n) for n in node[1])
        return f"({inner})" if node[0] == "or" else inner
    _, op, field, value = node
    sym = {"eq": "=", "gt": ">", "lt": "<", "gte": "≥", "lte": "≤"}
    unit = "%" if FIELDS[field].kind == "percent" else ""
    if op == "btwn":
        return f"{field} {value[0]:g}{unit}–{value[1]:g}{unit}"
    if isinstance(value, float):
        shown = _short(value) if FIELDS[field].kind == "money" else f"{value:g}{unit}"
    else:
        shown = str(value).upper() if field == "COUNTRY" else str(value)
    return f"{field} {sym[op]} {shown}"


# ── Execution ─────────────────────────────────────────────────────────────────


class ScreenRow(BaseModel):
    symbol: str
    name: str
    exchange: str | None
    currency: str | None
    price: float | None
    change_pct: float | None  # fraction
    market_cap: float | None
    trailing_pe: float | None
    forward_pe: float | None
    price_to_book: float | None
    dividend_yield: float | None  # fraction
    perf_52w: float | None  # fraction
    volume: float | None


class ScreenResult(BaseModel):
    query: str
    total: int
    sort: str
    rows: list[ScreenRow]
    warnings: list[str]


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else None


def _pct(v: Any) -> float | None:
    x = _num(v)
    return x / 100 if x is not None else None


def _equity_query(yf: Any, body: dict[str, Any]) -> Any:
    operands = body["operands"]
    if body["operator"] in ("and", "or"):
        operands = [_equity_query(yf, o) for o in operands]
    return yf.EquityQuery(body["operator"], operands)


def uses(node: Node, field: str) -> bool:
    """Does the condition mention `field` (or `field:value` for an exact category value)?"""
    if node[0] in ("and", "or"):
        return any(uses(n, field) for n in node[1])
    name, _, value = field.partition(":")
    return node[2] == name and (not value or node[3] == value)


def warnings_for(q: Query) -> list[str]:
    """Pitfalls of Yahoo's screener worth telling the user about."""
    out = []
    local = ("MKTCAP", "PRICE", "VOLUME", "AVGVOL")
    sized = any(uses(q.where, f) for f in local) or q.sort_field in local
    if sized and not (uses(q.where, "COUNTRY") or uses(q.where, "EXCHANGE")):
        out.append(
            "Market cap, price and volume are in each listing's own currency, so without a "
            "COUNTRY or EXCHANGE filter, sizes across markets are not comparable."
        )
    if uses(q.where, "COUNTRY") and not uses(q.where, "COUNTRY:us"):
        out.append(
            "COUNTRY selects the market a stock is listed in, so secondary listings of foreign "
            "companies appear too (NVD.DE is NVIDIA on Xetra)."
        )
    return out


@cached(ttl=300)
def run(text: str) -> Envelope[ScreenResult]:
    try:
        q = parse(text)
    except QueryError as exc:
        raise NotApplicableError(str(exc)) from exc
    import yfinance as yf  # network-only dependency, kept out of the parser

    try:
        query = _equity_query(yf, to_yahoo(q.where))
    except ValueError as exc:
        raise NotApplicableError(f"Yahoo rejected the query: {exc}") from exc
    try:
        result = yf.screen(
            query, sortField=FIELDS[q.sort_field].yahoo, sortAsc=q.ascending, size=q.limit
        )
    except Exception as exc:
        raise UpstreamError(f"Yahoo screener failed: {exc}") from exc
    rows = [
        ScreenRow(
            symbol=r["symbol"],
            name=r.get("longName") or r.get("shortName") or r["symbol"],
            exchange=r.get("fullExchangeName") or r.get("exchange"),
            currency=r.get("currency"),
            price=_num(r.get("regularMarketPrice")),
            change_pct=_pct(r.get("regularMarketChangePercent")),
            market_cap=_num(r.get("marketCap")),
            trailing_pe=_num(r.get("trailingPE")),
            forward_pe=_num(r.get("forwardPE")),
            price_to_book=_num(r.get("priceToBook")),
            dividend_yield=_pct(r.get("dividendYield")),
            perf_52w=_pct(r.get("fiftyTwoWeekChangePercent")),
            volume=_num(r.get("regularMarketVolume")),
        )
        for r in (result or {}).get("quotes", [])
    ]
    return Envelope(
        data=ScreenResult(
            query=describe(q.where),
            total=int((result or {}).get("total") or len(rows)),
            sort=f"{q.sort_field} {'ASC' if q.ascending else 'DESC'}",
            rows=rows,
            warnings=warnings_for(q),
        ),
        meta=Provenance(
            source="Yahoo Finance screener",
            source_url="https://finance.yahoo.com/research-hub/screener/",
            freshness="delayed",
            as_of=datetime.now(UTC),
            notes=[
                "Filters run on Yahoo's fundamentals (trailing twelve months unless noted); "
                "market caps and prices are in each listing's own currency."
            ],
        ),
    )


class FieldInfo(BaseModel):
    name: str
    label: str
    kind: str
    group: str


def fields() -> list[FieldInfo]:
    return [FieldInfo(name=k, label=f.label, kind=f.kind, group=f.group) for k, f in FIELDS.items()]
