"""Restaurant campaigns (redesign).

A campaign is a restaurant thing: a budget, a content deadline (post-by date),
and per-campaign content guidelines. From the budget we show a non-binding
expected-views estimate (budget ÷ the internal rate — the rate is never
returned). Creators are matched internally via the control tower
(campaign_creators); money moves on restaurant approval. Launching a campaign
costs €9.99 (real Stripe wired in a later phase; here it just activates).
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Json
from pydantic import BaseModel

from ... import audit, config
from ...db.connection import get_control_connection
from .restaurants import restaurant_ctx

router = APIRouter(prefix="/api/restaurants", tags=["campaigns"])

# Columns returned for a campaign (never includes the €/view estimate rate).
_COLS = ("id, restaurant_id, title, budget_eur, content_deadline, guidelines,"
         " estimated_views, status, fee_paid_at, created_at")


def _estimate_views(budget_eur) -> int:
    """Expected views for a budget = budget ÷ internal rate. Rate stays server-side."""
    if not budget_eur or Decimal(str(budget_eur)) <= 0:
        return 0
    return int(Decimal(str(budget_eur)) / config.VIEW_ESTIMATE_RATE_EUR)


class CampaignIn(BaseModel):
    title: str
    budget_eur: float
    content_deadline: str | None = None  # ISO YYYY-MM-DD
    guidelines: dict | None = None


@router.post("/{restaurant_id}/campaigns")
def create_campaign(body: CampaignIn, ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Give the campaign a title.")
    if not body.budget_eur or body.budget_eur <= 0:
        raise HTTPException(status_code=400, detail="Budget must be greater than 0.")
    est = _estimate_views(body.budget_eur)
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "INSERT INTO campaigns (restaurant_id, title, budget_eur, content_deadline,"
            "   guidelines, estimated_views, status)"
            " VALUES (%s, %s, %s, %s, %s, %s, 'draft')"
            f" RETURNING {_COLS}",
            (rid, title, body.budget_eur, body.content_deadline or None,
             Json(body.guidelines or {}), est),
        )
        campaign = cur.fetchone()
        conn.commit()
        audit.record(conn, "campaign_created", account_id=ctx["account_id"],
                     restaurant_id=rid, detail={"campaign_id": campaign["id"]})
    return campaign


@router.get("/{restaurant_id}/campaigns")
def list_campaigns(ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Campaigns for this restaurant, each with headline counts for the list."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"SELECT {_COLS},"
            "   (SELECT count(*) FROM campaign_creators cc WHERE cc.campaign_id = c.id) AS creators_count,"
            "   (SELECT count(*) FROM campaign_creators cc WHERE cc.campaign_id = c.id"
            "       AND cc.status IN ('posted', 'approved', 'paid')) AS posted_count,"
            "   (SELECT COALESCE(SUM(lv.views), 0) FROM posts p"
            "       LEFT JOIN LATERAL (SELECT views FROM post_metrics WHERE post_id = p.id"
            "           ORDER BY captured_at DESC LIMIT 1) lv ON true"
            "       WHERE p.campaign_id = c.id) AS total_views"
            " FROM campaigns c"
            " WHERE c.restaurant_id = %s AND c.status <> 'cancelled'"
            " ORDER BY c.created_at DESC",
            (rid,),
        )
        return {"campaigns": cur.fetchall()}


@router.get("/{restaurant_id}/campaigns/{campaign_id}")
def campaign_detail(campaign_id: int, ctx: dict = Depends(restaurant_ctx)) -> dict:
    """One campaign + its creator assignments + submitted posts."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"SELECT {_COLS} FROM campaigns WHERE id = %s AND restaurant_id = %s",
            (campaign_id, rid),
        )
        campaign = cur.fetchone()
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found.")
        cur.execute(
            "SELECT cc.id, cc.creator_id, cc.status, cc.restaurant_charge_eur,"
            "   cr.display_name AS creator_name, cp.avatar_url AS creator_avatar,"
            "   cc.posted_at, cc.approved_at"
            " FROM campaign_creators cc JOIN creators cr ON cr.id = cc.creator_id"
            "   LEFT JOIN creator_profiles cp ON cp.creator_id = cc.creator_id"
            " WHERE cc.campaign_id = %s ORDER BY cc.contacted_at",
            (campaign_id,),
        )
        assignments = cur.fetchall()
        cur.execute(
            "SELECT p.id, p.platform, p.permalink, p.caption, p.thumbnail_url, p.media_type,"
            "   p.media_product_type, p.posted_at, p.creator_id, p.campaign_creator_id,"
            "   cr.display_name AS creator_name,"
            "   m.views AS latest_views, m.likes AS latest_likes"
            " FROM posts p JOIN creators cr ON cr.id = p.creator_id"
            "   LEFT JOIN LATERAL (SELECT views, likes FROM post_metrics"
            "       WHERE post_id = p.id ORDER BY captured_at DESC LIMIT 1) m ON true"
            " WHERE p.campaign_id = %s ORDER BY p.created_at DESC",
            (campaign_id,),
        )
        posts = cur.fetchall()
    return {"campaign": campaign, "assignments": assignments, "posts": posts}


@router.post("/{restaurant_id}/campaigns/{campaign_id}/launch")
def launch_campaign(campaign_id: int, ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Launch a draft campaign. The €9.99 fee is charged via Stripe in a later
    phase; here launching just activates it."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "UPDATE campaigns SET status = 'active', fee_paid_at = NOW()"
            " WHERE id = %s AND restaurant_id = %s AND status = 'draft'"
            f" RETURNING {_COLS}",
            (campaign_id, rid),
        )
        campaign = cur.fetchone()
        if not campaign:
            raise HTTPException(status_code=400, detail="Campaign not found or already launched.")
        conn.commit()
        audit.record(conn, "campaign_launched", account_id=ctx["account_id"],
                     restaurant_id=rid, detail={"campaign_id": campaign_id})
    return campaign
