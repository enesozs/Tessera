"""Shared response types.

Every payload the terminal serves is wrapped in an `Envelope`: the data itself plus a
`Provenance` record saying where it came from, how fresh it is and whether it was served
from cache after the upstream provider failed. The UI prints this under every pane, so a
number is never shown without its source and timestamp.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

# How current the data is, from the provider's point of view (not ours):
#   delayed    – intraday quotes published with a delay (Yahoo: ~15 min for most venues)
#   end_of_day – one observation per trading day, published after the close
#   reference  – official fixings published once per day (ECB FX reference rates)
#   periodic   – economic statistics released monthly/quarterly, subject to revision
#   filing     – company disclosures (financial statements, SEC filings)
Freshness = Literal["delayed", "end_of_day", "reference", "periodic", "filing"]


def utcnow() -> datetime:
    return datetime.now(UTC)


class Provenance(BaseModel):
    source: str = Field(description="Human-readable provider name, e.g. 'U.S. Treasury'")
    source_url: str | None = Field(default=None, description="Where a human can verify the data")
    freshness: Freshness
    as_of: datetime | None = Field(default=None, description="Timestamp of the latest observation")
    retrieved_at: datetime = Field(default_factory=utcnow)
    stale: bool = Field(default=False, description="Served from cache because the provider failed")
    notes: list[str] = Field(default_factory=list, description="Methodology caveats")


class Envelope[T](BaseModel):
    data: T
    meta: Provenance
