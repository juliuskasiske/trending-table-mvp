"""Metrics ingest (dev/system) + spend and earnings reads."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel

from .. import deps
from ...billing import metering
from ...db.connection import get_control_connection
from .restaurants import restaurant_ctx

router = APIRouter(prefix="/api", tags=["metering"])


class MetricsIn(BaseModel):
    views: int
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None
    saves: int | None = None
    reach: int | None = None
    impressions: int | None = None


@router.post("/posts/{post_id}/metrics")
def ingest_post_metrics(post_id: int, body: MetricsIn,
                        principal: dict = Depends(deps.current_principal)) -> dict:
    """Record a metric snapshot and bill new views. Represents the system poller;
    exposed for admin/testing. Caller must be the post's creator or a member of
    its restaurant."""
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT restaurant_id, creator_id FROM posts WHERE id = %s", (post_id,))
        post = cur.fetchone()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    allowed = (
        (principal["role"] == "creator" and principal["id"] == post["creator_id"])
        or (principal["role"] == "account"
            and _is_member(principal["id"], post["restaurant_id"]))
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Not your post.")
    return metering.ingest_metrics(post_id, body.model_dump())


def _is_member(account_id: int, restaurant_id: int) -> bool:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM memberships WHERE account_id = %s AND restaurant_id = %s",
            (account_id, restaurant_id),
        )
        return cur.fetchone() is not None


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
