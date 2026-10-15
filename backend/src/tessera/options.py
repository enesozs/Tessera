"""Equity options: chain monitor (OMON) and implied-volatility smile/term structure (IVOL).

Quotes come from Yahoo; every number derived from them is computed with `derivlab`, the
pricing library from QuantProjects/05:

* the forward and discount factor come from put–call parity (`derivlab.data.cleaning`),
* implied volatilities from its Brent solver on Black–Scholes (`calibration.implied_vol`),
* Greeks from its analytic engine,
* smiles from its SVI fit (`calibration.svi`).

Yahoo's own `impliedVolatility` column is returned alongside ours for comparison: it uses its
own (undisclosed) rate and dividend assumptions.

U.S. single-stock options are American. Out-of-the-money American options are worth almost the
same as European ones, so the European model is the standard approximation for smiles; it is
less accurate for deep in-the-money puts, which the UI notes.
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime
from typing import Any, Literal

import numpy as np
import yfinance as yf
from derivlab import AnalyticEngine, BlackScholes, European, Market, PlainVanilla, VanillaOption
from derivlab.calibration.implied_vol import implied_volatility
from derivlab.calibration.svi import fit_svi
from derivlab.data.chain import ExpirySlice, OptionChain, OptionQuote
from derivlab.data.cleaning import clean_chain
from derivlab.data.yahoo import fetch_chain

from tessera.cache import cached
from tessera.errors import NotFoundError, UpstreamError
from tessera.models import Envelope, Provenance
from tessera.option_models import (
    ChainRow,
    ChainTotals,
    OptionChainView,
    OptionLeg,
    SmilePoint,
    SmileSlice,
    VolSurfaceView,
)
from tessera.providers import rates, yahoo
from tessera.providers.yahoo import _num

ENGINE = AnalyticEngine()
EUROPEAN_NOTE = (
    "Greeks and IVs from Black–Scholes on the parity forward (derivlab); U.S. equity options "
    "are American, so deep in-the-money values are approximate."
)


# ── Chain (OMON) ──────────────────────────────────────────────────────────────


def leg_price(bid: float | None, ask: float | None, last: float | None) -> tuple[float, str] | None:
    """Mid when there is a sane two-sided quote, else the last trade."""
    if bid and ask and bid > 0 and ask >= bid and (ask - bid) / (0.5 * (ask + bid)) <= 0.5:
        return 0.5 * (bid + ask), "mid"
    if last and last > 0:
        return last, "last"
    return None


def analyse_leg(
    kind: Literal["call", "put"], strike: float, price: float, t: float, market: Market
) -> tuple[float | None, Any]:
    """(implied vol, greeks) for one quote, or (None, None) if no volatility fits the price."""
    option = VanillaOption(PlainVanilla(kind, strike), European(t))
    try:
        vol = implied_volatility(price, option, market).volatility
    except ValueError:
        return None, None
    if not 0.005 <= vol <= 5.0:
        return None, None
    return vol, ENGINE.price(option, market, BlackScholes(vol)).greeks


def _expiries(ticker: yf.Ticker) -> list[str]:
    try:
        return list(ticker.options)
    except Exception as exc:
        raise UpstreamError(f"Yahoo option expiries failed: {exc}") from exc


@cached(ttl=90)
def option_chain(symbol: str, expiry: str | None = None) -> Envelope[OptionChainView]:
    ticker = yf.Ticker(symbol)
    expiries = _expiries(ticker)
    if not expiries:
        raise NotFoundError(f"'{symbol}' has no listed options on Yahoo Finance")
    today = date.today()
    if expiry not in expiries:
        # Default: the first expiry at least a week out (weeklies expiring today are noise).
        expiry = next(
            (e for e in expiries if (date.fromisoformat(e) - today).days >= 7), expiries[-1]
        )
    try:
        raw = ticker.option_chain(expiry)
    except Exception as exc:
        raise UpstreamError(f"Yahoo option chain failed: {exc}") from exc

    p = yahoo.profile(symbol).data
    spot = p.price or 0.0
    if spot <= 0:
        raise NotFoundError(f"No price for '{symbol}'")
    now = datetime.now(UTC)
    exp_date = date.fromisoformat(expiry)

    frames = {"call": raw.calls, "put": raw.puts}
    records: dict[str, list[dict[str, Any]]] = {
        kind: [
            r
            for r in frame.to_dict("records")
            if 0.4 * spot <= (_num(r.get("strike")) or 0) <= 1.6 * spot
        ]
        for kind, frame in frames.items()
    }
    quotes = [
        OptionQuote(
            kind=kind,  # type: ignore[arg-type]
            strike=float(r["strike"]),
            bid=_num(r.get("bid")),
            ask=_num(r.get("ask")),
            last=_num(r.get("lastPrice")),
            volume=_num(r.get("volume")),
            open_interest=_num(r.get("openInterest")),
            last_trade=r["lastTradeDate"].to_pydatetime().astimezone(UTC).isoformat()
            if r.get("lastTradeDate") is not None
            else None,
        )
        for kind, rows in records.items()
        for r in rows
    ]
    chain = OptionChain(symbol, spot, now, (ExpirySlice(exp_date, tuple(quotes)),), "yahoo")
    t = max(chain.year_fraction(exp_date), 1 / 365)
    r, _ = rates.risk_free_rate(t)

    forward, method = spot * math.exp(r * t), "carry (no parity fit)"
    try:
        sliced = clean_chain(chain, rate=r, min_points=3).slices
        if sliced and sliced[0].forward_method == "parity":
            forward, method = sliced[0].forward, "put–call parity"
    except ValueError:
        pass
    q = r - math.log(forward / spot) / t
    market = Market(spot, r, q)

    def leg(kind: Literal["call", "put"], rec: dict[str, Any]) -> OptionLeg:
        strike = float(rec["strike"])
        bid, ask, last = _num(rec.get("bid")), _num(rec.get("ask")), _num(rec.get("lastPrice"))
        priced = leg_price(bid, ask, last)
        iv, greeks = (None, None)
        if priced:
            iv, greeks = analyse_leg(kind, strike, priced[0], t, market)
        trade = rec.get("lastTradeDate")
        return OptionLeg(
            contract=str(rec.get("contractSymbol", "")),
            bid=bid,
            ask=ask,
            last=last,
            volume=_num(rec.get("volume")),
            open_interest=_num(rec.get("openInterest")),
            last_trade=trade.to_pydatetime().astimezone(UTC) if trade is not None else None,
            in_the_money=bool(rec.get("inTheMoney")),
            price=priced[0] if priced else None,
            price_source=priced[1] if priced else None,  # type: ignore[arg-type]
            iv=iv,
            yahoo_iv=_num(rec.get("impliedVolatility")),
            delta=greeks.delta if greeks else None,
            gamma=greeks.gamma if greeks else None,
            theta_per_day=greeks.theta / 365 if greeks else None,
            vega_per_point=greeks.vega / 100 if greeks else None,
        )

    by_strike: dict[float, dict[str, OptionLeg]] = {}
    for kind in ("call", "put"):
        for rec in records[kind]:
            by_strike.setdefault(float(rec["strike"]), {})[kind] = leg(kind, rec)  # type: ignore[arg-type]
    rows = [
        ChainRow(strike=k, call=v.get("call"), put=v.get("put"))
        for k, v in sorted(by_strike.items())
    ]
    if not rows:
        raise NotFoundError(f"No strikes near the money for {symbol} {expiry}")

    def total(kind: str, field: str) -> float:
        return sum(getattr(getattr(r, kind), field) or 0 for r in rows if getattr(r, kind))

    cv, pv = total("call", "volume"), total("put", "volume")
    co, po = total("call", "open_interest"), total("put", "open_interest")
    return Envelope(
        data=OptionChainView(
            symbol=symbol,
            currency=p.currency,
            spot=spot,
            expiries=expiries,
            expiry=expiry,
            days=(exp_date - today).days,
            t=t,
            rate=r,
            dividend_yield=q,
            forward=forward,
            forward_method=method,
            atm_strike=min(rows, key=lambda row: abs(row.strike - forward)).strike,
            rows=rows,
            totals=ChainTotals(
                call_volume=cv,
                put_volume=pv,
                call_open_interest=co,
                put_open_interest=po,
                put_call_volume=pv / cv if cv else None,
                put_call_open_interest=po / co if co else None,
            ),
        ),
        meta=Provenance(
            source="Yahoo Finance quotes · derivlab analytics",
            source_url=f"https://finance.yahoo.com/quote/{symbol}/options",
            freshness="delayed",
            as_of=max(
                (
                    leg.last_trade
                    for row in rows
                    for leg in (row.call, row.put)
                    if leg and leg.last_trade
                ),
                default=None,
            ),
            notes=[
                EUROPEAN_NOTE,
                "Bid/ask are blank outside U.S. market hours; last trades are then used.",
            ],
        ),
    )


# ── Smile & term structure (IVOL) ─────────────────────────────────────────────


def realized_vol(closes: list[float], window: int) -> float | None:
    """Annualised close-to-close volatility of the last `window` daily log returns."""
    if len(closes) < window + 1:
        return None
    x = np.log(np.asarray(closes[-window - 1 :], dtype=float))
    return float(np.std(np.diff(x), ddof=1) * math.sqrt(252))


def smile_slice(s: Any) -> SmileSlice:
    """Summarise one derivlab CleanSlice and fit SVI to it (if it has enough points)."""
    ks = [p.log_moneyness for p in s.points]
    vols = [p.implied_vol for p in s.points]
    fit_strikes: list[float] = []
    fit_iv: list[float] = []
    rmse = skew = None
    butterfly = False
    if len(ks) >= 5:
        try:
            fit = fit_svi(ks, vols, s.t)
            grid = np.linspace(min(ks), max(ks), 41)
            fit_strikes = [float(s.forward * math.exp(k)) for k in grid]
            fit_iv = [float(v) for v in fit.params.implied_vol(grid, s.t)]
            rmse = fit.rmse
            butterfly = bool(fit.butterfly_violations)
            lo, hi = math.log(0.9), math.log(1.1)
            if min(ks) <= lo and max(ks) >= hi:
                iv = fit.params.implied_vol([lo, hi], s.t)
                skew = float(iv[0] - iv[1])
        except ValueError:
            pass
    return SmileSlice(
        expiry=s.expiry.isoformat(),
        days=(s.expiry - date.today()).days,
        t=s.t,
        forward=s.forward,
        atm_vol=s.atm_vol,
        points=[
            SmilePoint(
                strike=p.strike,
                log_moneyness=p.log_moneyness,
                iv=p.implied_vol,
                kind=p.kind,
                source=p.price_source,
            )
            for p in s.points
        ],
        fit_strikes=fit_strikes,
        fit_iv=fit_iv,
        rmse=rmse,
        butterfly_arbitrage=butterfly,
        skew_90_110=skew,
        dropped=dict(s.dropped),
    )


@cached(ttl=900)
def vol_surface(symbol: str) -> Envelope[VolSurfaceView]:
    try:
        chain = fetch_chain(symbol, max_expiries=8, min_days=5)
    except ValueError as exc:
        raise NotFoundError(str(exc)) from exc
    except Exception as exc:
        raise UpstreamError(f"Yahoo option chains failed: {exc}") from exc
    r, rate_label = rates.risk_free_rate(0.5)
    try:
        data = clean_chain(chain, rate=r)
    except ValueError as exc:
        raise NotFoundError(f"Not enough clean option quotes for {symbol}: {exc}") from exc

    closes: list[float] = []
    try:
        closes = [b.close for b in yahoo.history(symbol, "daily").data.bars]
    except Exception:
        closes = []
    return Envelope(
        data=VolSurfaceView(
            symbol=symbol,
            spot=data.spot,
            price_basis=data.price_basis,
            rate=r,
            slices=[smile_slice(s) for s in data.slices],
            realized_vol_30d=realized_vol(closes, 21),
            realized_vol_90d=realized_vol(closes, 63),
        ),
        meta=Provenance(
            source="Yahoo Finance quotes · derivlab cleaning & SVI",
            source_url=f"https://finance.yahoo.com/quote/{symbol}/options",
            freshness="delayed",
            as_of=data.as_of,
            notes=[
                "Out-of-the-money options only; forwards from put–call parity; SVI fit per expiry.",
                f"Discounting at {rate_label}.",
            ],
        ),
    )
