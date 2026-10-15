"""European Central Bank Data Portal (SDMX REST, no key): curves, sovereign yields, macro.

Series are addressed as `<dataflow>/<key>`; `+` in a key dimension ORs several values,
so one request returns e.g. every tenor of a yield curve.
"""

from __future__ import annotations

import csv
import io
from datetime import UTC, date, datetime, timedelta

from tessera import http
from tessera.errors import NotFoundError

BASE = "https://data-api.ecb.europa.eu/service/data"
PORTAL = "https://data.ecb.europa.eu/data/datasets"


def fetch_csv(flow: str, key: str, start: date | str | None = None) -> list[dict[str, str]]:
    params = {"format": "csvdata"}
    if start is not None:
        params["startPeriod"] = start.isoformat() if isinstance(start, date) else start
    text = http.get_text(f"{BASE}/{flow}/{key}", params=params)
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise NotFoundError(f"ECB returned no observations for {flow}/{key}")
    return rows


def parse_period(period: str) -> date:
    """ECB TIME_PERIOD → date: '2026-10-14', '2026-09' (month), '2026-Q2' (quarter start)."""
    if "-Q" in period:
        year, quarter = period.split("-Q")
        return date(int(year), 3 * (int(quarter) - 1) + 1, 1)
    parts = period.split("-")
    if len(parts) == 2:
        return date(int(parts[0]), int(parts[1]), 1)
    return date.fromisoformat(period)


def observations(rows: list[dict[str, str]]) -> list[tuple[date, float]]:
    out = []
    for row in rows:
        value = row.get("OBS_VALUE", "")
        if value in ("", "NaN"):
            continue
        out.append((parse_period(row["TIME_PERIOD"]), float(value)))
    out.sort()
    return out


def as_datetime(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def days_ago(n: int) -> date:
    return date.today() - timedelta(days=n)
