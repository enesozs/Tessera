import pytest

from tessera.cache import Cache
from tessera.errors import NotFoundError, UpstreamError
from tessera.models import Envelope, Provenance


def envelope(value: int) -> Envelope[int]:
    return Envelope(data=value, meta=Provenance(source="test", freshness="delayed"))


class Flaky:
    def __init__(self) -> None:
        self.calls = 0
        self.fail: Exception | None = None

    def __call__(self) -> Envelope[int]:
        self.calls += 1
        if self.fail:
            raise self.fail
        return envelope(self.calls)


def test_fresh_entries_are_served_without_refetching():
    cache, fetch = Cache(None), Flaky()
    first = cache.get_or_fetch("k", 60, fetch, Envelope[int])
    second = cache.get_or_fetch("k", 60, fetch, Envelope[int])
    assert (first.data, second.data, fetch.calls) == (1, 1, 1)


def test_expired_entries_are_refetched():
    cache, fetch = Cache(None), Flaky()
    cache.get_or_fetch("k", 0, fetch, Envelope[int])
    assert cache.get_or_fetch("k", 0, fetch, Envelope[int]).data == 2


def test_provider_failure_serves_the_last_value_marked_stale():
    cache, fetch = Cache(None), Flaky()
    cache.get_or_fetch("k", 0, fetch, Envelope[int])
    fetch.fail = RuntimeError("provider down")
    result = cache.get_or_fetch("k", 0, fetch, Envelope[int])
    assert result.data == 1
    assert result.meta.stale is True


def test_failure_without_a_cached_value_raises_upstream_error():
    fetch = Flaky()
    fetch.fail = RuntimeError("provider down")
    with pytest.raises(UpstreamError):
        Cache(None).get_or_fetch("k", 60, fetch, Envelope[int])


def test_not_found_is_never_masked_by_stale_data():
    cache, fetch = Cache(None), Flaky()
    cache.get_or_fetch("k", 0, fetch, Envelope[int])
    fetch.fail = NotFoundError("gone")
    with pytest.raises(NotFoundError):
        cache.get_or_fetch("k", 0, fetch, Envelope[int])


def test_disk_copy_survives_a_restart(tmp_path):
    fetch = Flaky()
    Cache(tmp_path).get_or_fetch("k", 0, fetch, Envelope[int])
    fetch.fail = RuntimeError("offline")
    result = Cache(tmp_path).get_or_fetch("k", 0, fetch, Envelope[int])
    assert result.data == 1 and result.meta.stale
