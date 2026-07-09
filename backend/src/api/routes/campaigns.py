"""Restaurant campaigns (redesign).

A campaign is a restaurant thing: a budget, a content deadline (post-by date),
and per-campaign content guidelines. From the budget we show a non-binding
expected-views estimate (budget ÷ the internal rate — the rate is never
returned). Creators are matched internally via the control tower
(campaign_creators); money moves on restaurant approval. Launching a campaign
costs €9.99 (real Stripe wired in a later phase; here it just activates).
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Json
from pydantic import BaseModel

from ... import audit, config
from ...db.connection import get_control_connection
from . import billing
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
    if not body.budget_eur or body.budget_eur < config.MIN_CAMPAIGN_BUDGET_EUR:
        raise HTTPException(status_code=400,
                            detail=f"The minimum campaign budget is €{config.MIN_CAMPAIGN_BUDGET_EUR:.0f}.")
    # The post-by date is required and must be at least 3 weeks out.
    if not body.content_deadline:
        raise HTTPException(status_code=400, detail="A post-by date is required.")
    try:
        deadline = date.fromisoformat(body.content_deadline)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid post-by date.")
    if deadline < date.today() + timedelta(days=config.CAMPAIGN_LEAD_DAYS):
        raise HTTPException(status_code=400,
                            detail="The post-by date must be at least 3 weeks from today.")
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
            " WHERE c.restaurant_id = %s"
            # Live campaigns first (draft/active), then finished ones (completed/
            # cancelled) — cancelled stays visible, just sinks to the bottom.
            " ORDER BY (c.status IN ('completed', 'cancelled')) ASC, c.created_at DESC",
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
    """Launch a draft campaign — charges the one-time launch fee to the account's
    saved card (idempotent: skipped if the fee was already charged)."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "UPDATE campaigns SET status = 'active', fee_paid_at = NOW()"
            " WHERE id = %s AND restaurant_id = %s AND status = 'draft'"
            f" RETURNING {_COLS}, fee_payment_intent_id",
            (campaign_id, rid),
        )
        campaign = cur.fetchone()
        if not campaign:
            raise HTTPException(status_code=400, detail="Campaign not found or already launched.")
        charge = None
        if not campaign.get("fee_payment_intent_id"):
            charge = billing.charge_restaurant_owner(
                conn, rid, config.CAMPAIGN_FEE_CENTS,
                f"Campaign launch fee — {campaign.get('title') or campaign_id}",
                f"launch-fee-{campaign_id}",
            )
            if charge.get("id"):
                cur.execute("UPDATE campaigns SET fee_payment_intent_id = %s WHERE id = %s",
                            (charge["id"], campaign_id))
        conn.commit()
        audit.record(conn, "campaign_launched", account_id=ctx["account_id"],
                     restaurant_id=rid, detail={"campaign_id": campaign_id, "fee_charge": charge})
    campaign.pop("fee_payment_intent_id", None)
    return campaign


@router.post("/{restaurant_id}/campaigns/{campaign_id}/cancel")
def cancel_campaign(campaign_id: int, ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Cancel a draft or active campaign. It stays visible, marked 'cancelled'."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "UPDATE campaigns SET status = 'cancelled'"
            " WHERE id = %s AND restaurant_id = %s AND status IN ('draft', 'active')"
            f" RETURNING {_COLS}",
            (campaign_id, rid),
        )
        campaign = cur.fetchone()
        if not campaign:
            raise HTTPException(status_code=400, detail="Campaign not found or can't be cancelled.")
        conn.commit()
        audit.record(conn, "campaign_cancelled", account_id=ctx["account_id"],
                     restaurant_id=rid, detail={"campaign_id": campaign_id})
    return campaign


@router.post("/{restaurant_id}/campaigns/{campaign_id}/assignments/{assignment_id}/approve")
def approve_assignment(campaign_id: int, assignment_id: int,
                       ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Approve a creator's post and pay out: charges the restaurant's card the
    agreed per-creator amount, then marks the assignment paid. Idempotent — a
    second call won't charge again (the stored charge id guards it)."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT cc.id, cc.status, cc.restaurant_charge_eur, cc.charge_payment_intent_id"
            " FROM campaign_creators cc JOIN campaigns c ON c.id = cc.campaign_id"
            " WHERE cc.id = %s AND cc.campaign_id = %s AND c.restaurant_id = %s",
            (assignment_id, campaign_id, rid),
        )
        a = cur.fetchone()
        if not a:
            raise HTTPException(status_code=404, detail="Assignment not found.")
        charge = None
        charge_id = a["charge_payment_intent_id"]
        if charge_id is None and a["restaurant_charge_eur"]:
            cents = int(round(float(a["restaurant_charge_eur"]) * 100))
            charge = billing.charge_restaurant_owner(
                conn, rid, cents,
                f"Creator payout — campaign {campaign_id}, assignment {assignment_id}",
                f"payout-{assignment_id}",
            )
            charge_id = charge.get("id")
        cur.execute(
            "UPDATE campaign_creators SET status = 'paid',"
            " approved_at = COALESCE(approved_at, NOW()), paid_at = NOW(),"
            " charge_payment_intent_id = COALESCE(charge_payment_intent_id, %s)"
            " WHERE id = %s",
            (charge_id, assignment_id),
        )
        conn.commit()
        audit.record(conn, "assignment_paid", account_id=ctx["account_id"], restaurant_id=rid,
                     detail={"campaign_id": campaign_id, "assignment_id": assignment_id, "charge": charge})
    return {"ok": True, "charge": charge}


