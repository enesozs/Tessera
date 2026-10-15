"""HTTP API for the terminal. Thin: validates input, calls providers, returns envelopes.

Provider functions are synchronous (yfinance and httpx are blocking), so every route is a
plain `def`; FastAPI runs them in its threadpool.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from tessera import dcf, markets, options, valuation
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


@app.get("/api/options/chain")
def option_chain(
    symbol: Symbol, expiry: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}-\d{2}$")] = None
) -> Envelope[options.OptionChainView]:
    return options.option_chain(symbol.upper(), expiry)


@app.get("/api/options/surface")
def option_surface(symbol: Symbol) -> Envelope[options.VolSurfaceView]:
    return options.vol_surface(symbol.upper())


# ── Markets ───────────────────────────────────────────────────────────────────


@app.get("/api/quotes")
def quotes(
    symbols: Annotated[str, Query(min_length=1, max_length=600)],
) -> Envelope[list[yahoo.Quote]]:
    wanted = tuple(dict.fromkeys(s.strip().upper() for s in symbols.split(",") if s.strip()))
    return yahoo.quotes(wanted[:40])


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

DIST = Path(__file__).resolve().parents[3] / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        file = (DIST / path).resolve()
        inside = file.is_relative_to(DIST.resolve())
        return FileResponse(file if inside and file.is_file() else DIST / "index.html")
