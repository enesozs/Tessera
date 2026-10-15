"""ASK: a research assistant that answers with Tessera's own data, through Claude tool use.

The model never states a market number from memory: every figure must come from one of the
tools below, which call the same providers as the terminal's functions. Each tool result
carries its source and as-of date, the system prompt asks for a citation after every figure,
and the endpoint returns the full tool trace so the UI can show how an answer was built (and
open the matching function to check it).

Needs Anthropic credentials (ANTHROPIC_API_KEY, or an `ant auth login` profile). Model:
TESSERA_ASK_MODEL (default claude-opus-5-5). Each question costs a few cents of API usage.
"""

from __future__ import annotations

import itertools
import json
import os
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from typing import Any

from pydantic import BaseModel

from tessera.errors import ConfigurationError, TesseraError, UpstreamError
from tessera.models import Envelope, Provenance
from tessera.providers import fx, macro, rates, research, yahoo

MODEL = os.environ.get("TESSERA_ASK_MODEL", "claude-opus-5-5")
MAX_STEPS = 8
NO_CREDENTIALS = (
    "ASK needs Anthropic credentials: set ANTHROPIC_API_KEY in .env (or run `ant auth login`), "
    "then restart the API."
)
# Server-side refusal fallback: a declined request is re-run on Anthropic's recommended model.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

SYSTEM = """You are the research assistant inside Tessera, a financial terminal built on free public data.

Answer the user's question using the tools. Every number you state — prices, returns, yields, \
ratios, macro figures — must come from a tool result in this conversation, never from memory. \
After each figure, cite its source and as-of date in brackets, e.g. "4.82% [U.S. Treasury, \
14 Oct 2026]". If the tools cannot provide something, say so plainly instead of estimating.

Tickers are Yahoo symbols (RACE for Ferrari in New York, RACE.MI in Milan, ^GSPC for the S&P \
500); use search_securities when unsure. Prefer a few well-chosen tool calls; call independent \
tools in parallel.

Write for a finance student: lead with the direct answer, then the supporting figures and a \
short interpretation. Use short paragraphs or bullets, no headings, under about 250 words \
unless the question needs more. Data is delayed or end-of-day. Do not give personalised \
investment advice or price targets of your own; describing what the data shows is fine."""


