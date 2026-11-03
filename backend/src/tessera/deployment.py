"""How this instance is deployed.

A public demo serves data to anyone who opens it, so it keeps within what the sources allow:
Yahoo Finance's terms cover personal use, and some FRED series are republished under licence
from their owners. Every function still works; only redistribution paths are closed (direct
API access, bulk export of Yahoo data, third-party FRED series). Set TESSERA_PUBLIC_DEMO=1.
"""

from __future__ import annotations

import os


def public_demo() -> bool:
    return os.environ.get("TESSERA_PUBLIC_DEMO", "").strip().lower() in {"1", "true", "yes"}
