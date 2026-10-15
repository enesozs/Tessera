import os

import pandas as pd
import pytest

from tessera.errors import ConfigurationError
from tessera.providers import sec, yahoo


def test_statement_rows_follow_layout_order_and_drop_empty_periods():
    frame = pd.DataFrame(
        {
            pd.Timestamp("2025-12-31"): {"Net Income Common Stockholders": 90.0, "Total Revenue": 500.0, "Obscure": 1.0},
            pd.Timestamp("2024-12-31"): {"Net Income Common Stockholders": 80.0, "Total Revenue": 450.0, "Obscure": 1.0},
            pd.Timestamp("2021-12-31"): {"Net Income Common Stockholders": None, "Total Revenue": None, "Obscure": 1.0},
        }
    )  # fmt: skip
    out = yahoo.statements_from_frame("X", "income", "annual", frame, "EUR")
    assert out.periods == ["2024-12-31", "2025-12-31"]  # oldest first, empty 2021 dropped
    assert [r.label for r in out.rows] == ["Revenue", "Net income to common"]
    assert out.rows[0].values == [450.0, 500.0]


def test_quote_changes_from_daily_closes():
    idx = pd.to_datetime(["2025-12-30", "2025-12-31", "2026-01-15", "2026-02-13", "2026-02-16"])
    closes = [90.0, 100.0, 105.0, 110.0, 121.0]
    q = yahoo._quote_from_closes("X", list(zip(idx, closes, strict=True)))
    assert q.last == 121.0
    assert q.change_pct == pytest.approx(0.1)
    assert q.change_ytd_pct == pytest.approx(0.21)  # versus the last close of 2025
    assert q.change_1m_pct == pytest.approx(121 / 105 - 1)  # last close on/before 16 Jan


RSS = """<?xml version="1.0"?><rss><channel>
<item><title>Older</title><link>https://a</link><pubDate>Mon, 12 Oct 2026 08:00:00 +0000</pubDate></item>
<item><title>Newer</title><link>https://b</link><pubDate>Tue, 13 Oct 2026 21:10:41 +0000</pubDate>
<description>Summary</description></item>
<item><title></title><link>https://c</link></item>
</channel></rss>"""


def test_rss_parsing_sorts_newest_first_and_skips_untitled_items():
    items = yahoo.parse_rss(RSS)
    assert [i.title for i in items] == ["Newer", "Older"]
    assert items[0].summary == "Summary"


def test_sec_requires_a_contact_user_agent(monkeypatch):
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    with pytest.raises(ConfigurationError):
        sec._headers()
    monkeypatch.setenv("SEC_USER_AGENT", "Tessera test you@example.com")
    assert sec._headers()["User-Agent"].endswith("@example.com")
    assert "SEC_USER_AGENT" in os.environ


def test_sec_filing_urls_point_at_the_archive():
    payload = {
        "name": "Ferrari N.V.",
        "filings": {
            "recent": {
                "form": ["6-K", "4"],
                "accessionNumber": ["0001-26-000123", "0001-26-000124"],
                "filingDate": ["2026-10-01", "2026-09-30"],
                "reportDate": ["", "2026-09-29"],
                "primaryDocument": ["doc.htm", "form4.xml"],
                "primaryDocDescription": ["6-K", ""],
            }
        },
    }
    out = sec.parse_submissions("RACE", 1648416, payload)
    assert (
        out.filings[0].url == "https://www.sec.gov/Archives/edgar/data/1648416/000126000123/doc.htm"
    )
    assert out.filings[0].major and not out.filings[1].major
    assert out.filings[0].report_date is None
