"""One shared HTTP client for the plain-HTTP providers (Yahoo goes through yfinance)."""

from __future__ import annotations

import httpx

from tessera.errors import NotFoundError, UpstreamError

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) TesseraTerminal/0.1"

_client = httpx.Client(
    timeout=httpx.Timeout(15.0, connect=5.0),
    headers={"User-Agent": USER_AGENT},
    follow_redirects=True,
)


def get_text(url: str, *, params: dict | None = None, headers: dict | None = None) -> str:
    return _get(url, params=params, headers=headers).text


def get_json(url: str, *, params: dict | None = None, headers: dict | None = None):
    return _get(url, params=params, headers=headers).json()


def _get(url: str, *, params: dict | None, headers: dict | None) -> httpx.Response:
    try:
        response = _client.get(url, params=params, headers=headers)
    except httpx.HTTPError as exc:
        raise UpstreamError(f"{url}: {type(exc).__name__}") from exc
    if response.status_code == 404:
        raise NotFoundError(f"{url}: not found")
    if response.status_code >= 400:
        raise UpstreamError(f"{url}: HTTP {response.status_code}")
    return response
