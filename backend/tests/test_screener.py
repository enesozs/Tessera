import pytest

from tessera import screener
from tessera.screener import QueryError, parse, to_yahoo


def test_full_blueprint_query():
    q = parse("FIND EQUITIES WHERE COUNTRY = IT AND ROE > 10% SORT BY PE ASC LIMIT 20")
    assert to_yahoo(q.where) == {
        "operator": "and",
        "operands": [
            {"operator": "eq", "operands": ["region", "it"]},
            {"operator": "gt", "operands": ["returnonequity.lasttwelvemonths", 10.0]},
        ],
    }
    assert (q.sort_field, q.ascending, q.limit) == ("PE", True, 20)


def test_precedence_parentheses_between_and_in():
    q = parse(
        "sector = tech and (pe between 5 and 15 or divyield >= 4) and country in (de, france)"
    )
    tree = to_yahoo(q.where)
    assert tree["operator"] == "and"
    sector, either, countries = tree["operands"]
    assert sector == {"operator": "eq", "operands": ["sector", "Technology"]}
    assert either["operator"] == "or"
    assert either["operands"][0] == {
        "operator": "btwn",
        "operands": ["peratio.lasttwelvemonths", 5.0, 15.0],
    }
    assert countries == {
        "operator": "or",
        "operands": [
            {"operator": "eq", "operands": ["region", "de"]},
            {"operator": "eq", "operands": ["region", "fr"]},
        ],
    }


def test_number_suffixes_and_multi_word_categories():
    q = parse("MKTCAP >= 2.5B AND SECTOR = Financial Services AND AVGVOL > 500K")
    ops = to_yahoo(q.where)["operands"]
    assert ops[0]["operands"][1] == 2.5e9
    assert ops[1]["operands"][1] == "Financial Services"
    assert ops[2]["operands"][1] == 500e3


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("ROE > ", "ended early"),
        ("FOO > 3", "Unknown field"),
        ("COUNTRY > IT", "category"),
        ("COUNTRY = ATLANTIS", "Unknown country"),
        ("SECTOR = CONSUMER", "Unknown sector"),  # ambiguous: Cyclical or Defensive
        ("PE > 10% ", "% only applies"),
        ("ROE > 10 ROA > 5", "combine conditions"),
        ("PE > 3 LIMIT 1000", "LIMIT"),
    ],
)
def test_helpful_errors(text, message):
    with pytest.raises(QueryError, match=message):
        parse(text)


def test_size_filters_without_a_country_warn_about_currencies():
    assert screener.warnings_for(parse("MKTCAP > 1T"))
    assert not screener.warnings_for(
        parse("MKTCAP > 1T AND COUNTRY = US")
    )  # U.S. listings are primary
    assert screener.warnings_for(parse("ROE > 20 SORT BY MKTCAP DESC"))  # default sort is size too


def test_description_is_readable():
    assert (
        screener.describe(parse("country = it and roe > 15%").where) == "COUNTRY = IT AND ROE > 15%"
    )


def test_sizes_are_described_with_suffixes():
    assert screener.describe(parse("mktcap > 2.5B").where) == "MKTCAP > 2.5B"


def test_non_us_country_filters_warn_about_secondary_listings():
    warnings = screener.warnings_for(parse("COUNTRY = DE AND PE < 20"))
    assert any("secondary listings" in w for w in warnings)
    assert not screener.warnings_for(parse("COUNTRY = US AND PE < 20"))
