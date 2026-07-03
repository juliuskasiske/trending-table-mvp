"""Lightweight in-memory, per-IP rate limiting.

Fixed-window counters kept in process memory — good enough for the single-box,
single-process uvicorn deploy this ships as. (If we ever scale to multiple
workers/hosts, move this to Redis.) Behind Caddy the real client IP arrives in
X-Forwarded-For, so we read that first hop.
"""
from __future__ import annotations

import threading
import time

from fastapi import HTTPException, Request

_lock = threading.Lock()
_buckets: dict[str, tuple[float, int]] = {}  # key -> (window_start, count)


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _allow(key: str, limit: int, window: float) -> bool:
    now = time.monotonic()
    with _lock:
        # Opportunistic prune so the dict can't grow unbounded.
        if len(_buckets) > 10_000:
            for k, (start, _) in list(_buckets.items()):
                if now - start > window:
                    _buckets.pop(k, None)
        start, count = _buckets.get(key, (now, 0))
        if now - start > window:
            start, count = now, 0
        count += 1
        _buckets[key] = (start, count)
        return count <= limit


def rate_limit(name: str, limit: int, window_seconds: float = 60.0):
    """FastAPI dependency: allow at most `limit` requests per `window` per IP."""
    def dependency(request: Request) -> None:
        if not _allow(f"{name}:{_client_ip(request)}", limit, window_seconds):
            raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")
    return dependency
