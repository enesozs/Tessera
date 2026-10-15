"""Portfolio risk mathematics — pure NumPy, no I/O.

Inputs are daily simple returns (T × N, oldest first) in one base currency and a weight vector.

* Covariance: Ledoit–Wolf shrinkage towards a scaled identity (Ledoit & Wolf, 2004). With a
  few hundred days and a dozen assets the sample covariance is noisy; shrinkage pulls extreme
  correlations towards the average and keeps the matrix well conditioned.
* Risk contributions (Euler): RCᵢ = wᵢ·(Σw)ᵢ / σₚ, which sum to σₚ. The share RCᵢ/σₚ says how
  much of the portfolio's volatility each holding is responsible for — not the same as its weight.
* Value at Risk / Expected Shortfall over one day at confidence c, as positive loss fractions:
  historical (empirical quantile of realised portfolio returns), parametric (normal with the
  sample mean and shrunk covariance) and Monte Carlo (multivariate normal, seeded).
* Optimisers (long-only, fully invested): minimum variance and equal risk contribution
  ("risk parity", via Spinu's convex log-barrier formulation).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import minimize
from scipy.stats import norm

Array = NDArray[np.float64]
TRADING_DAYS = 252


def ledoit_wolf(returns: Array) -> tuple[Array, float]:
    """(shrunk covariance, shrinkage intensity in [0, 1]) of daily returns."""
    x = returns - returns.mean(axis=0)
    t, n = x.shape
    sample = x.T @ x / t
    mu = np.trace(sample) / n
    target = mu * np.eye(n)
    d2 = np.sum((sample - target) ** 2) / n
    if d2 == 0:
        return sample, 0.0
    b2 = sum(np.sum((np.outer(row, row) - sample) ** 2) for row in x) / (t * t * n)
    shrink = float(min(b2, d2) / d2)
    return shrink * target + (1 - shrink) * sample, shrink


def correlation(cov: Array) -> Array:
    sd = np.sqrt(np.diag(cov))
    return cov / np.outer(sd, sd)


def risk_contributions(weights: Array, cov: Array) -> Array:
    """Euler contributions to portfolio volatility (same units as σₚ; they sum to σₚ)."""
    sigma = math.sqrt(float(weights @ cov @ weights))
    return weights * (cov @ weights) / sigma if sigma > 0 else np.zeros_like(weights)


def effective_n(weights: Array) -> float:
    """1 / Herfindahl index: the number of equal positions with the same concentration."""
    return float(1 / np.sum(weights**2))


def diversification_ratio(weights: Array, cov: Array) -> float:
    """Weighted average asset volatility ÷ portfolio volatility (1 = no diversification)."""
    return float(weights @ np.sqrt(np.diag(cov)) / math.sqrt(float(weights @ cov @ weights)))


@dataclass(frozen=True)
class VarResult:
    method: str
    var: float  # one-day loss, fraction of portfolio value
    es: float


def historical_var(port_returns: Array, confidence: float) -> VarResult:
    q = float(np.quantile(port_returns, 1 - confidence))
    tail = port_returns[port_returns <= q]
    return VarResult("historical", -q, -float(tail.mean()) if tail.size else -q)


def parametric_var(mean: float, sigma: float, confidence: float) -> VarResult:
    z = float(norm.ppf(confidence))
    density = float(norm.pdf(z))
    return VarResult("parametric", z * sigma - mean, sigma * density / (1 - confidence) - mean)


def monte_carlo_var(
    weights: Array, mean: Array, cov: Array, confidence: float, paths: int = 50_000, seed: int = 7
) -> VarResult:
    rng = np.random.default_rng(seed)
    sims = rng.multivariate_normal(mean, cov, size=paths, method="cholesky") @ weights
    r = historical_var(sims, confidence)
    return VarResult("monte carlo", r.var, r.es)


def max_drawdown(port_returns: Array) -> float:
    wealth = np.cumprod(1 + port_returns)
    peak = np.maximum.accumulate(wealth)
    return float(np.min(wealth / peak - 1)) if wealth.size else 0.0


def _long_only(n: int) -> tuple[list[tuple[float, float]], dict]:
    return [(0.0, 1.0)] * n, {"type": "eq", "fun": lambda w: np.sum(w) - 1}


def minimum_variance(cov: Array) -> Array:
    n = cov.shape[0]
    bounds, budget = _long_only(n)
    res = minimize(
        lambda w: w @ cov @ w,
        np.full(n, 1 / n),
        jac=lambda w: 2 * cov @ w,
        bounds=bounds,
        constraints=[budget],
        method="SLSQP",
        options={"ftol": 1e-14, "maxiter": 500},
    )
    w = np.clip(res.x, 0, None)
    return w / w.sum()


def risk_parity(cov: Array) -> Array:
    """Equal risk contributions: minimise ½·yᵀΣy − (1/n)·Σ ln yᵢ over y > 0, then normalise
    (Spinu, 2013). The objective is strictly convex, so the solution is unique."""
    n = cov.shape[0]
    scale = math.sqrt(float(np.mean(np.diag(cov))))
    c = cov / scale**2  # well-scaled problem; the weights are scale-invariant
    res = minimize(
        lambda y: 0.5 * y @ c @ y - np.sum(np.log(y)) / n,
        np.full(n, 1 / math.sqrt(n)),
        jac=lambda y: c @ y - 1 / (n * y),
        bounds=[(1e-9, None)] * n,
        method="L-BFGS-B",
        options={"ftol": 1e-15, "gtol": 1e-12, "maxiter": 2000},
    )
    return res.x / res.x.sum()


def annualised_stats(port_returns: Array, rf_annual: float) -> dict[str, float]:
    days = port_returns.size
    growth = float(np.prod(1 + port_returns))
    ann_return = growth ** (TRADING_DAYS / days) - 1 if days else 0.0
    vol = float(np.std(port_returns, ddof=1) * math.sqrt(TRADING_DAYS)) if days > 1 else 0.0
    downside = port_returns[port_returns < 0]
    dvol = float(np.sqrt(np.mean(downside**2)) * math.sqrt(TRADING_DAYS)) if downside.size else 0.0
    return {
        "return": ann_return,
        "volatility": vol,
        "sharpe": (ann_return - rf_annual) / vol if vol else 0.0,
        "sortino": (ann_return - rf_annual) / dvol if dvol else 0.0,
        "max_drawdown": max_drawdown(port_returns),
    }


def beta(asset: Array, benchmark: Array) -> float:
    var = float(np.var(benchmark, ddof=1))
    return float(np.cov(asset, benchmark, ddof=1)[0, 1] / var) if var else float("nan")
