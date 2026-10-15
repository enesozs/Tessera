"""FX reference rates (FX) from Frankfurter, a free mirror of the ECB's daily fixings.

These are *reference* rates: one fixing per TARGET business day around 14:15 CET, not
tradable quotes. Every cross is derived from the EUR fixings: USD/JPY = EUR/JPY ÷ EUR/USD.
"""

from __future__ import annotations

from datetime import date, timedelta

from pydantic import BaseModel

from tessera import http
from tessera.cache import cached
from tessera.errors import NotFoundError
from tessera.models import Envelope, Provenance
from tessera.providers.ecb import as_datetime

API = "https://api.frankfurter.dev/v1"
NOTE = "ECB euro foreign exchange reference rates, fixed daily ~14:15 CET; not tradable quotes."


class FxMatrix(BaseModel):
    currencies: list[str]
    date: str
    previous_date: str
    # rates[i][j] = units of currencies[j] per 1 unit of currencies[i]
    rates: list[list[float]]
    change_pct: list[list[float]]


class FxPoint(BaseModel):
    date: str
    rate: float


class FxHistory(BaseModel):
    base: str
    quote: str
    points: list[FxPoint]


def cross_matrix(eur_rates: dict[str, float], currencies: list[str]) -> list[list[float]]:
    """Cross rates from EUR-based fixings (EUR itself has rate 1)."""
    per_eur = {**eur_rates, "EUR": 1.0}
    return [[per_eur[q] / per_eur[b] for q in currencies] for b in currencies]


@cached(ttl=1800)
def matrix(currencies: tuple[str, ...]) -> Envelope[FxMatrix]:
    symbols = [c for c in currencies if c != "EUR"]
    start = (date.today() - timedelta(days=12)).isoformat()
    payload = http.get_json(
        f"{API}/{start}..", params={"base": "EUR", "symbols": ",".join(symbols)}
    )
    by_day: dict[str, dict[str, float]] = payload.get("rates") or {}
    days = sorted(by_day)
    if len(days) < 2:
        raise NotFoundError("Not enough FX fixings returned")
    missing = [c for c in symbols if c not in by_day[days[-1]]]
    if missing:
        raise NotFoundError(f"No ECB reference rate for {', '.join(missing)}")
    ccys = list(currencies)
    now = cross_matrix(by_day[days[-1]], ccys)
    before = cross_matrix(by_day[days[-2]], ccys)
    change = [
        [(n / b - 1) * 100 for n, b in zip(row_n, row_b, strict=True)]
        for row_n, row_b in zip(now, before, strict=True)
    ]
    return Envelope(
        data=FxMatrix(
            currencies=ccys, date=days[-1], previous_date=days[-2], rates=now, change_pct=change
        ),
        meta=Provenance(
            source="ECB via Frankfurter",
            source_url="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
            freshness="reference",
            as_of=as_datetime(date.fromisoformat(days[-1])),
            notes=[NOTE],
        ),
    )


@cached(ttl=3600)
def pair_history(base: str, quote: str, years: int = 5) -> Envelope[FxHistory]:
    if base == quote:
        raise NotFoundError("Base and quote currency are the same")
    start = (date.today() - timedelta(days=365 * years)).isoformat()
    payload = http.get_json(f"{API}/{start}..", params={"base": base, "symbols": quote})
    by_day: dict[str, dict[str, float]] = payload.get("rates") or {}
    points = [FxPoint(date=d, rate=r[quote]) for d, r in sorted(by_day.items()) if quote in r]
    if not points:
        raise NotFoundError(f"No reference rates for {base}/{quote}")
    return Envelope(
        data=FxHistory(base=base, quote=quote, points=points),
        meta=Provenance(
            source="ECB via Frankfurter",
            source_url="https://frankfurter.dev/",
            freshness="reference",
            as_of=as_datetime(date.fromisoformat(points[-1].date)),
            notes=[NOTE],
        ),
    )