@router.post("/{restaurant_id}/campaigns/{campaign_id}/complete")
def complete_campaign(campaign_id: int, ctx: dict = Depends(restaurant_ctx)) -> dict:
    """End a campaign: pull the unspent remainder of the budget (budget minus what
    was already charged for creator payouts) to the platform, then mark it
    completed. Idempotent via the stored settlement charge id."""
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, title, budget_eur, status, settle_charge_id FROM campaigns"
            " WHERE id = %s AND restaurant_id = %s",
            (campaign_id, rid),
        )
        c = cur.fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Campaign not found.")
        if c["status"] not in ("active", "draft"):
            raise HTTPException(status_code=400, detail="Campaign can't be completed.")
        cur.execute(
            "SELECT COALESCE(SUM(restaurant_charge_eur), 0) AS spent FROM campaign_creators"
            " WHERE campaign_id = %s AND status = 'paid'",
            (campaign_id,),
        )
        spent = float(cur.fetchone()["spent"])
        remainder_cents = int(round((float(c["budget_eur"] or 0) - spent) * 100))
        charge = None
        settle_id = c["settle_charge_id"]
        if settle_id is None and remainder_cents > 0:
            charge = billing.charge_restaurant_owner(
                conn, rid, remainder_cents,
                f"Campaign settlement — {c.get('title') or campaign_id}",
                f"settle-{campaign_id}",
            )
            settle_id = charge.get("id")
        cur.execute(
            "UPDATE campaigns SET status = 'completed', completed_at = NOW(),"
            " settle_charge_id = COALESCE(settle_charge_id, %s)"
            f" WHERE id = %s RETURNING {_COLS}",
            (settle_id, campaign_id),
        )
        campaign = cur.fetchone()
        conn.commit()
        audit.record(conn, "campaign_completed", account_id=ctx["account_id"], restaurant_id=rid,
                     detail={"campaign_id": campaign_id, "remainder_cents": remainder_cents, "charge": charge})
    return campaign


@router.get("/{restaurant_id}/campaigns/{campaign_id}/analytics")
def campaign_analytics(campaign_id: int, ctx: dict = Depends(restaurant_ctx)) -> dict:
    """Views-over-time series + engagement totals for a campaign's posts.

    The series is a daily aggregate: for each day we carry forward each post's
    last-known view count and sum across posts, so the line only ever grows as
    posts are added and their views climb. Totals use each post's latest snapshot.
    """
    rid = ctx["restaurant_id"]
    with get_control_connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id FROM campaigns WHERE id = %s AND restaurant_id = %s",
            (campaign_id, rid),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Campaign not found.")

        cur.execute(
            "SELECT COALESCE(SUM(m.views), 0) AS views, COALESCE(SUM(m.likes), 0) AS likes,"
            "   COALESCE(SUM(m.comments), 0) AS comments, COALESCE(SUM(m.shares), 0) AS shares,"
            "   COALESCE(SUM(m.saves), 0) AS saves, count(p.id) AS post_count"
            " FROM posts p"
            "   LEFT JOIN LATERAL (SELECT views, likes, comments, shares, saves FROM post_metrics"
            "       WHERE post_id = p.id ORDER BY captured_at DESC LIMIT 1) m ON true"
            " WHERE p.campaign_id = %s",
            (campaign_id,),
        )
        totals = cur.fetchone()

        cur.execute(
            "SELECT p.id AS post_id, pm.captured_at::date AS day, MAX(pm.views) AS views"
            " FROM posts p JOIN post_metrics pm ON pm.post_id = p.id"
            " WHERE p.campaign_id = %s"
            " GROUP BY p.id, pm.captured_at::date"
            " ORDER BY day",
            (campaign_id,),
        )
        rows = cur.fetchall()

    series: list[dict] = []
    days = sorted({r["day"] for r in rows})
    if days:
        posts = sorted({r["post_id"] for r in rows})
        by_day = {(r["post_id"], r["day"]): int(r["views"] or 0) for r in rows}
        last = {pid: 0 for pid in posts}
        day = days[0]
        while day <= days[-1]:
            for pid in posts:
                if (pid, day) in by_day:
                    last[pid] = by_day[(pid, day)]
            series.append({"date": day.isoformat(), "views": sum(last.values())})
            day += timedelta(days=1)

    return {"totals": totals, "series": series}
