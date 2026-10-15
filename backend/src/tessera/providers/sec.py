"""SEC EDGAR filings (FIL) for companies registered with the U.S. SEC.

EDGAR is free but its fair-access policy requires every client to identify itself with a
contact in the User-Agent header. Set SEC_USER_AGENT, e.g. "Tessera research you@example.com".
"""

from __future__ import annotations

import os
from datetime import date

from pydantic import BaseModel

from tessera import http
from tessera.cache import cached
from tessera.errors import ConfigurationError, NotFoundError
from tessera.models import Envelope, Provenance
from tessera.providers.ecb import as_datetime

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{document}"
BROWSE_URL = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}"

# Forms worth showing by default; insider (3/4/5) and administrative filings are noise here.
MAJOR_FORMS = {
    "10-K", "10-Q", "8-K", "20-F", "40-F", "6-K", "DEF 14A", "S-1", "F-1", "S-4", "F-4",
    "424B4", "SC 13D", "SC 13G", "SCHEDULE 13D", "SCHEDULE 13G", "11-K", "10-K/A", "20-F/A",
}  # fmt: skip


class Filing(BaseModel):
    form: str
    filed: str
    report_date: str | None
    description: str | None
    url: str
    major: bool


class Filings(BaseModel):
    symbol: str
    cik: int
    company: str
    filings: list[Filing]


def _headers() -> dict[str, str]:
    agent = os.environ.get("SEC_USER_AGENT", "").strip()
    if "@" not in agent:
        raise ConfigurationError(
            "SEC EDGAR requires a contact User-Agent. Set SEC_USER_AGENT "
            "(e.g. 'Tessera research you@example.com') in .env and restart the API."
        )
    return {"User-Agent": agent}


class _TickerMap(BaseModel):
    ciks: dict[str, int]
    names: dict[str, str]


@cached(ttl=24 * 3600)
def _ticker_map() -> Envelope[_TickerMap]:
    payload = http.get_json(TICKERS_URL, headers=_headers())
    ciks: dict[str, int] = {}
    names: dict[str, str] = {}
    for entry in payload.values():
        ticker = str(entry["ticker"]).upper()
        ciks.setdefault(ticker, int(entry["cik_str"]))
        names.setdefault(ticker, entry["title"])
    return Envelope(
        data=_TickerMap(ciks=ciks, names=names),
        meta=Provenance(source="SEC EDGAR", freshness="filing"),
    )


def parse_submissions(symbol: str, cik: int, payload: dict) -> Filings:
    recent = payload.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    out = []
    for i, form in enumerate(forms):
        accession = recent["accessionNumber"][i].replace("-", "")
        document = recent["primaryDocument"][i]
        out.append(
            Filing(
                form=form,
                filed=recent["filingDate"][i],
                report_date=recent.get("reportDate", [None] * len(forms))[i] or None,
                description=recent.get("primaryDocDescription", [None] * len(forms))[i] or None,
                url=ARCHIVE_URL.format(cik=cik, accession=accession, document=document),
                major=form in MAJOR_FORMS,
            )
        )
    return Filings(symbol=symbol, cik=cik, company=payload.get("name", symbol), filings=out[:200])


@cached(ttl=1800)
def filings(symbol: str) -> Envelope[Filings]:
    ticker = symbol.upper().replace(".", "-")
    mapping = _ticker_map().data
    cik = mapping.ciks.get(ticker)
    if cik is None:
        raise NotFoundError(
            f"'{symbol}' is not an SEC registrant (EDGAR covers U.S.-listed companies only)"
        )
    payload = http.get_json(SUBMISSIONS_URL.format(cik=cik), headers=_headers())
    data = parse_submissions(symbol, cik, payload)
    latest = data.filings[0].filed if data.filings else None
    return Envelope(
        data=data,
        meta=Provenance(
            source="SEC EDGAR",
            source_url=BROWSE_URL.format(cik=cik),
            freshness="filing",
            as_of=as_datetime(date.fromisoformat(latest)) if latest else None,
            notes=["Original filings as submitted to the SEC."],
        ),
    )
