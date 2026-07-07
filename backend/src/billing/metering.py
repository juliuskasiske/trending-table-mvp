"""Post metric snapshots.

View-based billing (€0.01/view) is removed in the campaign redesign: the poller
now only *records* metric snapshots for analytics. Money moves on restaurant
approval of a campaign post (see the campaigns/billing routes), not per view.
"""
from __future__ import annotations

from decimal import Decimal

from psycopg.types.json import Json

from ..db.connection import get_control_connection

_METRIC_COLS = ("views", "likes", "comments", "shares", "saves", "reach", "impressions")


def month_spend(conn, restaurant_id: int) -> Decimal:
    """Sum of this month's ledger for a restaurant (kept for the legacy spend read)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(amount_eur), 0) FROM usage_events"
            " WHERE restaurant_id = %s AND occurred_at >= date_trunc('month', NOW())",
            (restaurant_id,),
        )
        return Decimal(cur.fetchone()[0])


def ingest_metrics(post_id: int, metrics: dict) -> dict:
    """Record a post metric snapshot for analytics. No billing side-effects."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM posts WHERE id = %s", (post_id,))
        if not cur.fetchone():
            raise ValueError("post not found")
        cur.execute(
            "INSERT INTO post_metrics (post_id, views, likes, comments, shares, saves,"
            " reach, impressions, source) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (post_id, *[metrics.get(c) for c in _METRIC_COLS], Json(metrics.get("source", {}))),
        )
        conn.commit()
    return {"post_id": post_id, "views": int(metrics.get("views") or 0)}
