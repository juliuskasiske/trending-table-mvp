"""Owner 'control tower': read-only reporting over the control database.

Every endpoint is gated by ``deps.require_admin`` (a single ADMIN_KEY sent in
the X-Admin-Key header). Only non-sensitive columns are exposed — never
password hashes, session tokens, verification tokens, or encrypted OAuth secrets.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from psycopg import errors as pg_errors
from psycopg.rows import dict_row
from pydantic import BaseModel

from .. import deps
from ... import audit
from ...billing import stripe_client
from ...db.connection import get_control_connection

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Assignment statuses the control tower may set by hand. Approval/payment
# (approved, paid, payment_action) are driven by the restaurant + Stripe, not
# set manually here.
_ADMIN_ASSIGN_STATUSES = {"contacted", "posted", "declined", "cancelled"}

# €/month platform fee, baked into each restaurant's monthly spending limit.
# Sourced from the real Stripe monthly price; €50 fallback if Stripe is off.
def platform_fee() -> Decimal:
    cents = stripe_client.prices().get("monthly", {}).get("amount")
    return (Decimal(cents) / 100) if cents else Decimal("50")


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
            WITH rest AS (
                SELECT r.id, r.status, r.spending_limit_eur,
                       bool_or(a.email_verified_at IS NOT NULL) AS owner_verified
                FROM restaurants r
                LEFT JOIN memberships m ON m.restaurant_id = r.id AND m.role = 'owner'
                LEFT JOIN accounts a    ON a.id = m.account_id
                GROUP BY r.id, r.status, r.spending_limit_eur
            )
            SELECT count(*)                                                        AS total,
                   count(*) FILTER (WHERE status = 'active')                       AS active,
                   -- payment-capable = THIS restaurant is active (live) AND its
                   -- owner's email is verified
                   count(*) FILTER (WHERE status = 'active' AND owner_verified)    AS payable,
                   COALESCE(sum(spending_limit_eur), 0)                            AS all_limit,
                   COALESCE(sum(spending_limit_eur)
                            FILTER (WHERE status = 'active' AND owner_verified), 0) AS payable_limit,
                   COALESCE(avg(spending_limit_eur)
                            FILTER (WHERE status = 'active' AND owner_verified), 0) AS payable_avg
            FROM rest
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

    fee = platform_fee()
    return {
        "restaurant_funnel": [
            {"label": "Accounts", "value": a["total"]},
            {"label": "Restaurants created", "value": r["total"]},
            {"label": "Active restaurants (live)", "value": r["active"]},
            {"label": "Active + verified restaurants", "value": r["payable"]},
        ],
        "creator_funnel": [
            {"label": "Accounts signed up", "value": c["total"]},
            {"label": "Connected a social account", "value": creators_connected},
            {"label": "Verified email", "value": c["verified"]},
        ],
        "payments": {
            # "Payment-capable" = active (live) AND owner email verified.
            # All monthly figures. spending_limit already INCLUDES the platform fee.
            "platform_fee": fee,
            "verified_restaurants": r["payable"],
            "total_limit_incl_fee": r["payable_limit"],
            "total_limit_excl_fee": max(
                Decimal("0"), r["payable_limit"] - r["payable"] * fee
            ),
            "avg_limit_incl_fee": r["payable_avg"],
            "est_monthly_fees": r["payable"] * fee,
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
                       FILTER (WHERE m.role = 'owner'), '')                          AS owner_emails,
                   COALESCE(bool_or(a.email_verified_at IS NOT NULL)
                            FILTER (WHERE m.role = 'owner'), false)                  AS owner_verified
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


# --- campaigns: internal creator assignment (control tower) ----------------
# Matching is internal for now: the control tower assigns creators to a
# restaurant's campaign and sets what the restaurant is charged + what the
# creator is paid per approved post. No money moves here (that is the Stripe
# phase) — this just records the assignment so the creator sees the brief.


class AssignIn(BaseModel):
    creator_id: int
    restaurant_charge_eur: float | None = None
    creator_payout_eur: float | None = None


class AssignPatch(BaseModel):
    restaurant_charge_eur: float | None = None
    creator_payout_eur: float | None = None
    status: str | None = None


@router.get("/campaigns")
def admin_campaigns(_: None = Depends(deps.require_admin)) -> dict:
    """Every campaign across all restaurants, with assignment + payout rollups."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT c.id, c.title, c.status, c.budget_eur, c.estimated_views,
                   c.content_deadline, c.created_at,
                   r.id AS restaurant_id, r.name AS restaurant_name,
                   (SELECT count(*) FROM campaign_creators cc
                        WHERE cc.campaign_id = c.id)                       AS creators_count,
                   (SELECT count(*) FROM campaign_creators cc
                        WHERE cc.campaign_id = c.id
                          AND cc.status IN ('posted','approved','paid'))   AS posted_count,
                   COALESCE((SELECT sum(cc.creator_payout_eur) FROM campaign_creators cc
                        WHERE cc.campaign_id = c.id), 0)                    AS committed_payout,
                   COALESCE((SELECT sum(cc.restaurant_charge_eur) FROM campaign_creators cc
                        WHERE cc.campaign_id = c.id), 0)                    AS committed_charge
            FROM campaigns c JOIN restaurants r ON r.id = c.restaurant_id
            ORDER BY c.created_at DESC
            LIMIT 1000
            """
        )
        return {"campaigns": cur.fetchall()}


@router.get("/campaigns/{campaign_id}")
def admin_campaign_detail(campaign_id: int, _: None = Depends(deps.require_admin)) -> dict:
    """One campaign + its assignments + the creators still available to assign."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT c.id, c.title, c.status, c.budget_eur, c.estimated_views,"
            "   c.content_deadline, c.guidelines, c.created_at,"
            "   r.id AS restaurant_id, r.name AS restaurant_name"
            " FROM campaigns c JOIN restaurants r ON r.id = c.restaurant_id"
            " WHERE c.id = %s",
            (campaign_id,),
        )
        campaign = cur.fetchone()
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found.")
        cur.execute(
            "SELECT cc.id, cc.creator_id, cc.status, cc.restaurant_charge_eur,"
            "   cc.creator_payout_eur, cc.contacted_at, cc.posted_at, cc.approved_at,"
            "   cr.display_name AS creator_name, cr.email AS creator_email,"
            "   cp.avatar_url AS creator_avatar,"
            "   (SELECT count(*) FROM posts p WHERE p.campaign_creator_id = cc.id) AS post_count"
            " FROM campaign_creators cc JOIN creators cr ON cr.id = cc.creator_id"
            "   LEFT JOIN creator_profiles cp ON cp.creator_id = cc.creator_id"
            " WHERE cc.campaign_id = %s ORDER BY cc.contacted_at",
            (campaign_id,),
        )
        assignments = cur.fetchall()
        cur.execute(
            "SELECT cr.id, cr.display_name, cr.email, cp.avatar_url, cp.city,"
            "   cp.base_rate_eur, COALESCE(cp.categories, '{}') AS categories"
            " FROM creators cr LEFT JOIN creator_profiles cp ON cp.creator_id = cr.id"
            " WHERE cr.status = 'active'"
            "   AND cr.id NOT IN (SELECT creator_id FROM campaign_creators WHERE campaign_id = %s)"
            " ORDER BY cr.display_name NULLS LAST, cr.id"
            " LIMIT 200",
            (campaign_id,),
        )
        available = cur.fetchall()
    return {"campaign": campaign, "assignments": assignments, "available_creators": available}


