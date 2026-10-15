"""Response models for the option analytics (OMON, IVOL).

Kept apart from `tessera.options` so the API can declare its schemas without importing
derivlab, which is an optional dependency (installed from project 05 by `make install`).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class OptionLeg(BaseModel):
    contract: str
    bid: float | None
    ask: float | None
    last: float | None
    volume: float | None
    open_interest: float | None
    last_trade: datetime | None
    in_the_money: bool
    price: float | None
    price_source: Literal["mid", "last"] | None
    iv: float | None
    yahoo_iv: float | None
    delta: float | None
    gamma: float | None
    theta_per_day: float | None
    vega_per_point: float | None


class ChainRow(BaseModel):
    strike: float
    call: OptionLeg | None
    put: OptionLeg | None


class ChainTotals(BaseModel):
    call_volume: float
    put_volume: float
    call_open_interest: float
    put_open_interest: float
    put_call_volume: float | None
    put_call_open_interest: float | None


class OptionChainView(BaseModel):
    symbol: str
    currency: str | None
    spot: float
    expiries: list[str]
    expiry: str
    days: int
    t: float
    rate: float
    dividend_yield: float  # implied by the parity forward: q = r − ln(F/S)/t
    forward: float
    forward_method: str
    atm_strike: float | None
    rows: list[ChainRow]
    totals: ChainTotals


class SmilePoint(BaseModel):
    strike: float
    log_moneyness: float
    iv: float
    kind: str
    source: str


class SmileSlice(BaseModel):
    expiry: str
    days: int
    t: float
    forward: float
    atm_vol: float
    points: list[SmilePoint]
    fit_strikes: list[float]
    fit_iv: list[float]
    rmse: float | None
    butterfly_arbitrage: bool
    skew_90_110: float | None  # IV at 90% of the forward minus IV at 110%, vol points
    dropped: dict[str, int]


class VolSurfaceView(BaseModel):
    symbol: str
    spot: float
    price_basis: str
    rate: float
    slices: list[SmileSlice]
    realized_vol_30d: float | None
    realized_vol_90d: float | None