def _schema(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


SYMBOL = {"type": "string", "description": "Yahoo ticker, e.g. AAPL, RACE.MI, ^GSPC, EURUSD=X"}

TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_securities",
        "description": "Find tickers by company name or partial ticker. Returns up to 6 matches with exchange and type.",
        "input_schema": _schema({"query": {"type": "string"}}),
    },
    {
        "name": "get_profile",
        "description": "Company profile and snapshot: price, change, market cap, P/E, EV/EBITDA, margins, ROE, debt, beta, sector, currency.",
        "input_schema": _schema({"symbol": SYMBOL}),
    },
    {
        "name": "get_price_history",
        "description": "Daily closes over a period, summarised: start/end price, total return, high, low, annualised volatility, max drawdown, and ~20 sampled points.",
        "input_schema": _schema(
            {
                "symbol": SYMBOL,
                "period": {"type": "string", "enum": ["1M", "3M", "6M", "1Y", "3Y", "5Y"]},
            }
        ),
    },
    {
        "name": "get_financials",
        "description": "Reported statement line items (in the company's reporting currency) for the latest periods.",
        "input_schema": _schema(
            {
                "symbol": SYMBOL,
                "statement": {"type": "string", "enum": ["income", "balance", "cashflow"]},
                "period": {"type": "string", "enum": ["annual", "quarterly"]},
            }
        ),
    },
    {
        "name": "get_earnings",
        "description": "Next report date, recent EPS actual vs consensus, and current-year/next-year revenue and EPS consensus.",
        "input_schema": _schema({"symbol": SYMBOL}),
    },
    {
        "name": "get_news",
        "description": "Latest headlines for a ticker; pass an empty string for top market news.",
        "input_schema": _schema({"symbol": {"type": "string"}}),
    },
    {
        "name": "get_quotes",
        "description": "Last price, 1-day, 1-month and year-to-date change for up to 10 tickers (indices, futures and FX pairs work too).",
        "input_schema": _schema({"symbols": {"type": "array", "items": {"type": "string"}}}),
    },
    {
        "name": "get_yield_curve",
        "description": "Latest government yield curve with changes vs 1 week, 1 month and 1 year ago. US = Treasury par yields; EA = euro-area AAA spot curve (ECB).",
        "input_schema": _schema({"region": {"type": "string", "enum": ["US", "EA"]}}),
    },
    {
        "name": "get_sovereign_spreads",
        "description": "Monthly 10-year government yields and spreads to Germany for euro-area countries (ISO codes, e.g. IT, FR, ES, GR), latest and a year earlier.",
        "input_schema": _schema({"countries": {"type": "array", "items": {"type": "string"}}}),
    },
    {
        "name": "get_macro_series",
        "description": (
            "An economic series: latest values and history. Catalogue ids: "
            + ", ".join(f"{s.id} ({s.title})" for s in macro.CATALOG)
            + ". Any FRED series id also works (e.g. GDPC1)."
        ),
        "input_schema": _schema({"series_id": {"type": "string"}}),
    },
    {
        "name": "get_fx_rate",
        "description": "ECB reference rate for a currency pair (units of quote per 1 base), with 1-month and 1-year changes.",
        "input_schema": _schema(
            {
                "base": {"type": "string", "description": "ISO code, e.g. EUR"},
                "quote": {"type": "string"},
            }
        ),
    },
    {
        "name": "screen_equities",
        "description": (
            "Screen stocks with Tessera's query language, e.g. 'COUNTRY = IT AND ROE > 15% SORT BY MKTCAP DESC "
            "LIMIT 10'. Fields include COUNTRY, SECTOR, MKTCAP, PE, PB, EV_EBITDA, DIVYIELD, ROE, ROA, "
            "GROSS_MARGIN, NET_MARGIN, REV_GROWTH, EPS_GROWTH, DEBT_EQUITY, BETA, PERF52W, CHANGE."
        ),
        "input_schema": _schema({"query": {"type": "string"}}),
    },
]
for _tool in TOOLS:
    _tool["strict"] = True


# ── Tool implementations: compact JSON-able dicts with their provenance ──────


def _meta(env: Envelope[Any]) -> dict[str, Any]:
    m = env.meta
    return {
        "source": m.source,
        "as_of": m.as_of.date().isoformat() if m.as_of else None,
        "stale": m.stale or None,
    }


def _search(a: dict[str, Any]) -> dict[str, Any]:
    env = yahoo.search(a["query"])
    return {"matches": [h.model_dump() for h in env.data[:6]], **_meta(env)}


PROFILE_FIELDS = (
    "name", "quote_type", "exchange", "currency", "financial_currency", "country", "sector",
    "industry", "price", "change_pct", "market_cap", "trailing_pe", "forward_pe", "ev_to_ebitda",
    "price_to_book", "dividend_yield", "beta", "revenue_ttm", "gross_margin", "operating_margin",
    "profit_margin", "return_on_equity", "debt_to_equity", "free_cash_flow", "low_52w", "high_52w",
    "target_mean_price", "recommendation",
)  # fmt: skip


def _profile(a: dict[str, Any]) -> dict[str, Any]:
    env = yahoo.profile(a["symbol"].upper())
    p = env.data.model_dump()
    return {"symbol": env.data.symbol, **{k: p[k] for k in PROFILE_FIELDS}, **_meta(env)}


PERIOD_DAYS = {"1M": 21, "3M": 63, "6M": 126, "1Y": 252, "3Y": 756, "5Y": 1260}


