"""View-based billing: turn a post's metric snapshot into charges.

Cumulative views come in; we bill only the *delta* since posts.billed_views,
capped by the restaurant's monthly spending limit. Restaurant pays €0.01/view;
creator earns €0.002/view (20%); platform keeps €0.008 (80%).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal

from psycopg.rows import dict_row
from psycopg.types.json import Json

from . import stripe_client
from ..db.connection import get_control_connection

log = logging.getLogger("metering")

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
                "SELECT p.restaurant_id, p.creator_id, p.billed_views,"
                " r.stripe_customer_id, r.stripe_usage_subscription_id"
                " FROM posts p JOIN restaurants r ON r.id = p.restaurant_id"
                " WHERE p.id = %s",
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
            usage_event_id = None
            if billed > 0:
                cur.execute(
                    "INSERT INTO usage_events (restaurant_id, post_id, kind, quantity,"
                    " unit_price_eur, amount_eur) VALUES (%s, %s, 'view', %s, %s, %s)"
                    " RETURNING id",
                    (post["restaurant_id"], post_id, billed, VIEW_PRICE, amount),
                )
                usage_event_id = cur.fetchone()["id"]
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

    # Report the billed views to Stripe (metered usage). Done AFTER the local
    # ledger commit so a Stripe hiccup never loses the billing record; the
    # idempotent event identifier lets a later retry reconcile safely.
    if billed > 0 and post["stripe_customer_id"] and stripe_client.usage_enabled():
        _report_usage_to_stripe(
            restaurant_id=post["restaurant_id"],
            customer_id=post["stripe_customer_id"],
            usage_subscription_id=post["stripe_usage_subscription_id"],
            usage_event_id=usage_event_id,
            billed=billed,
        )

    return {
        "delta": delta,
        "billed_views": billed,
        "amount_eur": float(amount),
        "creator_amount_eur": float(creator_amount),
        "capped": capped,
    }


def _report_usage_to_stripe(*, restaurant_id, customer_id, usage_subscription_id,
                            usage_event_id, billed) -> None:
    """Ensure the metered usage subscription exists, then report the views.
    Best-effort: failures are logged, not raised (the local ledger is truth)."""
    try:
        if not usage_subscription_id:
            usage_subscription_id = stripe_client.ensure_usage_subscription(customer_id)
            with get_control_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    "UPDATE restaurants SET stripe_usage_subscription_id = %s WHERE id = %s",
                    (usage_subscription_id, restaurant_id),
                )
                conn.commit()
        identifier = f"ue_{usage_event_id}"
        stripe_client.report_view_usage(customer_id, billed, identifier)
        with get_control_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE usage_events SET stripe_usage_record_id = %s WHERE id = %s",
                (identifier, usage_event_id),
            )
            conn.commit()
    except Exception:
        log.exception("Stripe usage reporting failed for usage_event %s", usage_event_id)
