import pytest
from fastapi.testclient import TestClient

from tessera.errors import ConfigurationError, NotFoundError, UpstreamError
from tessera.models import Envelope, Provenance
from tessera.providers import yahoo
from tessera_api import main

client = TestClient(main.app)


@pytest.mark.parametrize(
    ("error", "status"), [(NotFoundError, 404), (UpstreamError, 502), (ConfigurationError, 503)]
)
def test_provider_errors_map_to_http_statuses(monkeypatch, error, status):
    def boom(*_args):
        raise error("nope")

    monkeypatch.setattr(yahoo, "profile", boom)
    response = client.get("/api/securities/profile", params={"symbol": "XYZ"})
    assert response.status_code == status
    assert response.json() == {"detail": "nope", "kind": error.__name__}


def test_symbols_are_validated_and_upper_cased(monkeypatch):
    seen = []

    def fake(symbols):
        seen.append(symbols)
        return Envelope(data=[], meta=Provenance(source="t", freshness="delayed"))

    monkeypatch.setattr(yahoo, "quotes", fake)
    assert client.get("/api/quotes", params={"symbols": "aapl, msft,AAPL"}).status_code == 200
    assert seen == [("AAPL", "MSFT")]
    assert client.get("/api/securities/profile", params={"symbol": "../etc"}).status_code == 422


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}
