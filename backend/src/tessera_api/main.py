"""HTTP API for the terminal. Thin: validates input, calls providers, returns envelopes.

Provider functions are synchronous (yfinance and httpx are blocking), so every route is a
plain `def`; FastAPI runs them in its threadpool.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, Query, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from tessera import (
    curves,
    dcf,
    fixed_income,
    markets,
    option_models,
    portfolio,
    screener,
    valuation,
)
from tessera.errors import (
    ConfigurationError,
    NotApplicableError,
    NotFoundError,
    TesseraError,
    UpstreamError,
)
from tessera.models import Envelope
from tessera.providers import fx, macro, rates, research, sec, yahoo

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="Tessera API",
    version="0.1.0",
    description="Free public market data, normalised and annotated with provenance.",
)

# Ten years of daily bars is ~250 kB of JSON; compression cuts that by ~80%.
app.add_middleware(GZipMiddleware, minimum_size=2048)


class RateLimiter:
    """Token bucket per client address: `per_minute` requests, refilled continuously.

    Every API call can fan out to several free upstream providers, so a public deployment must
    not let one client exhaust their quotas. 0 disables the limit.
    """

    def __init__(self, per_minute: int) -> None:
        self.per_minute = per_minute
        self._buckets: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        if self.per_minute <= 0:
            return True
        now = time.monotonic()
        with self._lock:
            tokens, last = self._buckets.get(key, (float(self.per_minute), now))
            tokens = min(self.per_minute, tokens + (now - last) * self.per_minute / 60)
            allowed = tokens >= 1
            self._buckets[key] = (tokens - 1 if allowed else tokens, now)
            return allowed


app.state.limiter = RateLimiter(int(os.environ.get("TESSERA_RATE_LIMIT", "300")))


@app.middleware("http")
async def guard(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.url.path != "/api/health":
        client = request.client.host if request.client else "unknown"
        if not request.app.state.limiter.allow(client):
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too many requests — slow down a little.",
                    "kind": "RateLimited",
                },
                headers={"Retry-After": "10"},
            )
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


Symbol = Annotated[str, Query(min_length=1, max_length=24, pattern=r"^[\w.\-=^]+$")]
Currency = Annotated[str, Query(pattern=r"^[A-Z]{3}$")]


@app.exception_handler(TesseraError)
def handle_tessera_error(_: Request, exc: TesseraError) -> JSONResponse:
    status = {
        NotFoundError: 404,
        NotApplicableError: 422,
        ConfigurationError: 503,
        UpstreamError: 502,
    }.get(type(exc), 500)
    return JSONResponse(
        status_code=status, content={"detail": str(exc), "kind": type(exc).__name__}
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ── Securities ────────────────────────────────────────────────────────────────


@app.get("/api/search")
def search(
    q: Annotated[str, Query(min_length=1, max_length=64)],
) -> Envelope[list[yahoo.SecurityHit]]:
    return yahoo.search(q.strip())


@app.get("/api/securities/profile")
def profile(symbol: Symbol) -> Envelope[yahoo.Profile]:
    return yahoo.profile(symbol.upper())


@app.get("/api/securities/history")
def history(symbol: Symbol, span: yahoo.Span = "daily") -> Envelope[yahoo.History]:
    return yahoo.history(symbol.upper(), span)


@app.get("/api/securities/financials")
def financials(
    symbol: Symbol,
    statement: yahoo.Statement = "income",
    period: yahoo.Period = "annual",
) -> Envelope[yahoo.Statements]:
    return yahoo.financials(symbol.upper(), statement, period)


@app.get("/api/securities/filings")
def filings(symbol: Symbol) -> Envelope[sec.Filings]:
    return sec.filings(symbol.upper())


@app.get("/api/news")
def news(
    symbol: Annotated[str | None, Query(max_length=24)] = None,
) -> Envelope[list[yahoo.Headline]]:
    return yahoo.news(symbol.upper() if symbol else None)


@app.get("/api/securities/earnings")
def earnings(symbol: Symbol) -> Envelope[research.Earnings]:
    return research.earnings(symbol.upper())


@app.get("/api/securities/dividends")
def dividends(symbol: Symbol) -> Envelope[research.Dividends]:
    return research.dividends(symbol.upper())


# ── Valuation ─────────────────────────────────────────────────────────────────


def _symbols(raw: str | None) -> tuple[str, ...]:
    return tuple(dict.fromkeys(s.strip().upper() for s in (raw or "").split(",") if s.strip()))


@app.get("/api/valuation/dcf/inputs")
def dcf_inputs(symbol: Symbol) -> Envelope[valuation.DcfInputs]:
    return valuation.dcf_inputs(symbol.upper())


class DcfRequest(BaseModel):
    symbol: str
    assumptions: dcf.DcfAssumptions


@app.post("/api/valuation/dcf")
def dcf_value(request: DcfRequest) -> Envelope[valuation.DcfResult]:
    return valuation.dcf_value(request.symbol.upper(), request.assumptions)


@app.get("/api/valuation/comps")
def comps(
    symbol: Symbol, peers: Annotated[str | None, Query(max_length=200)] = None
) -> Envelope[valuation.Comps]:
    return valuation.comps(symbol.upper(), _symbols(peers)[:12])


# ── Options ───────────────────────────────────────────────────────────────────


def _options():
    """Option analytics need derivlab (project 05); without it, say so instead of crashing."""
    try:
        from tessera import options
    except ImportError as exc:
        raise ConfigurationError(
            "Option analytics (OMON, IVOL) use derivlab from QuantProjects/05. "
            "Run `make install` with the sibling project present, then restart the API."
        ) from exc
    return options


@app.get("/api/options/chain")
def option_chain(
    symbol: Symbol, expiry: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}-\d{2}$")] = None
) -> Envelope[option_models.OptionChainView]:
    return _options().option_chain(symbol.upper(), expiry)


@app.get("/api/options/surface")
def option_surface(symbol: Symbol) -> Envelope[option_models.VolSurfaceView]:
    return _options().vol_surface(symbol.upper())


@app.post("/api/portfolio/analyze")
def analyze_portfolio(request: portfolio.PortfolioRequest) -> Envelope[portfolio.PortfolioAnalysis]:
    return portfolio.analyse(request)


# ── Markets ───────────────────────────────────────────────────────────────────


@app.get("/api/quotes")
def quotes(
    symbols: Annotated[str, Query(min_length=1, max_length=600)],
) -> Envelope[list[yahoo.Quote]]:
    wanted = tuple(dict.fromkeys(s.strip().upper() for s in symbols.split(",") if s.strip()))
    return yahoo.quotes(wanted[:40])


@app.get("/api/screen")
def screen(
    q: Annotated[str, Query(min_length=3, max_length=600)],
) -> Envelope[screener.ScreenResult]:
    return screener.run(" ".join(q.split()))


@app.get("/api/screen/fields")
def screen_fields() -> list[screener.FieldInfo]:
    return screener.fields()


@app.get("/api/movers")
def movers(kind: research.MoverKind = "gainers") -> Envelope[list[research.Mover]]:
    return research.movers(kind)


@app.get("/api/monitors/{monitor_id}")
def monitor(monitor_id: Literal["WEI", "CMDTY"]) -> Envelope[markets.Monitor]:
    return markets.monitor(monitor_id)


# ── Rates, FX, macro ──────────────────────────────────────────────────────────


@app.get("/api/rates/curve")
def curve(
    region: Literal["US", "EA"] = "US", issuers: Literal["AAA", "ALL"] = "AAA"
) -> Envelope[rates.YieldCurve]:
    return rates.us_curve() if region == "US" else rates.ea_curve(issuers)


@app.get("/api/rates/curve-analytics")
def curve_analytics(
    region: Literal["US", "EA"] = "US", issuers: Literal["AAA", "ALL"] = "AAA"
) -> Envelope[curves.CurveAnalytics]:
    return fixed_income.curve_analytics(region, issuers)


@app.post("/api/bonds/analyze")
def analyze_bond(request: fixed_income.BondRequest) -> Envelope[fixed_income.BondAnalysis]:
    return fixed_income.analyze(request)


@app.get("/api/rates/sovereign")
def sovereign(countries: str = "IT,FR,ES") -> Envelope[rates.SovereignYields]:
    wanted = tuple(dict.fromkeys(c.strip().upper() for c in countries.split(",") if c.strip()))
    return rates.sovereign_10y(wanted)


@app.get("/api/fx/matrix")
def fx_matrix(currencies: str = "USD,EUR,GBP,JPY,CHF,CAD,AUD,CNY,TRY") -> Envelope[fx.FxMatrix]:
    wanted = tuple(dict.fromkeys(c.strip().upper() for c in currencies.split(",") if c.strip()))
    return fx.matrix(wanted[:12])


@app.get("/api/fx/history")
def fx_history(base: Currency, quote: Currency) -> Envelope[fx.FxHistory]:
    return fx.pair_history(base, quote)


@app.get("/api/macro/dashboard")
def macro_dashboard() -> Envelope[list[macro.MacroSummary]]:
    return macro.dashboard()


@app.get("/api/macro/series")
def macro_series(
    id: Annotated[str, Query(min_length=2, max_length=48)],
) -> Envelope[macro.MacroSeries]:
    return macro.series(id.upper())


# ── Built frontend (single-process mode: `make serve`) ────────────────────────

DIST = Path(
    os.environ.get("TESSERA_STATIC_DIR")
    or Path(__file__).resolve().parents[3] / "frontend" / "dist"
)
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        file = (DIST / path).resolve()
        inside = file.is_relative_to(DIST.resolve())
        return FileResponse(file if inside and file.is_file() else DIST / "index.html")
