"""Trending Table API (FastAPI). Phase 1: liveness + DB connectivity."""
from __future__ import annotations

from fastapi import FastAPI

from ..db.connection import app_connection, get_control_connection

app = FastAPI(title="Trending Table API", version="0.1.0")


def _ping(run) -> str:
    try:
        run()
        return "ok"
    except Exception as exc:  # surface the reason in the health payload
        return f"error: {exc}"


@app.get("/healthz")
def healthz() -> dict:
    """Liveness + connectivity to both databases."""

    def ping_control() -> None:
        with get_control_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()

    def ping_app() -> None:
        with app_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()

    checks = {"control_db": _ping(ping_control), "app_db": _ping(ping_app)}
    healthy = all(v == "ok" for v in checks.values())
    return {"status": "ok" if healthy else "degraded", "checks": checks}
