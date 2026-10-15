from datetime import date

import pytest

from tessera.providers import rates

TREASURY_CSV = """Date,"1 Mo","2 Mo","3 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"
10/14/2026,4.11,4.15,4.28,4.37,4.53,4.82,4.92,5.00,5.09,5.19,5.57,5.52
10/07/2026,4.07,4.14,4.22,4.28,4.42,4.77,4.87,5.03,5.15,5.28,5.71,5.67
09/12/2026,3.94,4.06,4.11,4.18,4.37,4.65,4.73,4.80,4.88,4.97,5.37,5.34
10/14/2025,4.19,4.08,4.02,3.80,3.58,3.48,3.47,3.60,3.79,4.03,4.59,4.62
"""


def test_treasury_csv_maps_columns_and_leaves_missing_tenors_empty():
    rows = rates.parse_treasury_csv(TREASURY_CSV)
    latest = rows[date(2026, 10, 14)]
    labels = [label for _, label, _ in rates.US_TENORS]
    assert latest[labels.index("10Y")] == 5.19
    assert latest[labels.index("6W")] is None  # column absent from this file
    assert latest[labels.index("4M")] is None


def test_snapshots_use_last_observation_on_or_before_each_offset():
    curve = rates.build_us_curve(rates.parse_treasury_csv(TREASURY_CSV))
    assert [(s.label, s.date) for s in curve.snapshots] == [
        ("Latest", "2026-10-14"),
        ("1W ago", "2026-10-07"),
        ("1M ago", "2026-09-12"),  # 2026-09-14 target → previous available date
        ("1Y ago", "2025-10-14"),
    ]
    assert curve.history.series["10Y"][-1] == 5.19


def ecb_row(tenor: str, day: str, value: str) -> dict[str, str]:
    return {"DATA_TYPE_FM": tenor, "TIME_PERIOD": day, "OBS_VALUE": value}


def test_ea_curve_pivots_tenors_by_date():
    rows = [
        ecb_row("SR_10Y", "2026-10-14", "3.51"),
        ecb_row("SR_2Y", "2026-10-14", "2.10"),
        ecb_row("SR_10Y", "2026-10-13", "3.49"),
    ]
    curve = rates.build_ea_curve(rows, "AAA")
    latest = curve.snapshots[0]
    assert latest.date == "2026-10-14"
    assert latest.yields[curve.tenors.index("10Y")] == 3.51
    assert latest.yields[curve.tenors.index("3M")] is None


def test_sovereign_spreads_are_in_basis_points_versus_germany():
    rows = [
        {"REF_AREA": "DE", "TIME_PERIOD": "2026-08", "OBS_VALUE": "2.70"},
        {"REF_AREA": "IT", "TIME_PERIOD": "2026-08", "OBS_VALUE": "3.986"},
        {"REF_AREA": "IT", "TIME_PERIOD": "2026-09", "OBS_VALUE": "4.10"},
    ]
    data = rates.build_sovereign(rows, ("DE", "IT"))
    italy = next(s for s in data.series if s.country == "IT")
    assert data.months == ["2026-08", "2026-09"]
    assert italy.spread_bp == [pytest.approx(128.6), None]  # no Bund print for September
