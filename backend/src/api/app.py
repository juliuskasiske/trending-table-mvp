"""Trending Table API (FastAPI)."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .. import config
from ..db.connection import app_connection, get_control_connection
from .routes import (
    admin,
    auth,
    billing,
    campaigns,
    config as config_routes,
    creator,
    menu,
    metering,
    places,
    restaurants,
)

# Fail closed on weak/missing secrets before the app serves any request (prod).
config.validate_production_config()

app = FastAPI(title="Trending Table API", version="0.1.0")

# The SPA (Vite) calls the API with cookies. In dev it may hit :8000 directly;
# in prod it's same-origin behind a proxy. Allow the configured SPA origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.APP_BASE_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(config_routes.router)
app.include_router(places.router)
app.include_router(restaurants.router)
app.include_router(billing.router)
app.include_router(campaigns.router)
app.include_router(creator.router)
app.include_router(menu.router)
app.include_router(metering.router)
app.include_router(admin.router)


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
