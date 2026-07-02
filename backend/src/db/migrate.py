"""
Migration runner.

Idempotent bootstrap for the two databases:

  1. ensure `tt_control` + `tt_app` exist and the restricted `tt_app_rw` role
     exists (created on the maintenance connection);
  2. apply the idempotent control-plane schema to `tt_control`;
  3. apply numbered, tracked migrations from ``migrations/app/`` to `tt_app`.

SQL files are applied with ``psql`` (handles multi-statement scripts, DO blocks,
functions cleanly). Existence checks + migration bookkeeping use psycopg.

Run:  python -m src.db.migrate
"""
from __future__ import annotations

import pathlib
import shutil
import subprocess

import psycopg
from psycopg import sql

from .connection import (
    app_url,
    control_url,
    database_name,
    get_control_connection,
    get_maintenance_connection,
)

HERE = pathlib.Path(__file__).resolve().parent
CONTROL_SCHEMA = HERE / "control_schema.sql"
APP_MIGRATIONS = HERE.parent.parent / "migrations" / "app"
APP_RW_ROLE = "tt_app_rw"


def _psql_apply(url: str, path: pathlib.Path) -> None:
    psql = shutil.which("psql")
    if not psql:
        raise RuntimeError("psql not found on PATH (needed to apply SQL files).")
    subprocess.run(
        [psql, url, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(path)],
        check=True,
    )


def ensure_databases() -> None:
    """Create the control + app databases and the RLS role if they don't exist."""
    control_db = database_name(control_url())
    app_db = database_name(app_url())
    with get_maintenance_connection() as conn, conn.cursor() as cur:
        for name in (control_db, app_db):
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
            if cur.fetchone():
                print(f"  database {name}: exists")
            else:
                # DDL can't take bind params — quote the identifier safely.
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
                print(f"  database {name}: created")
        cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (APP_RW_ROLE,))
        if cur.fetchone():
            print(f"  role {APP_RW_ROLE}: exists")
        else:
            cur.execute(
                sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(
                    sql.Identifier(APP_RW_ROLE), sql.Literal(APP_RW_ROLE)
                )
            )
            print(f"  role {APP_RW_ROLE}: created")


def apply_control() -> None:
    """Apply the idempotent control-plane schema."""
    _psql_apply(control_url(), CONTROL_SCHEMA)
    print(f"  control schema: applied ({CONTROL_SCHEMA.name})")


def apply_app_migrations() -> None:
    """Apply numbered app migrations not yet recorded in schema_migrations."""
    conn = psycopg.connect(app_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "version TEXT PRIMARY KEY, "
                "applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
            )
        conn.commit()

        files = sorted(APP_MIGRATIONS.glob("*.sql")) if APP_MIGRATIONS.exists() else []
        applied_any = False
        for f in files:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM schema_migrations WHERE version = %s", (f.stem,))
                if cur.fetchone():
                    continue
            _psql_apply(app_url(), f)
            with conn.cursor() as cur:
                cur.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (f.stem,))
            conn.commit()
            print(f"  app migration {f.name}: applied")
            applied_any = True
        if not applied_any:
            print("  app migrations: none pending")
    finally:
        conn.close()


def main() -> None:
    print("migrate: ensuring databases + role")
    ensure_databases()
    print("migrate: control plane")
    apply_control()
    print("migrate: app migrations")
    apply_app_migrations()
    print("migrate: done")


if __name__ == "__main__":
    main()
