"""Macro series (ECO) from FRED and the ECB, with transparent transformations.

FRED's public graph CSV needs no API key. Transformations (year-over-year change, period
difference, scaling) are done here rather than by the provider so the method is visible in
one place and stated in each series' `transform` description.
"""

from __future__ import annotations

import csv
import io
import itertools
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel

from tessera import http
from tessera.cache import cached
from tessera.errors import NotFoundError
from tessera.models import Envelope, Provenance
from tessera.providers import ecb

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
Transform = Literal["level", "yoy", "diff"]
Frequency = Literal["daily", "weekly", "monthly", "quarterly", "annual"]


@dataclass(frozen=True)
class SeriesSpec:
    id: str
    title: str
    region: Literal["US", "EA"]
    provider: Literal["fred", "ecb"]
    key: str  # FRED series id or ECB 'FLOW/KEY'
    frequency: Frequency
    units: str
    transform: Transform = "level"
    scale: float = 1.0
    # For a rate or yield a rise is not "good"; the UI colours changes neutrally.
    higher_is_better: bool | None = None


CATALOG: list[SeriesSpec] = [
    SeriesSpec("US.CPI", "CPI inflation", "US", "fred", "CPIAUCSL", "monthly", "% y/y", "yoy"),
    SeriesSpec("US.CORE_PCE", "Core PCE inflation", "US", "fred", "PCEPILFE", "monthly", "% y/y", "yoy"),
    SeriesSpec("US.UNRATE", "Unemployment rate", "US", "fred", "UNRATE", "monthly", "%"),
    SeriesSpec("US.PAYROLLS", "Nonfarm payrolls", "US", "fred", "PAYEMS", "monthly", "k, m/m", "diff", higher_is_better=True),
    SeriesSpec("US.GDP", "Real GDP growth", "US", "fred", "A191RL1Q225SBEA", "quarterly", "% q/q saar", higher_is_better=True),
    SeriesSpec("US.CLAIMS", "Initial jobless claims", "US", "fred", "ICSA", "weekly", "k", scale=1e-3),
    SeriesSpec("US.FEDFUNDS", "Fed funds effective rate", "US", "fred", "DFF", "daily", "%"),
    SeriesSpec("US.10Y", "10-year Treasury yield", "US", "fred", "DGS10", "daily", "%"),
    SeriesSpec("US.2S10S", "2s10s Treasury spread", "US", "fred", "T10Y2Y", "daily", "pp"),
    SeriesSpec("US.BEI10", "10-year breakeven inflation", "US", "fred", "T10YIE", "daily", "%"),
    SeriesSpec("EA.HICP", "HICP inflation", "EA", "fred", "CP0000EZ19M086NEST", "monthly", "% y/y", "yoy"),
    SeriesSpec("EA.UNRATE", "Unemployment rate", "EA", "ecb", "LFSI/M.I9.S.UNEHRT.TOTAL0.15_74.T", "monthly", "%"),
    SeriesSpec("EA.GDP", "Real GDP growth", "EA", "ecb", "MNA/Q.Y.I9.W2.S1.S1.B.B1GQ._Z._Z._Z.EUR.LR.GY", "quarterly", "% y/y", higher_is_better=True),
    SeriesSpec("EA.DFR", "ECB deposit facility rate", "EA", "fred", "ECBDFR", "daily", "%"),
]  # fmt: skip
BY_ID = {s.id: s for s in CATALOG}

TRANSFORM_TEXT = {
    "level": "Level as published",
    "yoy": "Year-over-year % change of the index, computed by Tessera",
    "diff": "Change from the previous period, computed by Tessera",
}


class Observation(BaseModel):
    date: str
    value: float


class MacroSeries(BaseModel):
    id: str
    title: str
    region: str
    source: str
    source_key: str
    frequency: str
    units: str
    transform: str
    higher_is_better: bool | None
    observations: list[Observation]


class MacroSummary(BaseModel):
    id: str
    title: str
    region: str
    source: str
    frequency: str
    units: str
    higher_is_better: bool | None
    latest: Observation | None
    previous: Observation | None
    spark: list[float]


def parse_fred_csv(text: str) -> list[tuple[date, float]]:
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        return []
    out = []
    for row in rows[1:]:
        if len(row) < 2 or row[1] in ("", "."):
            continue
        out.append((date.fromisoformat(row[0]), float(row[1])))
    return out


def apply_transform(
    points: list[tuple[date, float]], transform: Transform, scale: float = 1.0
) -> list[tuple[date, float]]:
    if transform == "yoy":
        by_date = dict(points)
        out = []
        for d, v in points:
            try:
                prior = by_date.get(d.replace(year=d.year - 1))
            except ValueError:  # 29 February
                prior = None
            if prior:
                out.append((d, (v / prior - 1) * 100))
        points = out
    elif transform == "diff":
        points = [(d, v - p) for (_, p), (d, v) in itertools.pairwise(points)]
    return [(d, v * scale) for d, v in points]


