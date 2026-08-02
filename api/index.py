"""Vercel entry point.

Vercel looks for an ASGI callable named `app` in a file under api/. The real application
lives one directory up so that the deployed tree mirrors the desktop tool file for file,
which is what makes the two comparable when a change has to be made in both.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from web import app  # noqa: E402  (path set above must run first)

__all__ = ["app"]
