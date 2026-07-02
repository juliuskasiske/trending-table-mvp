"""
The connection layer — the one place that knows how to reach a database.

Trending Table runs **two databases** on one Postgres server:

  * the **control plane** (``tt_control``): identities, auth, the marketplace
    graph, billing, audit. Reached via ``get_control_connection``.
  * the **tenant app** (``tt_app``): each restaurant's private data (profile,
    menu, guidelines), one shared database with **Row-Level Security**. Reached
    via ``app_connection(tenant_id)``, which sets ``app.current_tenant`` so RLS
    scopes every query to that restaurant.
  * the **maintenance** DB (``postgres``): used only to ``CREATE DATABASE``
    during setup. Reached via ``get_maintenance_connection`` (autocommit).

URLs come from the environment (see ``.env.example``). The maintenance URL is
derived from the control URL by swapping the database name, unless
``MAINTENANCE_DATABASE_URL`` is set explicitly.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator
from urllib.parse import urlsplit, urlunsplit

import psycopg
from dotenv import load_dotenv

# Load .env once, when this module is first imported.
load_dotenv()


# --- URL helpers ------------------------------------------------------------

def _swap_database(url: str, dbname: str) -> str:
    """Return ``url`` with its database (path) component replaced by ``dbname``."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "/" + dbname, parts.query, parts.fragment))


def database_name(url: str) -> str:
    """The database name embedded in a Postgres URL."""
    return urlsplit(url).path.lstrip("/")


def control_url() -> str:
    url = os.environ.get("CONTROL_DATABASE_URL")
    if not url:
        raise RuntimeError("CONTROL_DATABASE_URL is not set (see .env.example).")
    return url


def app_url() -> str:
    """Owner connection to tt_app — used by migrations (DDL), NOT at runtime."""
    url = os.environ.get("APP_DATABASE_URL")
    if not url:
        raise RuntimeError("APP_DATABASE_URL is not set (see .env.example).")
    return url


def app_rw_url() -> str:
    """Runtime connection to tt_app as the restricted role tt_app_rw.

    RLS is bypassed by superusers/owners, so all *runtime* tenant queries must
    use this non-owner role. Defaults to the app URL with the user swapped to
    ``tt_app_rw`` when ``APP_RW_DATABASE_URL`` isn't set explicitly.
    """
    explicit = os.environ.get("APP_RW_DATABASE_URL")
    if explicit:
        return explicit
    parts = urlsplit(app_url())
    host = parts.hostname or "localhost"
    netloc = f"tt_app_rw:tt_app_rw@{host}"
    if parts.port:
        netloc += f":{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def maintenance_url() -> str:
    """URL of the maintenance database (``postgres``) — for CREATE DATABASE only."""
    explicit = os.environ.get("MAINTENANCE_DATABASE_URL")
    if explicit:
        return explicit
    return _swap_database(control_url(), "postgres")


# --- Connections ------------------------------------------------------------

def get_control_connection() -> psycopg.Connection:
    """Open a connection to the shared control-plane database."""
    return psycopg.connect(control_url())


def get_maintenance_connection() -> psycopg.Connection:
    """Autocommit connection to the maintenance DB for CREATE DATABASE."""
    return psycopg.connect(maintenance_url(), autocommit=True)


@contextmanager
def app_connection(tenant_id: int | None = None) -> Iterator[psycopg.Connection]:
    """Open a connection to the tenant-app database.

    Pass ``tenant_id`` to scope the connection to one restaurant: it sets the
    ``app.current_tenant`` GUC that the RLS policies read, so every query only
    sees that restaurant's rows. Always use this (never a bare connect) for
    tenant data, so isolation can't be forgotten.
    """
    conn = psycopg.connect(app_rw_url())
    try:
        if tenant_id is not None:
            with conn.cursor() as cur:
                # set_config(name, value, is_local=false) → session-scoped.
                cur.execute(
                    "SELECT set_config('app.current_tenant', %s, false)",
                    (str(tenant_id),),
                )
            conn.commit()
        yield conn
    finally:
        conn.close()