@router.post("/campaigns/{campaign_id}/creators")
def admin_assign_creator(campaign_id: int, body: AssignIn,
                         _: None = Depends(deps.require_admin)) -> dict:
    """Assign a creator to a campaign with a charge + payout (status 'contacted')."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT id FROM campaigns WHERE id = %s", (campaign_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Campaign not found.")
        cur.execute("SELECT id FROM creators WHERE id = %s AND status = 'active'", (body.creator_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Creator not found or inactive.")
        try:
            cur.execute(
                "INSERT INTO campaign_creators (campaign_id, creator_id,"
                "   restaurant_charge_eur, creator_payout_eur, status)"
                " VALUES (%s, %s, %s, %s, 'contacted') RETURNING id, status",
                (campaign_id, body.creator_id, body.restaurant_charge_eur, body.creator_payout_eur),
            )
        except pg_errors.UniqueViolation:
            conn.rollback()
            raise HTTPException(status_code=409, detail="Creator already assigned to this campaign.")
        row = cur.fetchone()
        audit.record(conn, "campaign_creator_assigned", restaurant_id=None,
                     detail={"campaign_id": campaign_id, "creator_id": body.creator_id})
        conn.commit()
    return row


@router.patch("/campaigns/{campaign_id}/creators/{cc_id}")
def admin_update_assignment(campaign_id: int, cc_id: int, body: AssignPatch,
                            _: None = Depends(deps.require_admin)) -> dict:
    """Adjust an assignment's charge/payout, or hand-set a safe status."""
    sets: list[str] = []
    params: list = []
    if body.restaurant_charge_eur is not None:
        sets.append("restaurant_charge_eur = %s")
        params.append(body.restaurant_charge_eur)
    if body.creator_payout_eur is not None:
        sets.append("creator_payout_eur = %s")
        params.append(body.creator_payout_eur)
    if body.status is not None:
        if body.status not in _ADMIN_ASSIGN_STATUSES:
            raise HTTPException(status_code=400,
                                detail="Approval and payment statuses are set by the payment flow, not here.")
        sets.append("status = %s")
        params.append(body.status)
    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to update.")
    params.extend([cc_id, campaign_id])
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"UPDATE campaign_creators SET {', '.join(sets)}"
            " WHERE id = %s AND campaign_id = %s RETURNING id, status,"
            "   restaurant_charge_eur, creator_payout_eur",
            params,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Assignment not found.")
        conn.commit()
    return row


@router.delete("/campaigns/{campaign_id}/creators/{cc_id}")
def admin_remove_assignment(campaign_id: int, cc_id: int,
                            _: None = Depends(deps.require_admin)) -> dict:
    """Remove an assignment (only before any money has moved)."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "DELETE FROM campaign_creators WHERE id = %s AND campaign_id = %s"
            "   AND status IN ('contacted', 'posted', 'declined', 'cancelled')"
            " RETURNING id",
            (cc_id, campaign_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404,
                                detail="Assignment not found, or it has already been paid.")
        conn.commit()
    return {"ok": True}
