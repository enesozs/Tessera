from datetime import date

import pytest

from tessera.providers import fx, macro


def test_fred_csv_skips_missing_observations():
    text = "observation_date,DGS10\n2026-10-12,.\n2026-10-13,4.79\n2026-10-14,\n"
    assert macro.parse_fred_csv(text) == [(date(2026, 10, 13), 4.79)]


def test_year_over_year_matches_dates_exactly_one_year_apart():
    points = [(date(2025, 1, 1), 100.0), (date(2025, 6, 1), 101.0), (date(2026, 1, 1), 103.0)]
    out = macro.apply_transform(points, "yoy")
    assert out == [(date(2026, 1, 1), pytest.approx(3.0))]


def test_diff_and_scale():
    points = [(date(2026, 1, 1), 1000.0), (date(2026, 2, 1), 1150.0)]
    assert macro.apply_transform(points, "diff", 0.5) == [(date(2026, 2, 1), 75.0)]


@pytest.mark.parametrize(
    ("step_days", "expected"), [(1, "daily"), (7, "weekly"), (31, "monthly"), (91, "quarterly")]
)
def test_frequency_inference(step_days, expected):
    points = [(date.fromordinal(738000 + i * step_days), 1.0) for i in range(10)]
    assert macro.infer_frequency(points) == expected


def test_every_catalogue_entry_has_a_unique_id():
    ids = [s.id for s in macro.CATALOG]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize(
    ("key", "owner"),
    [
        ("SP500", "S&P"),
        ("DJIA", "S&P"),
        ("NASDAQCOM", "Nasdaq"),
        ("BAMLH0A0HYM2", "ICE"),
        ("USD3MTD156N", "LIBOR"),
        ("DAAA", "Moody"),
        ("BAA10Y", "Moody"),
        ("WILL5000IND", "Wilshire"),
        ("VIXCLS", "Cboe"),
        ("UMCSENT", "Michigan"),
        ("CBBTCUSD", "Coinbase"),
    ],
)
def test_third_party_fred_series_are_recognised(key, owner):
    assert owner in (macro.third_party_owner(key) or "")


@pytest.mark.parametrize("key", ["UNRATE", "DGS10", "GDPC1", "CPIAUCSL", "T10Y2Y", "BAA_X1"])
def test_public_domain_fred_series_are_not_flagged(key):
    assert macro.third_party_owner(key) is None


def test_every_catalogue_series_is_public_domain():
    assert all(macro.third_party_owner(s.key) is None for s in macro.CATALOG)


def test_public_demo_declines_third_party_series(monkeypatch):
    from tessera.errors import NotApplicableError

    assert macro._spec_for("SP500").key == "SP500"  # locally: shown as published
    monkeypatch.setenv("TESSERA_PUBLIC_DEMO", "1")
    with pytest.raises(NotApplicableError, match="S&P Dow Jones"):
        macro._spec_for("SP500")
    assert macro._spec_for("GDPC1").key == "GDPC1"


def test_cross_rates_are_triangular_and_invert():
    eur = {"USD": 1.12, "JPY": 177.0, "GBP": 0.84}
    ccys = ["EUR", "USD", "JPY", "GBP"]
    m = fx.cross_matrix(eur, ccys)
    usd, jpy = ccys.index("USD"), ccys.index("JPY")
    assert m[usd][jpy] == pytest.approx(177.0 / 1.12)  # USD/JPY from two EUR fixings
    assert m[jpy][usd] == pytest.approx(1 / m[usd][jpy])
    assert all(m[i][i] == pytest.approx(1.0) for i in range(len(ccys)))
