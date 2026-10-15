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


def test_option_endpoints_explain_a_missing_derivlab(monkeypatch):
    import sys

    import tessera

    # Simulate a checkout without project 05: importing derivlab fails, and the options
    # module must be re-imported (other tests may have loaded it already).
    monkeypatch.setitem(sys.modules, "derivlab", None)
    monkeypatch.delitem(sys.modules, "tessera.options", raising=False)
    monkeypatch.delattr(tessera, "options", raising=False)
    response = client.get("/api/options/chain", params={"symbol": "SPY"})
    assert response.status_code == 503
    assert "derivlab" in response.json()["detail"]
    assert client.get("/api/health").status_code == 200  # everything else still works


def test_rate_limiter_refills_over_time(monkeypatch):
    from tessera_api.main import RateLimiter

    clock = [1000.0]
    monkeypatch.setattr("tessera_api.main.time.monotonic", lambda: clock[0])
    limiter = RateLimiter(per_minute=2)
    assert limiter.allow("a") and limiter.allow("a")
    assert not limiter.allow("a")
    assert limiter.allow("b")  # buckets are per client
    clock[0] += 30  # half a minute refills one token
    assert limiter.allow("a") and not limiter.allow("a")


def test_api_responses_carry_security_headers_and_429_when_limited(monkeypatch):
    from tessera_api.main import RateLimiter

    r = client.get("/api/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    monkeypatch.setattr(main.app.state, "limiter", RateLimiter(per_minute=1))
    # An invalid symbol is rejected locally (422), so no provider is called.
    statuses = [
        client.get("/api/securities/profile", params={"symbol": "../x"}).status_code
        for _ in range(2)
    ]
    assert statuses == [422, 429]