FRED_ID = re.compile(r"^[A-Z0-9_]{2,40}$")


def _spec_for(series_id: str) -> SeriesSpec:
    if series_id in BY_ID:
        return BY_ID[series_id]
    # Any other FRED series by its id, shown as published.
    key = series_id.removeprefix("FRED:").upper()
    if not FRED_ID.match(key):
        raise NotFoundError(f"Unknown series '{series_id}'")
    return SeriesSpec(series_id, key, "US", "fred", key, "daily", "as published", "level")


def infer_frequency(points: list[tuple[date, float]]) -> Frequency:
    """Guess the sampling frequency of an uncatalogued series from its median spacing."""
    gaps = sorted((b[0] - a[0]).days for a, b in itertools.pairwise(points))
    if not gaps:
        return "annual"
    median = gaps[len(gaps) // 2]
    for limit, label in ((4, "daily"), (10, "weekly"), (45, "monthly"), (120, "quarterly")):
        if median <= limit:
            return label  # type: ignore[return-value]
    return "annual"


@cached(ttl=6 * 3600)
def series(series_id: str, years: int = 15) -> Envelope[MacroSeries]:
    spec = _spec_for(series_id)
    # A year of extra history so year-over-year changes exist from the first displayed date.
    start = date.today() - timedelta(days=365 * (years + 1))
    if spec.provider == "fred":
        text = http.get_text(FRED_CSV, params={"id": spec.key, "cosd": start.isoformat()})
        if text.lstrip().startswith("<"):
            raise NotFoundError(f"FRED has no series '{spec.key}'")
        raw = parse_fred_csv(text)
        source, url = "FRED, St. Louis Fed", f"https://fred.stlouisfed.org/series/{spec.key}"
    else:
        flow, key = spec.key.split("/", 1)
        raw = ecb.observations(ecb.fetch_csv(flow, key, start=start))
        source, url = "European Central Bank", f"{ecb.PORTAL}/{flow}/{flow}.{key}"
    if not raw:
        raise NotFoundError(f"No observations for '{series_id}'")
    frequency = spec.frequency if series_id in BY_ID else infer_frequency(raw)
    points = apply_transform(raw, spec.transform, spec.scale)
    cutoff = date.today() - timedelta(days=365 * years)
    points = [(d, v) for d, v in points if d >= cutoff]
    data = MacroSeries(
        id=spec.id,
        title=spec.title,
        region=spec.region,
        source=source,
        source_key=spec.key,
        frequency=frequency,
        units=spec.units,
        transform=TRANSFORM_TEXT[spec.transform],
        higher_is_better=spec.higher_is_better,
        observations=[Observation(date=d.isoformat(), value=round(v, 4)) for d, v in points],
    )
    return Envelope(
        data=data,
        meta=Provenance(
            source=source,
            source_url=url,
            freshness="end_of_day" if frequency in ("daily", "weekly") else "periodic",
            as_of=ecb.as_datetime(points[-1][0]) if points else None,
            notes=[TRANSFORM_TEXT[spec.transform] + ".", "Latest releases may be revised."],
        ),
    )


def summarize(s: MacroSeries) -> MacroSummary:
    obs = s.observations
    spark_n = {"daily": 260, "weekly": 104, "monthly": 36, "quarterly": 20}.get(s.frequency, 36)
    tail = obs[-spark_n:]
    if s.frequency == "daily":
        tail = tail[::5]  # weekly sampling keeps the sparkline light
    return MacroSummary(
        id=s.id,
        title=s.title,
        region=s.region,
        source=s.source,
        frequency=s.frequency,
        units=s.units,
        higher_is_better=s.higher_is_better,
        latest=obs[-1] if obs else None,
        previous=obs[-2] if len(obs) > 1 else None,
        spark=[o.value for o in tail],
    )


def dashboard() -> Envelope[list[MacroSummary]]:
    """Summaries of the whole catalogue, fetched in parallel (each series cached on its own)."""
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_safe_series, [s.id for s in CATALOG]))
    found = [r for r in results if r is not None]
    if not found:
        raise NotFoundError("No macro series could be loaded")
    return Envelope(
        data=[summarize(r.data) for r in found],
        meta=Provenance(
            source="FRED, St. Louis Fed · European Central Bank",
            freshness="periodic",
            as_of=max(r.meta.as_of for r in found if r.meta.as_of),
            stale=any(r.meta.stale for r in found),
            notes=["Each tile shows its own source and frequency; open it for the full series."],
        ),
    )


def _safe_series(series_id: str) -> Envelope[MacroSeries] | None:
    try:
        return series(series_id)
    except Exception:
        return None
