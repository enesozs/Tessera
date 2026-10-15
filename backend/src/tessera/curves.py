"""Curve analytics: par ↔ zero (spot) ↔ forward rates — pure math, no I/O.

* U.S. Treasury yields are **par** yields, semi-annual bond-equivalent. Bootstrapping on a
  half-year grid: a par bond with coupon c maturing at tₙ prices at 1, so
      DFₙ = (1 − c/2 · Σᵢ<ₙ DFᵢ) / (1 + c/2).
  Bills (≤ 6 months) carry no intermediate coupon, so DF = 1 / (1 + y·t) for them.
* The ECB publishes **spot** (zero) rates, continuously compounded, so DF = exp(−r·t) directly
  and par yields follow from  par(tₙ) = (1 − DFₙ) / Σ DFᵢ  on an annual-coupon grid.
* One-year forward rate starting at t, continuous: f(t, t+1) = ln(DF(t) / DF(t+1)).
Between quoted tenors, rates are interpolated with a monotone cubic (PCHIP): it never
overshoots the quotes and has a continuous slope. Linear interpolation would put a kink at
every quoted tenor, and because a forward is roughly z(t) + t·z'(t), each kink becomes a jump
in the forward curve (over 1.5 points at the 20-year point, where U.S. 20Y yields sit above
30Y). Treasury's own curve uses a related monotone-convex method. Beyond the last tenor rates
are held flat.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

import numpy as np
from pydantic import BaseModel
from scipy.interpolate import PchipInterpolator


class CurveAnalytics(BaseModel):
    years: list[float]
    par: list[float]  # percent, the convention of the source curve
    zero: list[float]  # percent, continuously compounded
    forward_1y: list[float | None]  # percent, continuously compounded, starting at `years`
    method: str


def interpolator(xs: Sequence[float], ys: Sequence[float]) -> Callable[[float], float]:
    """Monotone cubic through (xs, ys), flat outside the quoted range."""
    spline = PchipInterpolator(np.asarray(xs, dtype=float), np.asarray(ys, dtype=float))
    lo, hi = xs[0], xs[-1]
    return lambda x: float(spline(min(max(x, lo), hi)))


def _known(
    tenors: Sequence[float], values: Sequence[float | None]
) -> tuple[list[float], list[float]]:
    pairs = [(t, v) for t, v in zip(tenors, values, strict=True) if v is not None]
    if len(pairs) < 2:
        raise ValueError("need at least two quoted tenors")
    return [t for t, _ in pairs], [v for _, v in pairs]


def bootstrap_par_semiannual(
    tenors: Sequence[float], par_pct: Sequence[float | None]
) -> tuple[list[float], list[float]]:
    """Half-year grid and discount factors from semi-annual par yields (percent)."""
    ts, ys = _known(tenors, par_pct)
    par_at = interpolator(ts, ys)
    grid = [0.5 * n for n in range(1, round(max(ts) * 2) + 1)]
    dfs: list[float] = []
    for t in grid:
        c = par_at(t) / 100
        if t <= 0.5:
            dfs.append(1 / (1 + c * t))
        else:
            dfs.append((1 - c / 2 * sum(dfs)) / (1 + c / 2))
    return grid, dfs


def forward_1y(grid: Sequence[float], dfs: Sequence[float]) -> list[float | None]:
    lookup = dict(zip(grid, dfs, strict=True))
    out: list[float | None] = []
    for t, df in zip(grid, dfs, strict=True):
        later = lookup.get(round(t + 1, 6))
        out.append(math.log(df / later) * 100 if later else None)
    return out


def from_par_semiannual(tenors: Sequence[float], par_pct: Sequence[float | None]) -> CurveAnalytics:
    grid, dfs = bootstrap_par_semiannual(tenors, par_pct)
    par_at = interpolator(*_known(tenors, par_pct))
    return CurveAnalytics(
        years=grid,
        par=[par_at(t) for t in grid],
        zero=[-math.log(df) / t * 100 for t, df in zip(grid, dfs, strict=True)],
        forward_1y=forward_1y(grid, dfs),
        method="Bootstrapped from semi-annual par yields (monotone cubic interpolation)",
    )


def from_spot_continuous(
    tenors: Sequence[float], spot_pct: Sequence[float | None]
) -> CurveAnalytics:
    ts, rs = _known(tenors, spot_pct)
    grid = [0.5 * n for n in range(1, round(max(ts) * 2) + 1)]
    zero_at = interpolator(ts, rs)
    zero = [zero_at(t) for t in grid]
    dfs = [math.exp(-z / 100 * t) for z, t in zip(zero, grid, strict=True)]
    par: list[float] = []
    for t, df in zip(grid, dfs, strict=True):
        # Annual-coupon par yield at whole years; half years interpolate between neighbours.
        annual = [
            d for g, d in zip(grid, dfs, strict=True) if g <= t + 1e-9 and abs(g - round(g)) < 1e-9
        ]
        par.append(
            (1 - df) / sum(annual) * 100 if annual and abs(t - round(t)) < 1e-9 else float("nan")
        )
    whole = [(t, p) for t, p in zip(grid, par, strict=True) if not math.isnan(p)]
    par = (
        [float(np.interp(t, [w[0] for w in whole], [w[1] for w in whole])) for t in grid]
        if whole
        else zero
    )
    return CurveAnalytics(
        years=grid,
        par=par,
        zero=zero,
        forward_1y=forward_1y(grid, dfs),
        method="ECB spot rates (continuous, monotone cubic between tenors); par yields for annual coupons",
    )
