"""Vercel entrypoint: Vercel installs only the dependencies, so put src/ on sys.path."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from tessera_api.main import app

__all__ = ["app"]
