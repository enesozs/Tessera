"""Government yield curves (YC) and euro-area sovereign 10-year yields (SOV).

* US: Treasury par yield curve, the official daily CMT fixings from home.treasury.gov.
* Euro area: ECB-estimated government curve (Svensson model, spot rates) for AAA-rated
  issuers or for all euro-area issuers.
* Sovereign 10Y: ECB "long-term interest rate for convergence purposes" — the monthly
  average 10-year benchmark yield per country (the series behind the BTP–Bund spread).
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel

from tessera import http
from tessera.cache import cached
from tessera.errors import NotFoundError
from tessera.models import Envelope, Provenance
from tessera.providers import ecb


class CurveSnapshot(BaseModel):
    label: str  # "Latest", "1W ago", …
    date: str
    yields: list[float | None]  # percent, aligned with YieldCurve.tenors


class TenorHistory(BaseModel):
    dates: list[str]
    series: dict[str, list[float | None]]  # tenor label -> yields (percent)


class YieldCurve(BaseModel):
    region: Literal["US", "EA"]
    name: str
    basis: str  # what kind of yield: par, spot…
    tenors: list[str]
    tenor_years: list[float]
    snapshots: list[CurveSnapshot]
    history: TenorHistory


COMPARISONS = (("Latest", 0), ("1W ago", 7), ("1M ago", 30), ("1Y ago", 365))


def pick_snapshots(
    dates: Sequence[date], rows: dict[date, list[float | None]]
) -> list[CurveSnapshot]:
    """Latest curve plus the last available curve on/before each comparison offset."""
    ordered = sorted(dates)
    latest = ordered[-1]
    out = []
    for label, offset in COMPARISONS:
        target = latest - timedelta(days=offset)
        candidates = [d for d in ordered if d <= target]
        if not candidates:
            continue
        d = candidates[-1]
        out.append(CurveSnapshot(label=label, date=d.isoformat(), yields=rows[d]))
    return out


# ── United States ─────────────────────────────────────────────────────────────

TREASURY_URL = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "daily-treasury-rates.csv/{year}/all"
)
TREASURY_PAGE = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "TextView?type=daily_treasury_yield_curve"
)
# CSV column -> (tenor label, years). Columns were added over time (4M in 2022, 6W in 2025),
# so older years simply leave them empty.
US_TENORS: list[tuple[str, str, float]] = [
    ("1 Mo", "1M", 1 / 12),
    ("1.5 Month", "6W", 1.5 / 12),
    ("2 Mo", "2M", 2 / 12),
    ("3 Mo", "3M", 0.25),
    ("4 Mo", "4M", 4 / 12),
    ("6 Mo", "6M", 0.5),
    ("1 Yr", "1Y", 1),
    ("2 Yr", "2Y", 2),
    ("3 Yr", "3Y", 3),
    ("5 Yr", "5Y", 5),
    ("7 Yr", "7Y", 7),
    ("10 Yr", "10Y", 10),
    ("20 Yr", "20Y", 20),
    ("30 Yr", "30Y", 30),
]
HISTORY_TENORS = ("3M", "2Y", "10Y", "30Y")


def parse_treasury_csv(text: str) -> dict[date, list[float | None]]:
    out: dict[date, list[float | None]] = {}
    for row in csv.DictReader(io.StringIO(text)):
        month, day, year = (int(p) for p in row["Date"].split("/"))
        values: list[float | None] = []
        for column, _, _ in US_TENORS:
            raw = (row.get(column) or "").strip()
            values.append(float(raw) if raw and raw != "N/A" else None)
        out[date(year, month, day)] = values
    return out


class _YearRows(BaseModel):
    rows: dict[date, list[float | None]]


@cached(ttl=3600)
def _treasury_year(year: int) -> Envelope[_YearRows]:
    text = http.get_text(
        TREASURY_URL.format(year=year),
        params={"type": "daily_treasury_yield_curve", "field_tdr_date_value": str(year)},
    )
    return Envelope(
        data=_YearRows(rows=parse_treasury_csv(text)),
        meta=Provenance(source="U.S. Treasury", freshness="end_of_day"),
    )


def build_us_curve(rows: dict[date, list[float | None]]) -> YieldCurve:
    if not rows:
        raise NotFoundError("Treasury returned no curve data")
    ordered = sorted(rows)
    cutoff = ordered[-1] - timedelta(days=366)
    recent = [d for d in ordered if d >= cutoff]
    labels = [label for _, label, _ in US_TENORS]
    return YieldCurve(
        region="US",
        name="U.S. Treasury par yield curve",
        basis="Par yields (CMT), bond-equivalent, %",
        tenors=labels,
        tenor_years=[years for _, _, years in US_TENORS],
        snapshots=pick_snapshots(ordered, rows),
        history=TenorHistory(
            dates=[d.isoformat() for d in recent],
            series={t: [rows[d][labels.index(t)] for d in recent] for t in HISTORY_TENORS},
        ),
    )


@cached(ttl=1800)
def us_curve() -> Envelope[YieldCurve]:
    this_year = date.today().year
    rows: dict[date, list[float | None]] = {}
    for year in (this_year - 1, this_year):
        rows.update(_treasury_year(year).data.rows)
    curve = build_us_curve(rows)
    return Envelope(
        data=curve,
        meta=Provenance(
            source="U.S. Treasury",
            source_url=TREASURY_PAGE,
            freshness="end_of_day",
            as_of=ecb.as_datetime(date.fromisoformat(curve.snapshots[0].date)),
            notes=["Daily par yields interpolated by Treasury from on-the-run securities."],
        ),
    )


# ── Euro area ─────────────────────────────────────────────────────────────────

EA_TENORS: list[tuple[str, str, float]] = [
    ("SR_3M", "3M", 0.25),
    ("SR_6M", "6M", 0.5),
    ("SR_1Y", "1Y", 1),
    ("SR_2Y", "2Y", 2),
    ("SR_3Y", "3Y", 3),
    ("SR_5Y", "5Y", 5),
    ("SR_7Y", "7Y", 7),
    ("SR_10Y", "10Y", 10),
    ("SR_15Y", "15Y", 15),
    ("SR_20Y", "20Y", 20),
    ("SR_30Y", "30Y", 30),
]
EA_ISSUERS = {"AAA": ("G_N_A", "AAA-rated issuers"), "ALL": ("G_N_C", "all issuers")}


def build_ea_curve(rows: list[dict[str, str]], issuers: str) -> YieldCurve:
    by_tenor = {code: i for i, (code, _, _) in enumerate(EA_TENORS)}
    table: dict[date, list[float | None]] = {}
    for row in rows:
        idx = by_tenor.get(row["DATA_TYPE_FM"])
        value = row.get("OBS_VALUE", "")
        if idx is None or value in ("", "NaN"):
            continue
        d = ecb.parse_period(row["TIME_PERIOD"])
        table.setdefault(d, [None] * len(EA_TENORS))[idx] = round(float(value), 4)
    if not table:
        raise NotFoundError("ECB returned no curve data")
    ordered = sorted(table)
    labels = [label for _, label, _ in EA_TENORS]
    return YieldCurve(
        region="EA",
        name=f"Euro area government curve — {EA_ISSUERS[issuers][1]}",
        basis="Spot (zero-coupon) yields, Svensson fit, continuous compounding, %",
        tenors=labels,
        tenor_years=[years for _, _, years in EA_TENORS],
        snapshots=pick_snapshots(ordered, table),
        history=TenorHistory(
            dates=[d.isoformat() for d in ordered],
            series={t: [table[d][labels.index(t)] for d in ordered] for t in HISTORY_TENORS},
        ),
    )


@cached(ttl=1800)
def ea_curve(issuers: Literal["AAA", "ALL"] = "AAA") -> Envelope[YieldCurve]:
    code = EA_ISSUERS[issuers][0]
    tenors = "+".join(code for code, _, _ in EA_TENORS)
    rows = ecb.fetch_csv("YC", f"B.U2.EUR.4F.{code}.SV_C_YM.{tenors}", start=ecb.days_ago(372))
    curve = build_ea_curve(rows, issuers)
    return Envelope(
        data=curve,
        meta=Provenance(
            source="European Central Bank",
            source_url=f"{ecb.PORTAL}/YC",
            freshness="end_of_day",
            as_of=ecb.as_datetime(date.fromisoformat(curve.snapshots[0].date)),
            notes=["Model curve fitted by the ECB to traded bond prices, not quoted yields."],
        ),
    )


# ── Euro-area sovereign 10Y (monthly) ─────────────────────────────────────────

SOVEREIGNS = {
    "DE": "Germany",
    "IT": "Italy",
    "FR": "France",
    "ES": "Spain",
    "PT": "Portugal",
    "GR": "Greece",
    "NL": "Netherlands",
    "BE": "Belgium",
    "AT": "Austria",
    "IE": "Ireland",
    "FI": "Finland",
}


class SovereignSeries(BaseModel):
    country: str
    name: str
    yields: list[float | None]  # percent, aligned with SovereignYields.months
    spread_bp: list[float | None]  # versus the benchmark (Germany), basis points


class SovereignYields(BaseModel):
    benchmark: str
    months: list[str]  # 'YYYY-MM'
    series: list[SovereignSeries]


def build_sovereign(rows: list[dict[str, str]], countries: Sequence[str]) -> SovereignYields:
    table: dict[str, dict[str, float]] = {}
    for row in rows:
        value = row.get("OBS_VALUE", "")
        if value in ("", "NaN"):
            continue
        table.setdefault(row["REF_AREA"], {})[row["TIME_PERIOD"]] = float(value)
    months = sorted({m for values in table.values() for m in values})
    bench = table.get("DE", {})
    series = []
    for country in countries:
        values = table.get(country)
        if not values:
            continue
        yields = [values.get(m) for m in months]
        spreads = [
            round((y - bench[m]) * 100, 1) if y is not None and m in bench else None
            for y, m in zip(yields, months, strict=True)
        ]
        series.append(
            SovereignSeries(
                country=country, name=SOVEREIGNS[country], yields=yields, spread_bp=spreads
            )
        )
    return SovereignYields(benchmark="DE", months=months, series=series)


@cached(ttl=6 * 3600)
def sovereign_10y(countries: tuple[str, ...]) -> Envelope[SovereignYields]:
    unknown = [c for c in countries if c not in SOVEREIGNS]
    if unknown:
        raise NotFoundError(f"Unsupported country code(s): {', '.join(unknown)}")
    wanted = tuple(dict.fromkeys(("DE", *countries)))  # Germany is always needed for spreads
    rows = ecb.fetch_csv("IRS", f"M.{'+'.join(wanted)}.L.L40.CI.0000.EUR.N.Z", start="2000-01")
    data = build_sovereign(rows, wanted)
    last = data.months[-1]
    return Envelope(
        data=data,
        meta=Provenance(
            source="European Central Bank",
            source_url=f"{ecb.PORTAL}/IRS",
            freshness="periodic",
            as_of=ecb.as_datetime(ecb.parse_period(last)),
            notes=[
                "Monthly averages of 10-year benchmark government bond yields "
                "(EU convergence-criterion series). Spreads are versus Germany."
            ],
        ),
    )
