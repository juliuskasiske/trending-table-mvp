"""View-based billing: turn a post's metric snapshot into charges.

Cumulative views come in; we bill only the *delta* since posts.billed_views,
capped by the restaurant's monthly spending limit. Restaurant pays €0.01/view;
creator earns €0.002/view (20%); platform keeps €0.008 (80%).
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from psycopg.rows import dict_row
from psycopg.types.json import Json

from ..db.connection import get_control_connection

VIEW_PRICE = Decimal("0.01")     # what the restaurant pays per view
CREATOR_PRICE = Decimal("0.002")  # what the creator earns per view (20%)

_METRIC_COLS = ("views", "likes", "comments", "shares", "saves", "reach", "impressions")


def month_spend(conn, restaurant_id: int) -> Decimal:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(amount_eur), 0) FROM usage_events"
            " WHERE restaurant_id = %s AND occurred_at >= date_trunc('month', NOW())",
            (restaurant_id,),
        )
        return Decimal(cur.fetchone()[0])


def ingest_metrics(post_id: int, metrics: dict) -> dict:
    """Record a metric snapshot and bill the new views (chokepoint-capped)."""
    period = datetime.now(timezone.utc).strftime("%Y-%m")
    with get_control_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "INSERT INTO post_metrics (post_id, views, likes, comments, shares, saves,"
                " reach, impressions, source) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (post_id, *[metrics.get(c) for c in _METRIC_COLS], Json(metrics.get("source", {}))),
            )
            cur.execute(
                "SELECT restaurant_id, creator_id, billed_views FROM posts WHERE id = %s",
                (post_id,),
            )
            post = cur.fetchone()
            if not post:
                conn.rollback()
                raise ValueError("post not found")

            views = int(metrics.get("views") or 0)
            delta = views - int(post["billed_views"])
            billed = 0
            capped = False

            if delta > 0:
                cur.execute("SELECT spending_limit_eur FROM restaurants WHERE id = %s",
                            (post["restaurant_id"],))
                limit = cur.fetchone()["spending_limit_eur"]
                max_views = delta
                if limit is not None:
                    remaining = Decimal(limit) - month_spend(conn, post["restaurant_id"])
                    budget_views = int(remaining / VIEW_PRICE) if remaining > 0 else 0
                    if budget_views < delta:
                        capped = True
                    max_views = max(0, min(delta, budget_views))
                billed = max_views

            amount = Decimal(billed) * VIEW_PRICE
            creator_amount = Decimal(billed) * CREATOR_PRICE
            if billed > 0:
                cur.execute(
                    "INSERT INTO usage_events (restaurant_id, post_id, kind, quantity,"
                    " unit_price_eur, amount_eur) VALUES (%s, %s, 'view', %s, %s, %s)",
                    (post["restaurant_id"], post_id, billed, VIEW_PRICE, amount),
                )
                cur.execute(
                    "INSERT INTO creator_earnings (creator_id, post_id, period, views, amount_eur)"
                    " VALUES (%s, %s, %s, %s, %s)",
                    (post["creator_id"], post_id, period, billed, creator_amount),
                )
                cur.execute(
                    "UPDATE posts SET billed_views = billed_views + %s WHERE id = %s",
                    (billed, post_id),
                )
        conn.commit()

    # NOTE: when Stripe is configured, also report `billed` to the metered
    # subscription item here (usage record) — wired with subscriptions.
    return {
        "delta": delta,
        "billed_views": billed,
        "amount_eur": float(amount),
        "creator_amount_eur": float(creator_amount),
        "capped": capped,
    }