def _history(a: dict[str, Any]) -> dict[str, Any]:
    env = yahoo.history(a["symbol"].upper(), "daily")
    bars = env.data.bars[-(PERIOD_DAYS[a["period"]] + 1) :]
    closes = [b.close for b in bars]
    rets = [c1 / c0 - 1 for c0, c1 in itertools.pairwise(closes)]
    mean = sum(rets) / len(rets) if rets else 0.0
    vol = (sum((r - mean) ** 2 for r in rets) / max(1, len(rets) - 1)) ** 0.5 * 252**0.5
    peak, drawdown = closes[0], 0.0
    for c in closes:
        peak = max(peak, c)
        drawdown = min(drawdown, c / peak - 1)
    step = max(1, len(bars) // 20)
    return {
        "symbol": env.data.symbol,
        "currency": env.data.currency,
        "start": {"date": bars[0].time, "close": round(closes[0], 4)},
        "end": {"date": bars[-1].time, "close": round(closes[-1], 4)},
        "total_return": round(closes[-1] / closes[0] - 1, 4),
        "high": round(max(b.high for b in bars), 4),
        "low": round(min(b.low for b in bars), 4),
        "annualised_volatility": round(vol, 4),
        "max_drawdown": round(drawdown, 4),
        "sampled_closes": [[b.time, round(b.close, 2)] for b in bars[::step]],
        "note": "Closes are split-adjusted, not dividend-adjusted.",
        **_meta(env),
    }


def _financials(a: dict[str, Any]) -> dict[str, Any]:
    env = yahoo.financials(a["symbol"].upper(), a["statement"], a["period"])
    s = env.data
    return {
        "currency": s.currency,
        "periods": s.periods[-4:],
        "rows": {r.label: r.values[-4:] for r in s.rows},
        **_meta(env),
    }


def _earnings(a: dict[str, Any]) -> dict[str, Any]:
    env = research.earnings(a["symbol"].upper())
    e = env.data
    return {
        "next_report": e.next_date,
        "eps_currency": e.currency,
        "recent_quarters": [h.model_dump() for h in e.history if h.eps_actual is not None][-6:],
        "revenue_estimates": [x.model_dump() for x in e.revenue_estimates],
        "eps_estimates": [x.model_dump() for x in e.eps_estimates],
        **_meta(env),
    }


def _news(a: dict[str, Any]) -> dict[str, Any]:
    env = yahoo.news(a["symbol"].upper() or None)
    return {
        "headlines": [
            {
                "title": h.title,
                "published": h.published_at.isoformat() if h.published_at else None,
                "link": h.link,
            }
            for h in env.data[:8]
        ],
        **_meta(env),
    }


def _quotes(a: dict[str, Any]) -> dict[str, Any]:
    env = yahoo.quotes(tuple(dict.fromkeys(s.upper() for s in a["symbols"][:10])))
    return {
        "quotes": [{k: v for k, v in q.model_dump().items() if k != "spark"} for q in env.data],
        **_meta(env),
    }


def _curve(a: dict[str, Any]) -> dict[str, Any]:
    env = rates.us_curve() if a["region"] == "US" else rates.ea_curve("AAA")
    c = env.data
    return {
        "curve": c.name,
        "basis": c.basis,
        "tenors": c.tenors,
        "snapshots": [
            {"label": s.label, "date": s.date, "yields_pct": s.yields} for s in c.snapshots
        ],
        **_meta(env),
    }


def _sovereign(a: dict[str, Any]) -> dict[str, Any]:
    wanted = tuple(c.upper() for c in a["countries"] if c.upper() != "DE")[:8] or ("IT",)
    env = rates.sovereign_10y(wanted)
    d = env.data
    n = len(d.months)
    return {
        "latest_month": d.months[-1],
        "countries": [
            {
                "country": s.name,
                "yield_10y_pct": s.yields[-1],
                "spread_bp": s.spread_bp[-1],
                "spread_bp_12m_ago": s.spread_bp[n - 13] if n > 12 else None,
            }
            for s in d.series
        ],
        **_meta(env),
    }


def _macro(a: dict[str, Any]) -> dict[str, Any]:
    env = macro.series(a["series_id"].upper())
    s = env.data
    return {
        "title": s.title,
        "units": s.units,
        "frequency": s.frequency,
        "transform": s.transform,
        "latest": [[o.date, o.value] for o in s.observations[-24:]],
        **_meta(env),
    }


def _fx(a: dict[str, Any]) -> dict[str, Any]:
    env = fx.pair_history(a["base"].upper(), a["quote"].upper())
    pts = env.data.points

    def back(days: int) -> float | None:
        target = date.fromisoformat(pts[-1].date).toordinal() - days
        older = [p for p in pts if date.fromisoformat(p.date).toordinal() <= target]
        return older[-1].rate if older else None

    last = pts[-1].rate
    m1, y1 = back(30), back(365)
    return {
        "pair": f"{env.data.base}/{env.data.quote}",
        "rate": last,
        "date": pts[-1].date,
        "change_1m": round(last / m1 - 1, 4) if m1 else None,
        "change_1y": round(last / y1 - 1, 4) if y1 else None,
        **_meta(env),
    }


def _screen(a: dict[str, Any]) -> dict[str, Any]:
    from tessera import screener  # imported lazily: it pulls in the screener's yfinance glue

    env = screener.run(" ".join(a["query"].split()))
    r = env.data
    return {
        "query": r.query,
        "total_matches": r.total,
        "rows": [x.model_dump() for x in r.rows[:15]],
        "warnings": r.warnings,
        **_meta(env),
    }


HANDLERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "search_securities": _search,
    "get_profile": _profile,
    "get_price_history": _history,
    "get_financials": _financials,
    "get_earnings": _earnings,
    "get_news": _news,
    "get_quotes": _quotes,
    "get_yield_curve": _curve,
    "get_sovereign_spreads": _sovereign,
    "get_macro_series": _macro,
    "get_fx_rate": _fx,
    "screen_equities": _screen,
}


