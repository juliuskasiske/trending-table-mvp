"""Owner 'control tower': read-only reporting over the control database.

Every endpoint is gated by ``deps.require_admin`` (a single ADMIN_KEY sent in
the X-Admin-Key header). Only non-sensitive columns are exposed — never
password hashes, session tokens, verification tokens, or encrypted OAuth secrets.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from psycopg.rows import dict_row

from .. import deps
from ...db.connection import get_control_connection

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/overview")
def overview(_: None = Depends(deps.require_admin)) -> dict:
    """Top-line funnel metrics for the whole platform."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT count(*)                                                          AS total,
                   count(email_verified_at)                                          AS verified,
                   count(*) FILTER (WHERE created_at > now() - interval '7 days')     AS last_7d,
                   count(*) FILTER (WHERE created_at > now() - interval '30 days')    AS last_30d
            FROM accounts
            """
        )
        accounts = cur.fetchone()

        cur.execute(
            """
            SELECT count(*)                                     AS total,
                   count(*) FILTER (WHERE status = 'active')    AS active
            FROM restaurants
            """
        )
        restaurants = cur.fetchone()

        cur.execute("SELECT status, count(*) AS n FROM restaurants GROUP BY status ORDER BY status")
        by_status = {r["status"]: r["n"] for r in cur.fetchall()}

        cur.execute("SELECT count(*) AS total, count(email_verified_at) AS verified FROM creators")
        creators = cur.fetchone()

    return {
        "accounts": accounts,
        "restaurants": {**restaurants, "by_status": by_status},
        "creators": creators,
    }


@router.get("/restaurants")
def restaurants(_: None = Depends(deps.require_admin)) -> dict:
    """Every restaurant onboarded, with its owner email(s) and budget."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT r.id, r.name, r.status, r.spending_limit_eur, r.created_at,
                   count(m.account_id)                                              AS member_count,
                   coalesce(
                       string_agg(DISTINCT a.email, ', ' ORDER BY a.email)
                       FILTER (WHERE m.role = 'owner'), '')                          AS owner_emails
            FROM restaurants r
            LEFT JOIN memberships m ON m.restaurant_id = r.id
            LEFT JOIN accounts a    ON a.id = m.account_id
            GROUP BY r.id
            ORDER BY r.created_at DESC
            LIMIT 1000
            """
        )
        return {"restaurants": cur.fetchall()}


@router.get("/accounts")
def accounts(_: None = Depends(deps.require_admin)) -> dict:
    """Every restaurant-side account, with verification state and restaurant count."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT a.id, a.email, a.display_name,
                   (a.email_verified_at IS NOT NULL) AS email_verified,
                   a.created_at,
                   count(m.restaurant_id)            AS restaurant_count,
                   coalesce(
                       string_agg(DISTINCT r.name, ', ' ORDER BY r.name)
                       FILTER (WHERE r.id IS NOT NULL AND r.name <> ''), '')  AS restaurants
            FROM accounts a
            LEFT JOIN memberships m  ON m.account_id = a.id
            LEFT JOIN restaurants r  ON r.id = m.restaurant_id
            GROUP BY a.id
            ORDER BY a.created_at DESC
            LIMIT 1000
            """
        )
        return {"accounts": cur.fetchall()}


@router.get("/creators")
def creators(_: None = Depends(deps.require_admin)) -> dict:
    """Every creator-side account."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT id, email, display_name, status,
                   (email_verified_at IS NOT NULL) AS email_verified,
                   created_at
            FROM creators
            ORDER BY created_at DESC
            LIMIT 1000
            """
        )
        return {"creators": cur.fetchall()}
