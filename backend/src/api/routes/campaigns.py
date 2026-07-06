"""Restaurant-side marketplace routes: book creators (campaigns), list them."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel

from ... import audit
from ...db.connection import get_control_connection
from .restaurants import restaurant_ctx

router = APIRouter(prefix="/api/restaurants", tags=["campaigns"])


class CampaignIn(BaseModel):
    creator_id: int
    agreed_rate_eur: float | None = None
    deliverable: str | None = None
    scheduled_date: str | None = None  # ISO date "YYYY-MM-DD"
    status: str = "proposed"  # an invite; the creator accepts to confirm it


@router.post("/{restaurant_id}/campaigns")
def create_campaign(body: CampaignIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    status = body.status if body.status in ("proposed", "accepted") else "proposed"
    with get_control_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT id FROM creators WHERE id = %s", (body.creator_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Creator not found.")
            cur.execute(
                "INSERT INTO campaigns (restaurant_id, creator_id, status, agreed_rate_eur,"
                "   deliverable, scheduled_date)"
                " VALUES (%s, %s, %s, %s, %s, %s)"
                " RETURNING id, restaurant_id, creator_id, status, agreed_rate_eur,"
                "   deliverable, scheduled_date, created_at",
                (rid, body.creator_id, status, body.agreed_rate_eur, body.deliverable,
                 body.scheduled_date or None),
            )
            campaign = cur.fetchone()
        conn.commit()
        audit.record(conn, "campaign_created", account_id=ctx["account_id"],
                     restaurant_id=rid, detail={"creator_id": body.creator_id})
    return campaign


@router.get("/{restaurant_id}/campaigns")
def list_campaigns(ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Bookings for this restaurant, enriched for the bookings UI: creator
    identity + avatar, deliverable, scheduled date, and how many posts exist
    (so the UI knows a booking has viewable content)."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT c.id, c.creator_id, cr.display_name AS creator_name, cr.email AS creator_email,"
            "   cp.avatar_url AS creator_avatar, c.status, c.agreed_rate_eur, c.deliverable,"
            "   c.scheduled_date, c.created_at,"
            "   (SELECT count(*) FROM posts p WHERE p.campaign_id = c.id) AS post_count"
            " FROM campaigns c JOIN creators cr ON cr.id = c.creator_id"
            "   LEFT JOIN creator_profiles cp ON cp.creator_id = c.creator_id"
            " WHERE c.restaurant_id = %s ORDER BY COALESCE(c.scheduled_date, c.created_at::date) DESC",
            (rid,),
        )
        return {"campaigns": cur.fetchall()}