# ── The agent loop ────────────────────────────────────────────────────────────


class ToolCall(BaseModel):
    tool: str
    input: dict[str, Any]
    ok: bool
    source: str | None
    as_of: str | None
    error: str | None


class Answer(BaseModel):
    question: str
    answer: str
    model: str
    steps: int
    stop_reason: str
    tool_calls: list[ToolCall]
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int


def run_tool(name: str, tool_input: dict[str, Any]) -> tuple[str, ToolCall]:
    """Execute one tool; return (JSON result for the model, trace entry)."""
    handler = HANDLERS.get(name)
    try:
        if handler is None:
            raise TesseraError(f"Unknown tool {name}")
        result = handler(tool_input)
        call = ToolCall(
            tool=name,
            input=tool_input,
            ok=True,
            source=result.get("source"),
            as_of=result.get("as_of"),
            error=None,
        )
        return json.dumps(result, default=str, separators=(",", ":")), call
    except Exception as exc:  # every failure goes back to the model as an error result
        message = str(exc) if isinstance(exc, TesseraError) else f"{type(exc).__name__}: {exc}"
        return message, ToolCall(
            tool=name, input=tool_input, ok=False, source=None, as_of=None, error=message
        )


def _sdk() -> Any:
    try:
        import anthropic
    except ImportError as exc:
        raise ConfigurationError(
            "ASK needs the `anthropic` package (pip install anthropic)."
        ) from exc
    return anthropic


def _client() -> Any:
    try:
        return _sdk().Anthropic()
    except ConfigurationError:
        raise
    except Exception as exc:  # no credentials found by the SDK
        raise ConfigurationError(NO_CREDENTIALS) from exc


