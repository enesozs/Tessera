"""Portfolio analytics (PORT): holdings → value, exposures, risk, VaR/ES, stress, optimisation.

Every holding is converted into the base currency day by day (ECB reference rates), using
dividend-adjusted closes so returns are total returns. Risk statistics use the common history
of all holdings over the look-back window; historical stress scenarios use the full ten years
available and fall back to a beta proxy for holdings that did not trade yet.
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Literal, cast

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from tessera import risk
from tessera.errors import NotApplicableError, NotFoundError
from tessera.models import Envelope, Provenance
from tessera.providers import fx, rates, yahoo


class Holding(BaseModel):
    symbol: str = Field(min_length=1, max_length=24, pattern=r"^[\w.\-=^]+$")
    shares: float = Field(gt=0)


class PortfolioRequest(BaseModel):
    holdings: list[Holding] = Field(min_length=1, max_length=40)
    base: str = Field("USD", pattern=r"^[A-Z]{3}$")
    benchmark: str = Field("^GSPC", pattern=r"^[\w.\-=^]+$")
    lookback_years: Literal[1, 2, 3, 5] = 3
    confidence: float = Field(0.95, ge=0.9, le=0.995)


class Position(BaseModel):
    symbol: str
    name: str
    sector: str | None
    country: str | None
    currency: str
    shares: float
    price: float
    value: float  # base currency
    weight: float
    period_return: float  # over the look-back, base currency, total return
    volatility: float  # annualised
    beta: float
    risk_share: float  # share of portfolio volatility (Euler)


class VarRow(BaseModel):
    method: str
    var_pct: float
    es_pct: float
    var_amount: float
    es_amount: float
    var_10d_amount: float  # √10 scaling


class Exposure(BaseModel):
    name: str
    weight: float


class StressRow(BaseModel):
    name: str
    start: str
    end: str
    portfolio_return: float
    pnl: float
    benchmark_return: float | None
    proxied: list[str]


class Optimised(BaseModel):
    name: str
    weights: dict[str, float]
    volatility: float
    expected_return: float
    sharpe: float
    effective_n: float
    max_drawdown: float


class PortfolioAnalysis(BaseModel):
    base: str
    benchmark: str
    value: float
    start: str
    end: str
    days: int
    rf: float
    positions: list[Position]
    excluded: dict[str, str]
    stats: dict[str, float | None]
    var: list[VarRow]
    confidence: float
    exposures: dict[str, list[Exposure]]
    correlation: dict[str, list]
    shrinkage: float
    diversification: dict[str, float]
    stress: list[StressRow]
    shocks: list[dict[str, float | str]]
    performance: dict[str, list]
    optimised: list[Optimised]


# Historical episodes inside the ten years of daily history the terminal keeps.
SCENARIOS = [
    ("COVID crash", "2020-02-19", "2020-03-23"),
    ("2022 rates shock", "2022-01-03", "2022-10-12"),
    ("SVB / regional banks", "2023-03-08", "2023-03-15"),
    ("Yen carry unwind", "2024-07-31", "2024-08-05"),
    ("April 2025 tariff shock", "2025-04-02", "2025-04-08"),
]


def _base_prices(symbol: str, base: str, fx_cache: dict[str, pd.Series]) -> tuple[pd.Series, str]:
    """Daily dividend-adjusted closes of `symbol` converted into `base`, and its quote currency."""
    h = yahoo.history(symbol, "daily").data
    closes = pd.Series(
        {pd.Timestamp(b.time): (b.adj_close or b.close) for b in h.bars}, dtype=float
    ).sort_index()
    ccy = h.currency or "USD"
    major, divisor = fx.normalise_currency(ccy)
    if major != base:
        if major not in fx_cache:
            points = fx.pair_history(major, base, years=11).data.points
            fx_cache[major] = pd.Series({pd.Timestamp(p.date): p.rate for p in points}).sort_index()
        rate = fx_cache[major].reindex(closes.index, method="ffill")
        closes = closes * rate
    return (closes / divisor).dropna(), ccy


def _risk_free(base: str) -> float:
    if base == "EUR":
        c = rates.ea_curve("AAA").data
        y = c.snapshots[0].yields[c.tenors.index("1Y")]
        if y is not None:
            return y / 100
    return math.exp(rates.risk_free_rate(1.0)[0]) - 1


def _window_return(series: pd.Series, start: str, end: str) -> float | None:
    """Return from the last close on/before `start` to the last close on/before `end`."""
    stamps = series.index.to_numpy()
    values = series.to_numpy(dtype=float)
    s0, s1 = np.datetime64(start), np.datetime64(end)
    i = int(np.searchsorted(stamps, s0, side="right")) - 1
    j = int(np.searchsorted(stamps, s1, side="right")) - 1
    # No price within a week before the start: the security was not trading yet.
    if i < 0 or j < 0 or stamps[i] < s0 - np.timedelta64(7, "D"):
        return None
    return float(values[j] / values[i] - 1)


def thin[T](values: list[T], target: int = 400) -> list[T]:
    """Every k-th point (always keeping the last) so long histories stay light to send."""
    step = max(1, math.ceil(len(values) / target))
    out = values[::step]
    return out if (len(values) - 1) % step == 0 else [*out, values[-1]]


def _group(positions: list[Position], key: str) -> list[Exposure]:
    out: dict[str, float] = {}
    for p in positions:
        out[getattr(p, key) or "Unknown"] = out.get(getattr(p, key) or "Unknown", 0.0) + p.weight
    return [Exposure(name=k, weight=v) for k, v in sorted(out.items(), key=lambda kv: -kv[1])]


def analyse(req: PortfolioRequest) -> Envelope[PortfolioAnalysis]:
    symbols = list(dict.fromkeys(h.symbol.upper() for h in req.holdings))
    shares = {h.symbol.upper(): h.shares for h in req.holdings}
    fx_cache: dict[str, pd.Series] = {}

    def load(sym: str):
        try:
            prices, ccy = _base_prices(sym, req.base, fx_cache)
            return sym, prices, ccy, yahoo.profile(sym).data, None
        except Exception as exc:
            return sym, None, None, None, str(exc)

    with ThreadPoolExecutor(max_workers=8) as pool:
        loaded = list(pool.map(load, [*symbols, req.benchmark]))
    bench_sym, bench_prices, *_, bench_err = loaded[-1]
    if bench_prices is None:
        raise NotFoundError(f"Benchmark {bench_sym}: {bench_err}")
    excluded = {s: err for s, p, _, _, err in loaded[:-1] if p is None and err}
    good = [(s, p, c, prof) for s, p, c, prof, _ in loaded[:-1] if p is not None]
    if not good:
        raise NotFoundError("None of the holdings has price history")

    panel = pd.DataFrame({s: p for s, p, _, _ in good}).sort_index().ffill(limit=5)
    end = panel.index[-1]
    start = end - pd.DateOffset(years=req.lookback_years)
    window = panel[panel.index >= start].dropna()
    if len(window) < 120:
        raise NotApplicableError(
            "Fewer than 120 common trading days in the look-back; shorten it or remove recently "
            f"listed holdings ({', '.join(c for c in panel if panel[c].first_valid_index() > start)})."
        )
    bench = bench_prices.reindex(window.index, method="ffill")
    rets = window.pct_change().dropna()
    bench_rets = bench.pct_change().reindex(rets.index).fillna(0.0).to_numpy()
    r = rets.to_numpy()
    names = [str(c) for c in window.columns]
    levels = window.to_numpy(dtype=float)
    dates = [str(d) for d in np.datetime_as_string(window.index.to_numpy(), unit="D")]

    latest = window.iloc[-1]
    values = np.array([latest[s] * shares[s] for s in names])
    total = float(values.sum())
    w = values / total
    cov_d, shrink = risk.ledoit_wolf(r)
    cov = cov_d * risk.TRADING_DAYS
    rc = risk.risk_contributions(w, cov)
    port = r @ w
    rf = _risk_free(req.base)
    stats = risk.annualised_stats(port, rf)
    bstats = risk.annualised_stats(bench_rets, rf)
    active = port - bench_rets
    te = float(np.std(active, ddof=1) * math.sqrt(risk.TRADING_DAYS))
    stats_out: dict[str, float | None] = {
        **stats,
        "beta": risk.beta(port, bench_rets),
        "correlation": float(np.corrcoef(port, bench_rets)[0, 1]),
        "tracking_error": te,
        "information_ratio": (stats["return"] - bstats["return"]) / te if te else None,
        "benchmark_return": bstats["return"],
        "benchmark_volatility": bstats["volatility"],
        "benchmark_max_drawdown": bstats["max_drawdown"],
    }

    profiles = {s: prof for s, _, _, prof in good}
    currencies = {s: c for s, _, c, _ in good}
    positions = []
    for i, s in enumerate(names):
        prof = profiles[s]
        positions.append(
            Position(
                symbol=s,
                name=prof.name if prof else s,
                # Funds have no sector or country of their own on Yahoo.
                sector=(prof.sector or ("ETF" if prof.quote_type == "ETF" else None))
                if prof
                else None,
                country=(prof.country or ("Fund" if prof.quote_type == "ETF" else None))
                if prof
                else None,
                currency=currencies[s] or "?",
                shares=shares[s],
                price=float(latest[s]),
                value=float(values[i]),
                weight=float(w[i]),
                period_return=float(levels[-1, i] / levels[0, i] - 1),
                volatility=float(math.sqrt(cov[i, i])),
                beta=risk.beta(r[:, i], bench_rets),
                risk_share=float(rc[i] / stats["volatility"]) if stats["volatility"] else 0.0,
            )
        )
    positions.sort(key=lambda p: -p.value)

    mean_d = r.mean(axis=0)
    sigma_d = math.sqrt(float(w @ cov_d @ w))
    var_rows = []
    for v in (
        risk.historical_var(port, req.confidence),
        risk.parametric_var(float(mean_d @ w), sigma_d, req.confidence),
        risk.monte_carlo_var(w, mean_d, cov_d, req.confidence),
    ):
        var_rows.append(
            VarRow(
                method=v.method,
                var_pct=v.var,
                es_pct=v.es,
                var_amount=v.var * total,
                es_amount=v.es * total,
                var_10d_amount=v.var * total * math.sqrt(10),
            )
        )

    # Stress: replay each episode on today's weights, using the full history.
    betas = {p.symbol: p.beta for p in positions}
    weights = {p.symbol: p.weight for p in positions}
    stress = []
    for name, s0, s1 in SCENARIOS:
        b = _window_return(bench_prices, s0, s1)
        total_ret, proxied = 0.0, []
        for sym in names:
            x = _window_return(cast(pd.Series, panel[sym]).dropna(), s0, s1)
            if x is None and b is not None:
                # Not listed yet (or no data): assume it moved with the benchmark, scaled by beta.
                x = betas[sym] * b
                proxied.append(sym)
            if x is not None:
                total_ret += weights[sym] * x
        stress.append(
            StressRow(
                name=name,
                start=s0,
                end=s1,
                portfolio_return=total_ret,
                pnl=total_ret * total,
                benchmark_return=b,
                proxied=proxied,
            )
        )
    foreign = sum(p.weight for p in positions if fx.normalise_currency(p.currency)[0] != req.base)
    beta_p = float(sum(p.weight * p.beta for p in positions))
    shocks: list[dict[str, float | str]] = [
        {"name": "Benchmark −10% (beta-scaled)", "return": -0.10 * beta_p},
        {"name": "Benchmark −20% (beta-scaled)", "return": -0.20 * beta_p},
        {"name": f"{req.base} +10% vs all currencies", "return": foreign * (1 / 1.1 - 1)},
        {"name": f"{req.base} −10% vs all currencies", "return": foreign * (1 / 0.9 - 1)},
    ]
    for s in shocks:
        s["pnl"] = float(s["return"]) * total

    mu = mean_d * risk.TRADING_DAYS
    optimised = []
    for label, weights_vec in (
        ("Current", w),
        ("Equal weight", np.full(len(names), 1 / len(names))),
        ("Minimum variance", risk.minimum_variance(cov)),
        ("Risk parity", risk.risk_parity(cov)),
    ):
        vol = math.sqrt(float(weights_vec @ cov @ weights_vec))
        exp_ret = float(weights_vec @ mu)
        optimised.append(
            Optimised(
                name=label,
                weights={s: float(x) for s, x in zip(names, weights_vec, strict=True)},
                volatility=vol,
                expected_return=exp_ret,
                sharpe=(exp_ret - rf) / vol if vol else 0.0,
                effective_n=risk.effective_n(weights_vec),
                max_drawdown=risk.max_drawdown(r @ weights_vec),
            )
        )

    wealth = np.concatenate([[100.0], 100 * np.cumprod(1 + port)])
    bench_wealth = np.concatenate([[100.0], 100 * np.cumprod(1 + bench_rets)])
    corr = risk.correlation(cov)
    return Envelope(
        data=PortfolioAnalysis(
            base=req.base,
            benchmark=req.benchmark,
            value=total,
            start=dates[0],
            end=dates[-1],
            days=len(rets),
            rf=rf,
            positions=positions,
            excluded=excluded,
            stats=stats_out,
            var=var_rows,
            confidence=req.confidence,
            exposures={
                "sector": _group(positions, "sector"),
                "country": _group(positions, "country"),
                "currency": _group(positions, "currency"),
            },
            correlation={
                "symbols": names,
                "matrix": [[round(float(x), 4) for x in row] for row in corr],
            },
            shrinkage=shrink,
            diversification={
                "effective_n": risk.effective_n(w),
                "diversification_ratio": risk.diversification_ratio(w, cov),
            },
            stress=stress,
            shocks=shocks,
            performance={
                "dates": thin(dates),
                "portfolio": thin([round(float(x), 3) for x in wealth]),
                "benchmark": thin([round(float(x), 3) for x in bench_wealth]),
            },
            optimised=optimised,
        ),
        meta=Provenance(
            source="Tessera risk model · Yahoo Finance prices · ECB FX",
            freshness="end_of_day",
            as_of=datetime.fromisoformat(dates[-1]).replace(tzinfo=UTC),
            notes=[
                f"Total returns in {req.base}, converted daily at ECB reference rates. Covariance "
                f"is Ledoit–Wolf shrunk (intensity {shrink:.2f}); optimised portfolios are "
                "in-sample and only illustrate the trade-offs.",
            ],
        ),
    )
