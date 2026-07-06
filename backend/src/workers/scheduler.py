"""In-process scheduler for the metrics poller.

A single daemon thread runs `poll_once` every METRICS_POLL_INTERVAL_SECONDS.
Disabled unless that interval is > 0, so dev/test never accrue mock charges.
Started/stopped from the API's lifespan (see api.app).

This deliberately avoids an external scheduler dependency; for multi-worker
deployments run the poller as a single separate process/cron instead and leave
the interval at 0 in the web workers.
"""
from __future__ import annotations

import logging
import threading

from .. import config
from .metrics_poller import poll_once

log = logging.getLogger("metrics_scheduler")

_stop = threading.Event()
_thread: threading.Thread | None = None


def _loop(interval: int) -> None:
    # Wait one interval before the first pass (avoids polling on every boot).
    while not _stop.wait(interval):
        try:
            results = poll_once()
            billed = sum(int(r.get("billed_views") or 0) for r in results)
            errors = sum(1 for r in results if r.get("error"))
            log.info("metrics poll: %d posts, %d views billed, %d errors",
                     len(results), billed, errors)
        except Exception:
            log.exception("metrics poll pass failed")


def start() -> None:
    global _thread
    interval = config.METRICS_POLL_INTERVAL_SECONDS
    if interval <= 0 or _thread is not None:
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, args=(interval,), name="metrics-poller", daemon=True)
    _thread.start()
    log.info("metrics poller scheduled every %ds", interval)


def stop() -> None:
    global _thread
    _stop.set()
    _thread = None
