"""Curated cross-market monitors (WEI, CMDTY) built on batched Yahoo quotes."""

from __future__ import annotations

from pydantic import BaseModel

from tessera.errors import NotFoundError
from tessera.models import Envelope
from tessera.providers import yahoo

# monitor -> [(group, [(symbol, name, region/unit tag)])]
MONITORS: dict[str, list[tuple[str, list[tuple[str, str, str]]]]] = {
    "WEI": [
        ("Americas", [
            ("^GSPC", "S&P 500", "US"),
            ("^DJI", "Dow Jones Industrial", "US"),
            ("^IXIC", "Nasdaq Composite", "US"),
            ("^RUT", "Russell 2000", "US"),
            ("^GSPTSE", "S&P/TSX Composite", "CA"),
            ("^BVSP", "Ibovespa", "BR"),
            ("^MXX", "S&P/BMV IPC", "MX"),
        ]),
        ("Europe, Middle East & Africa", [
            ("^STOXX50E", "Euro Stoxx 50", "EU"),
            ("^STOXX", "Stoxx Europe 600", "EU"),
            ("^FTSE", "FTSE 100", "GB"),
            ("^GDAXI", "DAX", "DE"),
            ("^FCHI", "CAC 40", "FR"),
            ("FTSEMIB.MI", "FTSE MIB", "IT"),
            ("^IBEX", "IBEX 35", "ES"),
            ("^AEX", "AEX", "NL"),
            ("^SSMI", "Swiss Market Index", "CH"),
            ("XU100.IS", "BIST 100", "TR"),
        ]),
        ("Asia Pacific", [
            ("^N225", "Nikkei 225", "JP"),
            ("^HSI", "Hang Seng", "HK"),
            ("000001.SS", "Shanghai Composite", "CN"),
            ("^KS11", "KOSPI", "KR"),
            ("^TWII", "Taiwan Weighted", "TW"),
            ("^NSEI", "Nifty 50", "IN"),
            ("^AXJO", "S&P/ASX 200", "AU"),
            ("^STI", "Straits Times", "SG"),
        ]),
        ("Volatility & dollar", [
            ("^VIX", "CBOE Volatility Index", "US"),
            ("DX-Y.NYB", "US Dollar Index", "US"),
        ]),
    ],
    "CMDTY": [
        ("Energy", [
            ("CL=F", "WTI crude oil", "USD/bbl"),
            ("BZ=F", "Brent crude oil", "USD/bbl"),
            ("NG=F", "Natural gas (Henry Hub)", "USD/MMBtu"),
            ("RB=F", "RBOB gasoline", "USD/gal"),
            ("HO=F", "Heating oil", "USD/gal"),
        ]),
        ("Metals", [
            ("GC=F", "Gold", "USD/oz"),
            ("SI=F", "Silver", "USD/oz"),
            ("PL=F", "Platinum", "USD/oz"),
            ("PA=F", "Palladium", "USD/oz"),
            ("HG=F", "Copper", "USD/lb"),
        ]),
        ("Agriculture", [
            ("ZC=F", "Corn", "USc/bu"),
            ("ZW=F", "Wheat", "USc/bu"),
            ("ZS=F", "Soybeans", "USc/bu"),
            ("KC=F", "Coffee", "USc/lb"),
            ("SB=F", "Sugar #11", "USc/lb"),
            ("CC=F", "Cocoa", "USD/t"),
            ("CT=F", "Cotton", "USc/lb"),
            ("LE=F", "Live cattle", "USc/lb"),
        ]),
    ],
}  # fmt: skip


class MonitorRow(BaseModel):
    symbol: str
    name: str
    tag: str
    quote: yahoo.Quote | None


class MonitorGroup(BaseModel):
    name: str
    rows: list[MonitorRow]


class Monitor(BaseModel):
    id: str
    groups: list[MonitorGroup]


def monitor(monitor_id: str) -> Envelope[Monitor]:
    layout = MONITORS.get(monitor_id.upper())
    if layout is None:
        raise NotFoundError(f"Unknown monitor '{monitor_id}'")
    symbols = tuple(symbol for _, rows in layout for symbol, _, _ in rows)
    batch = yahoo.quotes(symbols)
    by_symbol = {q.symbol: q for q in batch.data}
    groups = [
        MonitorGroup(
            name=group,
            rows=[MonitorRow(symbol=s, name=n, tag=t, quote=by_symbol.get(s)) for s, n, t in rows],
        )
        for group, rows in layout
    ]
    return Envelope(data=Monitor(id=monitor_id.upper(), groups=groups), meta=batch.meta)
