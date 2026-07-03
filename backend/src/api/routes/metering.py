"""Metrics ingest (dev/system) + spend and earnings reads."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from .. import deps
from ...billing import metering
from ...db.connection import get_control_connection
from .restaurants import restaurant_ctx

router = APIRouter(prefix="/api", tags=["metering"])


class MetricsIn(BaseModel):
    views: int = Field(ge=0)
    likes: int | None = Field(default=None, ge=0)
    comments: int | None = Field(default=None, ge=0)
    shares: int | None = Field(default=None, ge=0)
    saves: int | None = Field(default=None, ge=0)
    reach: int | None = Field(default=None, ge=0)
    impressions: int | None = Field(default=None, ge=0)


@router.post("/posts/{post_id}/metrics")
def ingest_post_metrics(post_id: int, body: MetricsIn,
                        _: None = Depends(deps.require_admin)) -> dict:
    """Record a metric snapshot and bill new views.

    Metrics move real money (restaurant spend + creator earnings at €/view), so
    self-reported numbers from either marketplace side would be an incentive to
    inflate. In production only the system poller ingests metrics (it calls
    metering.ingest_metrics directly); this HTTP endpoint exists for admin and
    testing and is therefore ADMIN_KEY-gated.
    """
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM posts WHERE id = %s", (post_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Post not found.")
    return metering.ingest_metrics(post_id, body.model_dump())


@router.get("/restaurants/{restaurant_id}/spend")
def restaurant_spend(ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn:
        spend = metering.month_spend(conn, rid)
        with conn.cursor() as cur:
            cur.execute("SELECT spending_limit_eur FROM restaurants WHERE id = %s", (rid,))
            limit = cur.fetchone()[0]
    remaining = (Decimal(limit) - spend) if limit is not None else None
    return {
        "month_spend_eur": float(spend),
        "spending_limit_eur": float(limit) if limit is not None else None,
        "remaining_eur": float(remaining) if remaining is not None else None,
    }


@router.get("/restaurants/{restaurant_id}/posts")
def restaurant_posts(ctx: dict = Depends(restaurant_ctx)) -> dict:
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT p.id, p.platform, p.permalink, p.status, p.billed_views, p.creator_id,"
            "   (SELECT views FROM post_metrics m WHERE m.post_id = p.id"
            "    ORDER BY captured_at DESC LIMIT 1) AS latest_views"
            " FROM posts p WHERE p.restaurant_id = %s ORDER BY p.created_at DESC",
            (rid,),
        )
        return {"posts": cur.fetchall()}


@router.get("/creator/earnings")
def creator_earnings(principal: dict = Depends(deps.require_creator)) -> dict:
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT COALESCE(SUM(amount_eur), 0) AS total, COALESCE(SUM(views), 0) AS views"
            " FROM creator_earnings WHERE creator_id = %s",
            (principal["id"],),
        )
        totals = cur.fetchone()
        cur.execute(
            "SELECT period, SUM(amount_eur) AS amount_eur, SUM(views) AS views"
            " FROM creator_earnings WHERE creator_id = %s GROUP BY period ORDER BY period DESC",
            (principal["id"],),
        )
        by_period = cur.fetchall()
    return {
        "total_eur": float(totals["total"]),
        "total_views": int(totals["views"]),
        "by_period": [
            {"period": r["period"], "amount_eur": float(r["amount_eur"]), "views": int(r["views"])}
            for r in by_period
        ],
    }
