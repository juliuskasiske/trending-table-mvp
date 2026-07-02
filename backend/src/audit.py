"""Append a row to the control-plane audit_log."""
from __future__ import annotations

import psycopg
from psycopg.types.json import Json


def record(conn: psycopg.Connection, action: str, *, actor: str | None = None,
           detail: dict | None = None, account_id: int | None = None,
           creator_id: int | None = None, restaurant_id: int | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO audit_log (actor, action, detail, account_id, creator_id, restaurant_id)"
            " VALUES (%s, %s, %s, %s, %s, %s)",
            (actor, action, Json(detail or {}), account_id, creator_id, restaurant_id),
        )
    conn.commit()
