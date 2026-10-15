"""Read-through cache with stale fallback.

Free data providers are rate-limited and occasionally down. Each provider call goes
through `cached(ttl)`:

1. A fresh entry (younger than `ttl`) is returned without touching the network.
2. Otherwise the provider is called and the result stored in memory *and* on disk.
3. If the provider fails and any previous result exists (even one from a previous run of
   the server, thanks to the disk copy), that result is served with `meta.stale = True`.
   The UI flags it, so a demo keeps working offline without pretending the data is current.

Only `Envelope` results are cached, so a stale copy always carries its original provenance.
"""

from __future__ import annotations

import functools
import hashlib
import json
import logging
import os
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, get_type_hints

from pydantic import BaseModel

from tessera.errors import NotFoundError, TesseraError, UpstreamError

log = logging.getLogger(__name__)

DEFAULT_DIR = Path(__file__).resolve().parents[2] / ".cache"


class Cache:
    def __init__(self, directory: Path | None = DEFAULT_DIR) -> None:
        self.directory = directory
        self._memory: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()
        if directory is not None:
            directory.mkdir(parents=True, exist_ok=True)

    def _lock_for(self, key: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def _path(self, key: str) -> Path | None:
        if self.directory is None:
            return None
        return self.directory / (hashlib.sha1(key.encode()).hexdigest() + ".json")

    def _load(self, key: str) -> tuple[float, Any] | None:
        if key in self._memory:
            return self._memory[key]
        path = self._path(key)
        if path is None or not path.exists():
            return None
        try:
            blob = json.loads(path.read_text())
            entry = (float(blob["stored_at"]), blob["payload"])
        except (OSError, ValueError, KeyError):
            return None
        self._memory[key] = entry
        return entry

    def _store(self, key: str, payload: Any) -> None:
        entry = (time.time(), payload)
        self._memory[key] = entry
        path = self._path(key)
        if path is not None:
            try:
                path.write_text(json.dumps({"key": key, "stored_at": entry[0], "payload": payload}))
            except OSError as exc:  # the disk copy is a convenience, never fatal
                log.warning("cache write failed for %s: %s", key, exc)

    def get_or_fetch[M: BaseModel](
        self, key: str, ttl: float, fetch: Callable[[], M], model: type[M]
    ) -> M:
        # One fetch per key at a time: concurrent panes asking for the same quote share it.
        with self._lock_for(key):
            entry = self._load(key)
            if entry is not None and time.time() - entry[0] < ttl:
                return model.model_validate(entry[1])
            try:
                result = fetch()
            except NotFoundError:
                raise
            except Exception as exc:
                if entry is None:
                    if isinstance(exc, TesseraError):
                        raise
                    raise UpstreamError(f"{type(exc).__name__}: {exc}") from exc
                log.warning("serving stale %s after provider error: %s", key, exc)
                stale = model.model_validate(entry[1])
                meta = getattr(stale, "meta", None)
                if meta is not None:
                    meta.stale = True
                return stale
            self._store(key, result.model_dump(mode="json"))
            return result

    def clear(self) -> None:
        self._memory.clear()


CACHE = Cache(None if os.environ.get("TESSERA_NO_DISK_CACHE") else DEFAULT_DIR)


def cached[**P, M: BaseModel](ttl: float) -> Callable[[Callable[P, M]], Callable[P, M]]:
    """Cache a provider function's `Envelope` result for `ttl` seconds (see module docs)."""

    def decorate(fn: Callable[P, M]) -> Callable[P, M]:
        model: type[M] = get_type_hints(fn)["return"]

        @functools.wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> M:
            key = f"{fn.__module__}.{fn.__qualname__}:" + json.dumps(
                [args, kwargs], sort_keys=True, default=str
            )
            return CACHE.get_or_fetch(key, ttl, lambda: fn(*args, **kwargs), model)

        return wrapper

    return decorate
