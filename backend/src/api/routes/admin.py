"""Owner 'control tower': read-only reporting over the control database.

Every endpoint is gated by ``deps.require_admin`` (a single ADMIN_KEY sent in
the X-Admin-Key header). Only non-sensitive columns are exposed — never
password hashes, session tokens, verification tokens, or encrypted OAuth secrets.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends
from psycopg.rows import dict_row

from .. import deps
from ...db.connection import get_control_connection

router = APIRouter(prefix="/api/admin", tags=["admin"])

# €/month platform fee, baked into each restaurant's monthly spending limit.
PLATFORM_FEE = Decimal("50")


@router.get("/overview")
def overview(_: None = Depends(deps.require_admin)) -> dict:
    """Funnels (restaurant + creator), payment totals, and headline stats."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        # --- restaurant-side accounts funnel ---
        cur.execute(
            """
            SELECT count(*)                                                        AS total,
                   count(email_verified_at)                                        AS verified,
                   count(*) FILTER (WHERE created_at > now() - interval '7 days')   AS last_7d,
                   count(*) FILTER (WHERE created_at > now() - interval '30 days')  AS last_30d
            FROM accounts
            """
        )
        a = cur.fetchone()

        cur.execute("SELECT count(DISTINCT account_id) AS n FROM memberships")
        with_restaurant = cur.fetchone()["n"]

        cur.execute(
            """
            SELECT count(DISTINCT m.account_id) AS n
            FROM memberships m JOIN restaurants r ON r.id = m.restaurant_id
            WHERE r.status = 'active'
            """
        )
        with_active = cur.fetchone()["n"]

        cur.execute(
            "SELECT count(*) AS n FROM ("
            "  SELECT account_id FROM memberships GROUP BY account_id HAVING count(*) > 1"
            ") t"
        )
        multi_owners = cur.fetchone()["n"]

        # --- restaurants + payments ---
        # A restaurant is "verified" (payment-capable) when its owner's email is
        # confirmed. Only these produce real revenue, so spending limits are
        # summed over verified restaurants only.
        cur.execute(
            """
            WITH rv AS (
                SELECT r.id, r.status, r.spending_limit_eur,
                       bool_or(a.email_verified_at IS NOT NULL) AS owner_verified
                FROM restaurants r
                LEFT JOIN memberships m ON m.restaurant_id = r.id AND m.role = 'owner'
                LEFT JOIN accounts a    ON a.id = m.account_id
                GROUP BY r.id, r.status, r.spending_limit_eur
            )
            SELECT count(*)                                                    AS total,
                   count(*) FILTER (WHERE status = 'active')                   AS active,
                   count(*) FILTER (WHERE owner_verified)                      AS verified,
                   COALESCE(sum(spending_limit_eur), 0)                        AS all_limit,
                   COALESCE(sum(spending_limit_eur)
                            FILTER (WHERE owner_verified), 0)                  AS verified_limit,
                   COALESCE(avg(spending_limit_eur)
                            FILTER (WHERE owner_verified), 0)                  AS verified_avg
            FROM rv
            """
        )
        r = cur.fetchone()

        cur.execute("SELECT status, count(*) AS n FROM restaurants GROUP BY status ORDER BY status")
        by_status = {row["status"]: row["n"] for row in cur.fetchall()}

        # --- creator funnel ---
        cur.execute(
            """
            SELECT count(*)                                        AS total,
                   count(*) FILTER (WHERE status = 'active')       AS active,
                   count(email_verified_at)                        AS verified
            FROM creators
            """
        )
        c = cur.fetchone()

        cur.execute(
            "SELECT count(DISTINCT creator_id) AS n FROM social_accounts WHERE status = 'connected'"
        )
        creators_connected = cur.fetchone()["n"]

    return {
        "restaurant_funnel": [
            {"label": "Signed up", "value": a["total"]},
            {"label": "Created a restaurant", "value": with_restaurant},
            {"label": "Has an active restaurant", "value": with_active},
            {"label": "Verified email", "value": a["verified"]},
        ],
        "creator_funnel": [
            {"label": "Signed up", "value": c["total"]},
            {"label": "Active", "value": c["active"]},
            {"label": "Verified email", "value": c["verified"]},
        ],
        "payments": {
            # All monthly figures. spending_limit already INCLUDES the €50/mo fee.
            "verified_restaurants": r["verified"],
            "total_limit_incl_fee": r["verified_limit"],
            "total_limit_excl_fee": max(
                Decimal("0"), r["verified_limit"] - r["verified"] * PLATFORM_FEE
            ),
            "avg_limit_incl_fee": r["verified_avg"],
            "est_monthly_fees": r["verified"] * PLATFORM_FEE,
            "all_restaurants_limit_incl_fee": r["all_limit"],
        },
        "stats": {
            "restaurants_total": r["total"],
            "restaurants_active": r["active"],
            "by_status": by_status,
            "multi_restaurant_owners": multi_owners,
            "creators_connected": creators_connected,
            "signups_7d": a["last_7d"],
            "signups_30d": a["last_30d"],
        },
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