def ask(question: str, security: str | None = None, client: Any = None) -> Envelope[Answer]:
    anthropic = _sdk()
    client = client or _client()
    context = f" The user is currently looking at {security}." if security else ""
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": f"Today is {date.today().isoformat()}.{context}\n\n{question}"}
    ]
    trace: list[ToolCall] = []
    usage = {"input": 0, "output": 0, "cache": 0}
    response: Any = None
    steps = 0
    for steps in range(1, MAX_STEPS + 2):
        if steps == MAX_STEPS + 1:
            # Out of tool budget: ask for the best answer from what has been gathered.
            messages.append(
                {
                    "role": "system",
                    "content": "Tool budget used up. Answer now from the results above; say what is missing.",
                }
            )
        try:
            response = client.beta.messages.create(
                model=MODEL,
                max_tokens=16000,
                # Stable prefix (tools + system) is cached across the loop's requests.
                system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
                tools=TOOLS,
                messages=messages,
                output_config={"effort": "medium"},
                betas=[FALLBACK_BETA],
                fallbacks="default",
            )
        except TypeError as exc:
            # SDK 1.x resolves credentials lazily: with none configured, the first request
            # raises TypeError("Could not resolve authentication method…").
            if "authentication" not in str(exc):
                raise
            raise ConfigurationError(NO_CREDENTIALS) from exc
        except anthropic.AuthenticationError as exc:
            raise ConfigurationError(
                "Anthropic rejected the API key; check ANTHROPIC_API_KEY."
            ) from exc
        except anthropic.RateLimitError as exc:
            raise UpstreamError("Anthropic API rate limit reached; try again in a minute.") from exc
        except anthropic.APIStatusError as exc:
            raise UpstreamError(f"Anthropic API error {exc.status_code}: {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise UpstreamError("Could not reach the Anthropic API.") from exc

        u = response.usage
        usage["input"] += u.input_tokens or 0
        usage["output"] += u.output_tokens or 0
        usage["cache"] += getattr(u, "cache_read_input_tokens", 0) or 0
        if response.stop_reason == "refusal":
            break
        # Append the whole content (thinking and fallback blocks included), unchanged.
        messages.append({"role": "assistant", "content": response.content})
        uses = [b for b in response.content if b.type == "tool_use"]
        if response.stop_reason != "tool_use" or not uses or steps > MAX_STEPS:
            break
        with ThreadPoolExecutor(max_workers=6) as pool:
            outcomes = list(pool.map(lambda b: run_tool(b.name, dict(b.input)), uses))
        results = []
        for block, (content, call) in zip(uses, outcomes, strict=True):
            trace.append(call)
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": content,
                    "is_error": not call.ok,
                }
            )
        messages.append({"role": "user", "content": results})  # all results in one message

    if response is None:
        raise UpstreamError("No response from the model")
    if response.stop_reason == "refusal":
        text = "The model declined to answer this question."
    else:
        text = "\n\n".join(b.text for b in response.content if b.type == "text").strip()
        if not text and response.stop_reason == "tool_use":
            text = "The question needed more data lookups than one answer allows; try narrowing it."
        if response.stop_reason == "max_tokens":
            text += "\n\n(Answer cut off at the length limit.)"
    sources = sorted({c.source for c in trace if c.source})
    return Envelope(
        data=Answer(
            question=question,
            answer=text or "(no answer)",
            model=getattr(response, "model", MODEL),
            steps=steps,
            stop_reason=str(response.stop_reason),
            tool_calls=trace,
            input_tokens=usage["input"],
            output_tokens=usage["output"],
            cache_read_tokens=usage["cache"],
        ),
        meta=Provenance(
            source="Claude via Anthropic API · "
            + (", ".join(sources) if sources else "no tools used"),
            freshness="delayed",
            as_of=datetime.now(UTC),
            notes=[
                "Generated text: check each figure against its cited source (the trace lists every tool call)."
            ],
        ),
    )
